// One behaviour test per card kind / permanent flavor (resource, operation,
// battery, unit, fortification, enhancement, doctrine, core, waste).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step, newInst } from './helpers.js';

test('resource: free to play, banks resources, cycles to discard', () => {
  let s = newGame();
  const c = newInst(s, 'titanium', 'A', 'hand'); // Gain 3 Minerals
  s = step(s, 'A', { type: 'playCard', instId: c.id });
  assert.equal(s.players.A.minerals, 3);
  assert.equal(s.instances[c.id].zone, 'discard');
});

test('operation: applies its onPlay effects then goes to discard', () => {
  let s = newGame();
  s.players.A.minerals = 5;
  const c = newInst(s, 'repair', 'A', 'hand'); // cost {min1,wild1}: +2 Integrity, +1 Mineral
  s = step(s, 'A', { type: 'playCard', instId: c.id });
  assert.equal(s.players.A.integrity, 22);
  assert.equal(s.instances[c.id].zone, 'discard');
});

test('battery permanent: enters play and produces power at the next Refresh', () => {
  let s = newGame();
  s.players.A.minerals = 5;
  const c = newInst(s, 'battery-unit', 'A', 'hand'); // cost {wild5}, +2 power
  s = step(s, 'A', { type: 'playCard', instId: c.id });
  assert.equal(s.instances[c.id].zone, 'board');
  s = step(s, 'A', { type: 'endTurn' });
  s = step(s, 'B', { type: 'endTurn' }); // back to A → Refresh
  assert.equal(s.players.A.energy, 3); // Core 1 + battery 2
});

test('unit permanent: enters play marked summoned (cannot attack the same turn)', () => {
  let s = newGame();
  s.players.A.minerals = 6;
  const c = newInst(s, 'kinetic-riflemen', 'A', 'hand'); // 2/3, cost {min2,wild2}
  s = step(s, 'A', { type: 'playCard', instId: c.id });
  assert.equal(s.instances[c.id].zone, 'board');
  assert.equal(s.instances[c.id].summonedThisTurn, true);
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: c.id, target: { player: 'B' } }] });
  assert.equal(s.pending, null); // summoning sickness blocks it
});

test('fortification: attack 0 cannot be declared as an attacker', () => {
  let s = newGame();
  const f = newInst(s, 'carbon-hull', 'A', 'board'); // 0/3
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: f.id, target: { player: 'B' } }] });
  assert.equal(s.pending, null);
});

test('fortification: can block and soak combat damage', () => {
  let s = newGame();
  s = step(s, 'A', { type: 'endTurn' }); // hand turn to B
  const atk = newInst(s, 'retired-veterans', 'B', 'board'); // 2/2
  const fort = newInst(s, 'carbon-hull', 'A', 'board');     // 0/3
  s = step(s, 'B', { type: 'declareAttack', attacks: [{ attackerId: atk.id, target: { player: 'A' } }] });
  s = step(s, 'A', { type: 'respondToAttack', blocks: [{ blockerId: fort.id, attackerId: atk.id }] });
  assert.equal(s.players.A.integrity, 20);          // colony shielded by the block
  assert.equal(s.instances[fort.id].zone, 'board'); // 3hp soaks 2 damage
  assert.equal(s.instances[fort.id].damage, 2);
  assert.equal(s.instances[atk.id].zone, 'board');  // fort deals 0 back
});

test('enhancement: passive storage + buy bonuses apply at Refresh', () => {
  let s = newGame();
  s.players.A.minerals = 6;
  const c = newInst(s, 'resource-silos', 'A', 'hand'); // +2 storage, +2 buys, upkeep 1
  s = step(s, 'A', { type: 'playCard', instId: c.id });
  s = step(s, 'A', { type: 'endTurn' });
  s = step(s, 'B', { type: 'endTurn' });
  assert.equal(s.players.A.storage, 3); // base 1 + 2
  assert.equal(s.players.A.buys, 3);    // base 1 + 2
});

test('enhancement: hand-size bonus raises the draw target', () => {
  let s = newGame();
  s.players.A.minerals = 6;
  const c = newInst(s, 'satellite-comms', 'A', 'hand'); // +1 handsize, upkeep 1
  s = step(s, 'A', { type: 'playCard', instId: c.id });
  s = step(s, 'A', { type: 'endTurn' });
  s = step(s, 'B', { type: 'endTurn' });
  assert.equal(s.players.A.handSize, 6);
});

test('doctrine: pays its play cost and stays on the board', () => {
  let s = newGame();
  s.players.A.influence = 9;
  const c = newInst(s, 'colony-of-progress', 'A', 'hand'); // cost {inf3, wild4}
  s = step(s, 'A', { type: 'playCard', instId: c.id });
  assert.equal(s.instances[c.id].zone, 'board');
  assert.equal(s.players.A.influence, 2); // 9 - 3 - 4
});

test('core: the Colony Core produces its base power each turn', () => {
  const s = newGame();
  assert.equal(s.players.A.energy, 1); // core produces 1, no upkeep
});

test('waste: a Waste card cannot be played', () => {
  let s = newGame();
  const w = newInst(s, 'slum', 'A', 'hand');
  s = step(s, 'A', { type: 'playCard', instId: w.id });
  assert.equal(s.instances[w.id].zone, 'hand'); // rejected, still in hand
});
