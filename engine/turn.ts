// =============================================================================
// engine/turn.ts — turn-boundary bookkeeping: Refresh (untap, produce energy,
// pay upkeep, reset buys, draw) and Cleanup (discard to hand size, drop surplus).
// =============================================================================
import type { GameState } from './types.js';
import { def, active, ownBoard, log, START } from './core.js';
import { upkeepOf } from './keywords.js';
import { draw } from './zones.js';
import { dispatch } from './effects.js';

export function refresh(s: GameState): void {
  const p = active(s);
  for (const c of ownBoard(s, p.id)) { c.tapped = false; c.summonedThisTurn = false; }
  p.handSize = START.handSize; p.storage = START.storage; p.buys = START.buys;
  let produced = 0;
  for (const c of ownBoard(s, p.id)) {
    produced += def(c).produces ?? 0;
    p.handSize += def(c).handBonus ?? 0;
    p.storage += def(c).storageBonus ?? 0;
    p.buys += def(c).buyBonus ?? 0;
  }
  p.energy = produced;
  // pay upkeep; brown out the costliest permanents if short
  let demand = ownBoard(s, p.id).reduce((a, c) => a + upkeepOf(s, c), 0);
  for (const c of ownBoard(s, p.id)) c.active = true;
  if (demand > p.energy) {
    const payers = ownBoard(s, p.id).filter((c) => upkeepOf(s, c) > 0).sort((a, b) => upkeepOf(s, b) - upkeepOf(s, a));
    for (const c of payers) { if (demand <= p.energy) break; c.active = false; demand -= upkeepOf(s, c); log(s, `${def(c).name} browns out (low power)`); }
  }
  p.energy -= Math.min(demand, p.energy);
  p.generatedThisTurn = 0; p.damageDealtThisTurn = 0;
  draw(s, p.id, p.handSize - Object.values(s.instances).filter((x) => x.controller === p.id && x.zone === 'hand').length);
  dispatch(s, 'startOfYourTurn', p.id);
}

export function runCleanup(s: GameState): void {
  const p = active(s);
  const hand = Object.values(s.instances).filter((x) => x.controller === p.id && x.zone === 'hand');
  for (let i = p.handSize; i < hand.length; i++) hand[i].zone = 'discard';
  for (const c of ownBoard(s, p.id)) if (c.damage < 0) c.damage = 0;
  for (const r of ['minerals', 'influence', 'energy'] as const) (p as any)[r] = Math.min((p as any)[r], p.storage);
}
