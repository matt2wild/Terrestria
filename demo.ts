// =============================================================================
// demo.ts — runs a full automated game through the engine to prove it works.
// A tiny bot policy drives each player; the engine enforces every rule.
//   npx tsx demo.ts
//
// The bot demonstrates the new economy: resources are bought (pay-to-acquire)
// then played for free; action cards are pulled blind off a stack for free and
// paid for when played.
// =============================================================================
import {
  createGame, reduce, setCatalog, viewFor, def, canAfford,
  type GameState, type Action, type PlayerId,
} from './engine.js';
import { CATALOG, SETUP } from './catalog.js';

setCatalog(CATALOG);

let s: GameState = createGame('demo', [
  { id: 'A', name: 'Io Colony', retentionDays: 30 },
  { id: 'B', name: 'Europa Colony', retentionDays: 7 },
], SETUP, 12345);

const apply = (pid: PlayerId, a: Action) => { s = reduce(s, { playerId: pid, now: 0 }, a); };

// --- helpers over the live state (a god-view bot; the engine stays authoritative) ---
const handCards = (pid: PlayerId) => Object.values(s.instances).filter((i) => i.controller === pid && i.zone === 'hand');
const myAttackers = (pid: PlayerId) =>
  Object.values(s.instances).filter((i) => i.controller === pid && i.zone === 'board' && !i.tapped && i.active
    && (def(i).stats?.attack ?? 0) > 0);
const opponentsOf = (pid: PlayerId) => s.turnOrder.filter((p) => p !== pid && s.players[p].integrity > 0);
const ownCore = (p: PlayerId) => Object.values(s.instances).some((i) => i.controller === p && i.zone === 'board' && def(i).kind === 'core');

function resolveGate() {
  while (s.pending) {
    const pid = s.pending.waitingOn[0];
    // block with a spare non-core permanent that can soak a hit, else take it
    const blocker = Object.values(s.instances).find((i) => i.controller === pid && i.zone === 'board' && !i.tapped && i.active
      && def(i).kind !== 'core' && (def(i).stats?.health ?? 0) > 0);
    const atkId = s.pending.attacks[0]?.attackerId;
    apply(pid, { type: 'respondToAttack', blocks: blocker && atkId ? [{ blockerId: blocker.id, attackerId: atkId }] : [] });
  }
}

function autoTurn(pid: PlayerId) {
  // ATTACK
  const atks = myAttackers(pid);
  const foe = opponentsOf(pid)[0];
  if (atks.length && foe) {
    apply(pid, { type: 'declareAttack', attacks: atks.map((a) => ({ attackerId: a.id, target: { player: foe } })) });
    resolveGate();
  }
  if (s.status !== 'playing') return; // combat may have ended the game
  apply(pid, { type: 'endPhase' }); // -> action

  // ACTION: play resources first (free → banks minerals/influence), then spend
  // those resources playing any affordable action cards; then try to score.
  for (const c of handCards(pid)) if (def(c).kind === 'resource') apply(pid, { type: 'playCard', instId: c.id });
  for (const c of handCards(pid)) {
    const d = def(c);
    if (d.kind === 'waste' || d.kind === 'resource') continue;
    apply(pid, { type: 'playCard', instId: c.id, chosen: [opponentsOf(pid)[0]] }); // engine rejects unaffordable
  }
  for (const fl of s.objectives.flavors) apply(pid, { type: 'scoreObjective', flavor: fl });
  if (s.status !== 'playing') return; // a capstone score may have ended the game
  apply(pid, { type: 'endPhase' }); // -> buy

  // BUY: upgrade resources when affordable, otherwise pull a free action card,
  // otherwise grab a free Carbon. Spend every available buy.
  const ownPerms = (p: PlayerId) => Object.values(s.instances).filter((i) => i.controller === p && i.zone === 'board' && def(i).kind !== 'core').length;
  const buyOnce = (): boolean => {
    const p = s.players[pid];
    if (s.status !== 'playing' || p.buys <= 0) return false;
    const actionKey = ['warfare:I', 'mercenary:I', 'structure:I', 'industrial:I', 'diplomacy:I', 'covert:I']
      .find((k) => s.supply[k]?.cards.length && s.supply[k].acquire === 'free');
    // Build a board first (free blind pulls), then upgrade the resource base.
    if (ownPerms(pid) < 4 && actionKey) { apply(pid, { type: 'buyCard', stackKey: actionKey }); return true; }
    const silicon = CATALOG.get('silicon')!;
    const compromise = CATALOG.get('compromise')!;
    if (s.supply['mineral:II']?.cards.length && canAfford(p, silicon.cost)) { apply(pid, { type: 'buyCard', stackKey: 'mineral:II' }); return true; }
    if (s.supply['influence:II']?.cards.length && canAfford(p, compromise.cost)) { apply(pid, { type: 'buyCard', stackKey: 'influence:II' }); return true; }
    if (actionKey) { apply(pid, { type: 'buyCard', stackKey: actionKey }); return true; }
    if (s.supply['mineral:I']?.cards.length) { apply(pid, { type: 'buyCard', stackKey: 'mineral:I' }); return true; }
    return false;
  };
  while (buyOnce()) { /* keep buying while buys remain */ }
  apply(pid, { type: 'endPhase' }); // -> cleanup
  apply(pid, { type: 'endTurn' });  // advance
}

// --- run ---
apply('A', { type: 'startGame' });
let guard = 0, lastRound = 0;
while (s.status === 'playing' && guard++ < 200) {
  if (s.round !== lastRound) {
    lastRound = s.round;
    const line = s.turnOrder.map((p) => {
      const pl = s.players[p];
      return `${p}: I${pl.integrity} L${pl.loyalty} obj[${pl.scored.length}]${ownCore(p) ? '' : ' (no core!)'}`;
    }).join('   |   ');
    console.log(`\n=== ROUND ${s.round} ===  ${line}  [directives: ${s.objectives.flavors.join(', ')}]`);
  }
  autoTurn(s.turnOrder[s.activeIndex]);
}

console.log('\n--------------------------- PLAY-BY-PLAY ---------------------------');
console.log(s.log.join('\n'));

console.log('\n--------------------------- FINAL STATE ----------------------------');
console.log('status:', s.status, '| winner:', s.winner ?? '(none — hit turn cap)', '| round:', s.round);
for (const p of s.turnOrder) {
  const v = viewFor(s, p);
  console.log(`\n${p} (${s.players[p].name}): integrity ${v.you.integrity}, loyalty ${v.you.loyalty}, objectives ${v.you.scored.length} [${v.you.scored.join(', ')}]`);
  console.log(`   minerals ${v.you.minerals}, influence ${v.you.influence}, buys ${v.you.buys}`);
  console.log(`   board: ${v.board.filter((b) => b.controller === p).map((b) => `${b.name}${b.tapped ? '(T)' : ''}`).join(', ')}`);
}
console.log('\nremaining stacks:', Object.values(s.supply).map((st) => `${st.key}×${st.cards.length}`).join(', '));
console.log('total log lines:', s.log.length, '| state version:', s.version);
