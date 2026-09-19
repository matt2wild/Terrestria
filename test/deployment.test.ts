// =============================================================================
// test/deployment.test.ts — the strategic-placement layer (deployment lanes).
//
// Permanents sit in the front-line VANGUARD (can attack, block, be targeted) or
// the rear SUPPORT line (protected: none of those). The default lane reproduces
// the pre-lane behavior — stats-bearing cards start in the vanguard — so the
// only new behavior appears once a card is repositioned or deployed to support.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step, newInst } from './helpers.js';
import { laneOf } from '../engine.js';

test('default lanes: stats-bearing cards hold the vanguard, statless sit in support', () => {
  const s = newGame();
  const unit = newInst(s, 'retired-veterans', 'A', 'board');   // 2/2 unit
  const fort = newInst(s, 'carbon-hull', 'A', 'board');        // 0/3 fortification
  const batt = newInst(s, 'solar-power-grid', 'A', 'board');   // battery, no stats
  const core = newInst(s, 'colony-core', 'A', 'board');
  assert.equal(laneOf(s.instances[unit.id]), 'vanguard');
  assert.equal(laneOf(s.instances[fort.id]), 'vanguard');
  assert.equal(laneOf(s.instances[batt.id]), 'support');
  assert.equal(laneOf(s.instances[core.id]), null, 'the Core holds no lane');
});

test('reposition moves a unit between lanes on your turn', () => {
  let s = newGame();
  const u = newInst(s, 'retired-veterans', 'A', 'board');
  s = step(s, 'A', { type: 'reposition', instId: u.id, lane: 'support' });
  assert.equal(laneOf(s.instances[u.id]), 'support');
  s = step(s, 'A', { type: 'reposition', instId: u.id, lane: 'vanguard' });
  assert.equal(laneOf(s.instances[u.id]), 'vanguard');
});

test('you cannot reposition on an opponent’s turn', () => {
  let s = newGame(); // A active
  const u = newInst(s, 'retired-veterans', 'B', 'board');
  s = step(s, 'B', { type: 'reposition', instId: u.id, lane: 'support' });
  assert.equal(laneOf(s.instances[u.id]), 'vanguard', 'B is not the active player — rejected');
});

test('a SUPPORT unit cannot attack; moving it to the vanguard lets it', () => {
  let s = newGame();
  const u = newInst(s, 'retired-veterans', 'A', 'board');
  s = step(s, 'A', { type: 'reposition', instId: u.id, lane: 'support' });
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  assert.equal(s.pending, null, 'a backline unit cannot be declared as an attacker');
  s = step(s, 'A', { type: 'reposition', instId: u.id, lane: 'vanguard' });
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  assert.ok(s.pending, 'once in the vanguard it can attack');
});

test('a SUPPORT unit cannot block — the hit lands on the colony', () => {
  let s = newGame();                                   // A active, attacks B
  const atk = newInst(s, 'retired-veterans', 'A', 'board'); // 2/2
  const shelter = newInst(s, 'carbon-hull', 'B', 'board');  // 0/3 fort
  s.instances[shelter.id].pos = { lane: 'support', slot: 0 }; // B sheltered it earlier
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: atk.id, target: { player: 'B' } }] });
  s = step(s, 'B', { type: 'respondToAttack', blocks: [{ blockerId: shelter.id, attackerId: atk.id }] });
  assert.equal(s.players.B.integrity, 18, 'the support unit could not intercept — colony took 2');
  assert.equal(s.instances[shelter.id].damage, 0, 'the sheltered unit took no combat damage');
});

test('a vanguard fort CAN still block (unchanged default behavior)', () => {
  let s = newGame();
  const atk = newInst(s, 'retired-veterans', 'A', 'board'); // 2/2
  const wall = newInst(s, 'carbon-hull', 'B', 'board');     // 0/3, default vanguard
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: atk.id, target: { player: 'B' } }] });
  s = step(s, 'B', { type: 'respondToAttack', blocks: [{ blockerId: wall.id, attackerId: atk.id }] });
  assert.equal(s.players.B.integrity, 20, 'the wall intercepted the hit');
  assert.equal(s.instances[wall.id].damage, 2, 'the wall took the 2 damage');
});

test('only VANGUARD enemies are targetable by an attack', () => {
  let s = newGame();
  const atk = newInst(s, 'retired-veterans', 'A', 'board');
  const back = newInst(s, 'carbon-hull', 'B', 'board');
  s.instances[back.id].pos = { lane: 'support', slot: 0 };
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: atk.id, target: { instId: back.id } }] });
  assert.equal(s.pending, null, 'a backline enemy cannot be targeted directly');
  const front = newInst(s, 'carbon-hull', 'B', 'board'); // default vanguard
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: atk.id, target: { instId: front.id } }] });
  assert.ok(s.pending, 'a front-line enemy is a legal target');
});

test('deploying via playCard records the lane (defaulted, and explicitly chosen)', () => {
  let s = newGame();
  s.players.A.minerals = 99; s.players.A.influence = 99;
  s = step(s, 'A', { type: 'endPhase' }); // → action phase, where permanents are played
  // default: a unit lands in the vanguard
  const u = newInst(s, 'retired-veterans', 'A', 'hand');
  s = step(s, 'A', { type: 'playCard', instId: u.id });
  assert.equal(laneOf(s.instances[u.id]), 'vanguard');
  // explicit: deploy a second unit straight into support
  const u2 = newInst(s, 'retired-veterans', 'A', 'hand');
  s = step(s, 'A', { type: 'playCard', instId: u2.id, lane: 'support' });
  assert.equal(laneOf(s.instances[u2.id]), 'support');
});
