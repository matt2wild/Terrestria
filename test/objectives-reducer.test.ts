import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed } from '../engine.js';
import { newGame, step, newInst } from './helpers.js';

// Objective scoring is covered in objectives.test.ts; this file covers the
// reducer's authorization and refresh/upkeep bookkeeping.

// ---- authorization ----------------------------------------------------------

test('isAllowed: only the active player may act', () => {
  const s = newGame();
  assert.equal(isAllowed(s, { playerId: 'A', now: 0 }, { type: 'endPhase' }), true);
  assert.equal(isAllowed(s, { playerId: 'B', now: 0 }, { type: 'endPhase' }), false);
});

test('isAllowed: during a gate only the waiting defender may respond', () => {
  let s = newGame();
  const u = newInst(s, 'retired-veterans', 'A', 'board');
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  assert.ok(s.pending);
  assert.equal(isAllowed(s, { playerId: 'B', now: 0 }, { type: 'respondToAttack', blocks: [] }), true);
  assert.equal(isAllowed(s, { playerId: 'A', now: 0 }, { type: 'endPhase' }), false, 'attacker is frozen during the gate');
});

test('isAllowed: a finished game accepts nothing', () => {
  const s = { ...newGame(), status: 'finished' as const };
  assert.equal(isAllowed(s, { playerId: 'A', now: 0 }, { type: 'endPhase' }), false);
});

// ---- refresh / upkeep -------------------------------------------------------

test('refresh: produces energy, resets buys, and browns out underpowered permanents', () => {
  let s = newGame();
  newInst(s, 'battery-processor', 'A', 'board');    // +1 power (no storage/hand bonus)
  newInst(s, 'battery-processor', 'A', 'board');    // +1 power  → +2 total
  const h1 = newInst(s, 'starhawk', 'A', 'board');  // upkeep 2
  const h2 = newInst(s, 'kinetic-artillery', 'A', 'board'); // upkeep 2
  // advance A -> B -> A so A refreshes
  s = step(s, 'A', { type: 'endTurn' });
  s = step(s, 'B', { type: 'endTurn' });
  assert.equal(s.players.A.buys, 1, 'buys reset');
  assert.equal(s.players.A.storage, 1, 'storage reset to colony base');
  // energy = core(1) + battery(2) = 3; demand = 2 + 2 = 4 → exactly one heavy browns out
  const browned = [s.instances[h1.id].active, s.instances[h2.id].active].filter((a) => !a).length;
  assert.equal(browned, 1, 'one upkeep-2 permanent is deactivated');
  assert.equal(s.players.A.energy, 1, 'leftover energy after paying upkeep of 2');
});
