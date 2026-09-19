// =============================================================================
// engine/reducer.ts — authorization + the single pure reducer. Every state
// transition flows through reduce(); it clones, validates, and dispatches to the
// focused modules (effects, combat, objectives, turn).
// =============================================================================
import type { GameState, Ctx, Action } from './types.js';
import { def, active, ownBoard, log, newInst, cat, PHASES, laneOf, laneCount } from './core.js';
import { canAfford, payCost, chargedAtBuy } from './cost.js';
import { hasKw } from './keywords.js';
import { applyEffect, tickIncubation } from './effects.js';
import { inPact } from './zones.js';
import { openGate, resolveCombat } from './combat.js';
import { scoreObjective } from './objectives.js';
import { refresh, runCleanup } from './turn.js';

export function isAllowed(s: GameState, ctx: Ctx, a: Action): boolean {
  if (s.status === 'finished') return false;
  if (s.status === 'lobby') return a.type === 'startGame';
  if (s.pending) return a.type === 'respondToAttack' && s.pending.waitingOn.includes(ctx.playerId);
  if (a.type === 'respondToAttack') return false;
  return ctx.playerId === active(s).id;
}

export function reduce(s0: GameState, ctx: Ctx, a: Action): GameState {
  const s: GameState = structuredClone(s0); s.version++;
  if (!isAllowed(s, ctx, a)) return s0; // reject without bumping
  const p = s.players[ctx.playerId];

  switch (a.type) {
    case 'startGame': s.status = 'playing'; refresh(s); break;

    case 'playCard': {
      const c = s.instances[a.instId];
      if (!c || c.controller !== ctx.playerId || c.zone !== 'hand') break;
      const d = def(c);
      if (d.kind === 'waste') { log(s, `${d.name} cannot be played`); break; }
      // Resources are FREE to play; everything else pays its cost now.
      const playCost = chargedAtBuy(d) ? undefined : d.cost;
      if (!canAfford(p, playCost)) break;
      payCost(p, playCost);
      const staysInPlay = d.kind === 'permanent' || d.kind === 'core' || d.kind === 'colony';
      c.zone = staysInPlay ? 'board' : 'discard'; // resources & operations cycle to discard
      c.summonedThisTurn = true;
      // deploy permanents into a lane — chosen, or defaulted by card kind
      if (staysInPlay && d.kind !== 'core' && d.kind !== 'colony') {
        const lane = a.lane ?? (d.stats ? 'vanguard' : 'support');
        c.pos = { lane, slot: laneCount(s, ctx.playerId, lane) };
      }
      for (const tr of d.triggers ?? []) if (tr.on === 'onPlay')
        for (const e of tr.effects) applyEffect(s, ctx, c, e, a.chosen, a.mode);
      log(s, `${p.id} plays ${d.name}`);
      break;
    }

    case 'reposition': {
      const c = s.instances[a.instId];
      if (!c || c.controller !== ctx.playerId || c.zone !== 'board') break;
      const d = def(c);
      if (d.kind === 'core' || d.kind === 'colony') break; // the Core/Colony hold no lane
      c.pos = { lane: a.lane, slot: laneCount(s, ctx.playerId, a.lane) };
      log(s, `${p.id} redeploys ${d.name} to ${a.lane === 'vanguard' ? 'the Vanguard' : 'Support'}`);
      break;
    }

    case 'activate': {
      const c = s.instances[a.instId];
      if (!c || c.controller !== ctx.playerId || c.zone !== 'board' || c.tapped || !c.active) break;
      const tr = def(c).triggers?.[a.triggerIndex]; if (!tr || tr.on !== 'onActivate') break;
      if (!canAfford(p, tr.cost)) break;
      payCost(p, tr.cost);
      if (tr.taps) c.tapped = true;
      for (const e of tr.effects) applyEffect(s, ctx, c, e, a.chosen, a.mode);
      log(s, `${p.id} activates ${def(c).name}`);
      break;
    }

    case 'buyCard': {
      const stack = s.supply[a.stackKey];
      if (!stack || stack.cards.length === 0) break;
      if (p.buys <= 0) { log(s, `${p.id} has no buys left`); break; }
      const defId = stack.cards[stack.cards.length - 1]; // top = last (random order)
      const d = cat().get(defId)!;
      // Resource stacks charge the cost now; action stacks are free to acquire.
      const buyCost = stack.acquire === 'pay' ? d.cost : undefined;
      if (!canAfford(p, buyCost)) break;
      payCost(p, buyCost);
      stack.cards.pop();
      p.buys -= 1;
      newInst(s, defId, ctx.playerId, 'discard');
      log(s, `${p.id} buys ${d.name} from ${a.stackKey}${stack.blind ? ' (blind)' : ''}`);
      break;
    }

    case 'declareAttack': {
      if (s.phase !== 'attack') break;
      // attackers must be untapped, active, own vanguard units that aren't summoning-sick
      const valid = a.attacks.filter((x) => { const at = s.instances[x.attackerId]; return at && at.controller === ctx.playerId && at.zone === 'board' && laneOf(at) === 'vanguard' && !at.tapped && at.active && (def(at).stats?.attack ?? 0) > 0 && !(at.summonedThisTurn && !hasKw(s, at, 'rush') && !hasKw(s, at, 'rapid')); });
      const filtered = valid.filter((x) => {
        if (x.target.player && inPact(s, ctx.playerId, x.target.player)) return false;   // pact: can't attack a partner
        if (x.target.instId) { const t = s.instances[x.target.instId]; if (!t || laneOf(t) !== 'vanguard') return false; } // only front-line enemies are targetable
        return true;
      });
      if (filtered.length) openGate(s, filtered);
      break;
    }

    case 'respondToAttack': {
      const g = s.pending!;
      const legal = a.blocks.filter((b) => { const bl = s.instances[b.blockerId]; const at = s.instances[b.attackerId]; return bl && bl.controller === ctx.playerId && bl.zone === 'board' && laneOf(bl) === 'vanguard' && !bl.tapped && bl.active && at && !hasKw(s, at, 'infiltrator') && !hasKw(s, at, 'ghost'); });
      g.blocks[ctx.playerId] = legal;
      g.waitingOn = g.waitingOn.filter((x) => x !== ctx.playerId);
      log(s, `${ctx.playerId} responds (${legal.length} block(s))`);
      if (g.waitingOn.length === 0) resolveCombat(s);
      break;
    }

    case 'scoreObjective': scoreObjective(s, p, a.flavor); break;

    case 'endPhase': {
      s.phase = PHASES[(PHASES.indexOf(s.phase) + 1) % PHASES.length];
      if (s.phase === 'cleanup') runCleanup(s);
      break;
    }

    case 'endTurn': {
      if (s.phase !== 'cleanup') runCleanup(s);
      s.activeIndex = (s.activeIndex + 1) % s.turnOrder.length;
      if (s.activeIndex === 0) { s.round++; tickIncubation(s); for (const pl of Object.values(s.players)) { pl.lostPermThisRound = false; pl.attackedThisRound = false; } for (const pc of s.pacts) pc.bindingRounds++; }
      s.phase = 'attack';
      if (s.status !== 'finished') refresh(s);
      break;
    }
  }
  if (s.status !== 'finished' && Object.values(s.players).filter((pl) => ownBoard(s, pl.id).some((i) => def(i).kind === 'core')).length === 1) {
    const last = Object.values(s.players).find((pl) => ownBoard(s, pl.id).some((i) => def(i).kind === 'core'))!;
    if (s.turnOrder.length > 1) { s.status = 'finished'; s.winner = last.id; log(s, `🏆 ${last.id} WINS (last Core standing)`); }
  }
  return s;
}
