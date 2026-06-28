// Multi-turn flow invariants: deck recycling, the Storage carry-over rule,
// Loyalty persistence, permanent persistence, and per-turn buy reset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step, newInst } from './helpers.js';
import type { GameState, PlayerId } from '../engine.js';

const count = (s: GameState, p: PlayerId, zone: string): number =>
  Object.values(s.instances).filter((i) => i.controller === p && i.zone === zone).length;

test('deck recycles: an empty deck reshuffles the discard pile on draw', () => {
  let s = newGame();
  for (const i of Object.values(s.instances)) if (i.controller === 'A' && i.zone !== 'board') i.zone = 'discard';
  assert.equal(count(s, 'A', 'deck'), 0);
  s = step(s, 'A', { type: 'endTurn' });
  s = step(s, 'B', { type: 'endTurn' }); // back to A → Refresh draws 5 from the reshuffled pile
  assert.equal(count(s, 'A', 'hand'), 5);
  assert.equal(count(s, 'A', 'deck'), 9);    // 14 cycled in, 5 drawn
  assert.equal(count(s, 'A', 'discard'), 0);
});

test('cleanup: per-turn resources are capped to Storage; Loyalty is exempt', () => {
  let s = newGame(); // Storage base 1
  Object.assign(s.players.A, { minerals: 5, influence: 5, energy: 5, loyalty: 5 });
  s = step(s, 'A', { type: 'endPhase' }); // action
  s = step(s, 'A', { type: 'endPhase' }); // buy
  s = step(s, 'A', { type: 'endPhase' }); // cleanup → runCleanup
  assert.equal(s.players.A.minerals, 1);
  assert.equal(s.players.A.influence, 1);
  assert.equal(s.players.A.energy, 1);
  assert.equal(s.players.A.loyalty, 5); // intrinsic — never capped
});

test('Loyalty persists across turns (Refresh does not reset it)', () => {
  let s = newGame();
  s.players.A.loyalty = 7;
  s = step(s, 'A', { type: 'endTurn' });
  s = step(s, 'B', { type: 'endTurn' }); // A refreshed
  assert.equal(s.players.A.loyalty, 7);
});

test('permanents persist; summoning sickness clears at your next Refresh', () => {
  let s = newGame();
  const u = newInst(s, 'retired-veterans', 'A', 'board');
  s.instances[u.id].summonedThisTurn = true; // as if just played
  s = step(s, 'A', { type: 'endTurn' });
  s = step(s, 'B', { type: 'endTurn' });      // A refreshed
  assert.equal(s.instances[u.id].zone, 'board');         // still in play
  assert.equal(s.instances[u.id].summonedThisTurn, false);
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  assert.ok(s.pending); // now it can attack
});

test('buys reset each turn rather than accumulating', () => {
  let s = newGame();
  assert.equal(s.players.A.buys, 1);
  s = step(s, 'A', { type: 'buyCard', stackKey: 'mineral:I' }); // spend the buy
  assert.equal(s.players.A.buys, 0);
  s = step(s, 'A', { type: 'endTurn' });
  s = step(s, 'B', { type: 'endTurn' }); // A refreshed
  assert.equal(s.players.A.buys, 1);     // back to base
});
