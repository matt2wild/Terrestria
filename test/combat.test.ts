import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step, newInst } from './helpers.js';

test('unblocked attacker reduces the defender colony integrity', () => {
  let s = newGame();
  const u = newInst(s, 'retired-veterans', 'A', 'board'); // 2/2
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  assert.ok(s.pending, 'gate opens, B must respond');
  s = step(s, 'B', { type: 'respondToAttack', blocks: [] }); // take the hit
  assert.equal(s.players.B.integrity, 18);
  assert.equal(s.pending, null, 'combat resolved');
});

test('blocking: attacker and blocker trade combat damage', () => {
  let s = newGame();
  const atk = newInst(s, 'avion-bike-squadron', 'A', 'board'); // 3/1
  const blk = newInst(s, 'retired-veterans', 'B', 'board');    // 2/2
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: atk.id, target: { player: 'B' } }] });
  s = step(s, 'B', { type: 'respondToAttack', blocks: [{ blockerId: blk.id, attackerId: atk.id }] });
  assert.equal(s.instances[blk.id].zone, 'discard', 'blocker (2hp) dies to 3 damage');
  assert.equal(s.instances[atk.id].zone, 'discard', 'attacker (1hp) dies to 2 damage back');
  assert.equal(s.players.B.integrity, 20, 'colony took no damage — it was blocked');
});

test('dispossession: integrity to 0 transfers the Core and resets integrity', () => {
  let s = newGame();
  const u = newInst(s, 'kinetic-riflemen', 'A', 'board'); // 2/3
  s.players.B.integrity = 2;
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  s = step(s, 'B', { type: 'respondToAttack', blocks: [] });
  const bHasCore = Object.values(s.instances).some((i) => i.controller === 'B' && i.defId === 'colony-core');
  const aCores = Object.values(s.instances).filter((i) => i.controller === 'A' && i.defId === 'colony-core').length;
  assert.equal(bHasCore, false, 'B lost its Core');
  assert.equal(aCores, 2, 'A now holds both Cores');
  assert.equal(s.players.B.integrity, 10, 'victim integrity resets to recovery value');
  assert.equal(s.status, 'finished', 'last Core standing ends the game');
  assert.equal(s.winner, 'A');
});

test('summoning sickness: a freshly played non-rush unit cannot attack', () => {
  let s = newGame();
  const u = newInst(s, 'retired-veterans', 'A', 'board');
  s.instances[u.id].summonedThisTurn = true; // just played this turn
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  assert.equal(s.pending, null, 'no gate — the attack was filtered out');
});

test('rush lets a unit attack the turn it lands', () => {
  let s = newGame();
  const u = newInst(s, 'avion-bike-squadron', 'A', 'board'); // has "rush"
  s.instances[u.id].summonedThisTurn = true;
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  assert.ok(s.pending, 'rush unit may attack immediately');
});
