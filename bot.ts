// =============================================================================
// bot.ts — a tiny god-view AI policy, shared by the console demo and the web UI.
// It only ever calls reduce() through `apply`, so the engine stays authoritative.
// =============================================================================
import { def, canAfford, type GameState, type Action, type PlayerId } from './engine.js';
import { CATALOG } from './catalog.js';

export type Apply = (pid: PlayerId, a: Action) => void;
export type Get = () => GameState;

// Respond for whichever defender an open combat gate is waiting on (block with a
// spare permanent if one is free, otherwise take the hit).
export function resolveGates(get: Get, apply: Apply) {
  let s = get();
  let guard = 0;
  while (s.pending && guard++ < 50) {
    const pid = s.pending.waitingOn[0];
    const blocker = Object.values(s.instances).find((i) => i.controller === pid && i.zone === 'board'
      && !i.tapped && i.active && def(i).kind !== 'core' && (def(i).stats?.health ?? 0) > 0);
    const atkId = s.pending.attacks[0]?.attackerId;
    apply(pid, { type: 'respondToAttack', blocks: blocker && atkId ? [{ blockerId: blocker.id, attackerId: atkId }] : [] });
    s = get();
  }
}

// Play one full turn for `pid`: attack → play resources → play affordable actions
// → score → buy → end turn.
export function playWholeTurn(get: Get, apply: Apply, pid: PlayerId) {
  let s = get();
  const foe = s.turnOrder.filter((p) => p !== pid && s.players[p].integrity > 0)[0];

  // ATTACK
  const atks = Object.values(s.instances).filter((i) => i.controller === pid && i.zone === 'board'
    && !i.tapped && i.active && (def(i).stats?.attack ?? 0) > 0);
  if (atks.length && foe) {
    apply(pid, { type: 'declareAttack', attacks: atks.map((a) => ({ attackerId: a.id, target: { player: foe } })) });
    resolveGates(get, apply);
  }
  if (get().status !== 'playing') return; // combat may have ended the game
  apply(pid, { type: 'endPhase' }); // -> action

  // ACTION: resources first (free → banks resources), then affordable actions, then score.
  s = get();
  for (const c of Object.values(s.instances).filter((i) => i.controller === pid && i.zone === 'hand'))
    if (def(c).kind === 'resource') apply(pid, { type: 'playCard', instId: c.id });
  s = get();
  for (const c of Object.values(s.instances).filter((i) => i.controller === pid && i.zone === 'hand')) {
    const d = def(c);
    if (d.kind === 'waste' || d.kind === 'resource') continue;
    apply(pid, { type: 'playCard', instId: c.id, chosen: foe ? [foe] : undefined });
  }
  s = get();
  for (const fl of s.objectives.flavors) apply(pid, { type: 'scoreObjective', flavor: fl });
  if (get().status !== 'playing') return; // a capstone score may have ended the game
  apply(pid, { type: 'endPhase' }); // -> buy

  // BUY: build a board first (free blind pulls), then upgrade the resource base.
  const ownPerms = () => Object.values(get().instances).filter((i) => i.controller === pid && i.zone === 'board' && def(i).kind !== 'core').length;
  const buyOnce = (): boolean => {
    s = get();
    if (s.status !== 'playing') return false;
    const p = s.players[pid];
    if (p.buys <= 0) return false;
    const actionKey = ['warfare:I', 'mercenary:I', 'structure:I', 'industrial:I', 'diplomacy:I', 'covert:I']
      .find((k) => s.supply[k]?.cards.length && s.supply[k].acquire === 'free');
    if (ownPerms() < 4 && actionKey) { apply(pid, { type: 'buyCard', stackKey: actionKey }); return true; }
    const silicon = CATALOG.get('silicon')!;
    const compromise = CATALOG.get('compromise')!;
    if (s.supply['mineral:II']?.cards.length && canAfford(p, silicon.cost)) { apply(pid, { type: 'buyCard', stackKey: 'mineral:II' }); return true; }
    if (s.supply['influence:II']?.cards.length && canAfford(p, compromise.cost)) { apply(pid, { type: 'buyCard', stackKey: 'influence:II' }); return true; }
    if (actionKey) { apply(pid, { type: 'buyCard', stackKey: actionKey }); return true; }
    if (s.supply['mineral:I']?.cards.length) { apply(pid, { type: 'buyCard', stackKey: 'mineral:I' }); return true; }
    return false;
  };
  let guard = 0;
  while (buyOnce() && guard++ < 50) { /* spend every buy */ }
  apply(pid, { type: 'endPhase' }); // -> cleanup
  apply(pid, { type: 'endTurn' });  // advance
}
