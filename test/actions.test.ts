// One or more tests per Action variant. Happy paths for playCard/buyCard/
// declareAttack/respondToAttack/scoreObjective live in economy/combat/objectives;
// this file covers startGame, activate, endPhase, endTurn, and the rejection paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, SETUP, createGame, step, newGame, newInst, instOf } from './helpers.js';
import type { GameState, PlayerId } from '../engine.js';

// The catalog has no cards with activated abilities, so register a couple of
// test-only ones. node runs each test file in its own process, so this Map
// mutation is isolated to this file; cards with no tier never enter buy stacks.
CATALOG.set('tapper', {
  id: 'tapper', name: 'Tapper', kind: 'permanent', category: 'founder', type: 'Enhancement',
  triggers: [{ on: 'onActivate', taps: true, effects: [{ op: 'modifyResource', target: { scope: 'self' }, resource: 'minerals', amount: 2 }] }],
});
CATALOG.set('coster', {
  id: 'coster', name: 'Coster', kind: 'permanent', category: 'founder', type: 'Enhancement',
  triggers: [{ on: 'onActivate', cost: { minerals: 1 }, effects: [{ op: 'modifyResource', target: { scope: 'self' }, resource: 'influence', amount: 1 }] }],
});

const PLAYERS = [{ id: 'A', name: 'A', retentionDays: 0 }, { id: 'B', name: 'B', retentionDays: 0 }];
const handCount = (s: GameState, p: PlayerId): number =>
  Object.values(s.instances).filter((i) => i.controller === p && i.zone === 'hand').length;

// --- startGame ---------------------------------------------------------------
test('startGame: moves lobby → playing and draws the opening hand', () => {
  const lobby = createGame('t', PLAYERS, SETUP, 1);
  assert.equal(lobby.status, 'lobby');
  const s = step(lobby, 'A', { type: 'startGame' });
  assert.equal(s.status, 'playing');
  assert.equal(handCount(s, 'A'), 5);
});

test('lobby guard: before startGame, no other action is allowed', () => {
  const lobby = createGame('t', PLAYERS, SETUP, 1);
  assert.equal(step(lobby, 'A', { type: 'endPhase' }), lobby); // rejected → original returned
});

// --- playCard rejections -----------------------------------------------------
test('playCard: a card not in your hand is rejected', () => {
  let s = newGame();
  const core = instOf(s, 'A', 'colony-core')!;
  s = step(s, 'A', { type: 'playCard', instId: core.id }); // on board, not hand
  assert.equal(s.instances[core.id].zone, 'board');
});

test('playCard: a non-active player cannot act', () => {
  const s = newGame();
  const anyB = Object.values(s.instances).find((i) => i.controller === 'B')!; // B hasn't refreshed yet
  assert.equal(step(s, 'B', { type: 'playCard', instId: anyB.id }), s);
});

// --- activate ----------------------------------------------------------------
test('activate: taps the source and resolves its effect', () => {
  let s = newGame();
  const t = newInst(s, 'tapper', 'A', 'board');
  s = step(s, 'A', { type: 'activate', instId: t.id, triggerIndex: 0 });
  assert.equal(s.players.A.minerals, 2);
  assert.equal(s.instances[t.id].tapped, true);
});

test('activate: a tapped source cannot be activated again', () => {
  let s = newGame();
  const t = newInst(s, 'tapper', 'A', 'board');
  s = step(s, 'A', { type: 'activate', instId: t.id, triggerIndex: 0 });
  const after = step(s, 'A', { type: 'activate', instId: t.id, triggerIndex: 0 });
  assert.equal(after.players.A.minerals, 2); // no second gain
});

test('activate: a non-onActivate trigger index is rejected', () => {
  const s = newGame();
  const core = instOf(s, 'A', 'colony-core')!; // has no triggers at all
  const r = step(s, 'A', { type: 'activate', instId: core.id, triggerIndex: 0 });
  assert.equal(r.players.A.minerals, 0);
});

test('activate: an unaffordable cost blocks it; once paid it resolves', () => {
  let s = newGame();
  const c = newInst(s, 'coster', 'A', 'board'); // onActivate cost {minerals:1} → +1 influence
  const blocked = step(s, 'A', { type: 'activate', instId: c.id, triggerIndex: 0 });
  assert.equal(blocked.players.A.influence, 0); // couldn't pay
  s.players.A.minerals = 1;
  const paid = step(s, 'A', { type: 'activate', instId: c.id, triggerIndex: 0 });
  assert.equal(paid.players.A.minerals, 0);
  assert.equal(paid.players.A.influence, 1);
});

// --- buyCard rejections (happy paths in economy.test.ts) ---------------------
test('buyCard: an empty stack is rejected', () => {
  const s = newGame();
  s.supply['warfare:I'].cards = [];
  const r = step(s, 'A', { type: 'buyCard', stackKey: 'warfare:I' });
  assert.equal(r.players.A.buys, 1); // buy not consumed
});

test('buyCard: an unknown stack key is rejected', () => {
  const s = newGame();
  const r = step(s, 'A', { type: 'buyCard', stackKey: 'nope:Z' });
  assert.equal(r.players.A.buys, 1);
});

// --- declareAttack rejections (happy paths in combat.test.ts) ---------------
test('declareAttack: nothing happens outside the attack phase', () => {
  let s = newGame();
  const u = newInst(s, 'retired-veterans', 'A', 'board');
  s = step(s, 'A', { type: 'endPhase' }); // action phase
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  assert.equal(s.pending, null);
});

test('declareAttack: you cannot attack a pact partner', () => {
  let s = newGame();
  const u = newInst(s, 'retired-veterans', 'A', 'board');
  s.pacts.push({ a: 'A', b: 'B', bindingRounds: 0, formedRound: 1 });
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  assert.equal(s.pending, null);
});

// --- respondToAttack ---------------------------------------------------------
test('respondToAttack: an Infiltrator attacker cannot be blocked', () => {
  let s = newGame();
  const u = newInst(s, 'retired-veterans', 'A', 'board'); // 2/2
  s.instances[u.id].granted.push('infiltrator');
  const blk = newInst(s, 'carbon-hull', 'B', 'board');
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  s = step(s, 'B', { type: 'respondToAttack', blocks: [{ blockerId: blk.id, attackerId: u.id }] });
  assert.equal(s.players.B.integrity, 18);          // block ignored → colony takes 2
  assert.equal(s.instances[blk.id].damage, 0);      // blocker untouched
});

test('respondToAttack: only the waiting defender may respond', () => {
  let s = newGame();
  const u = newInst(s, 'retired-veterans', 'A', 'board');
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  assert.equal(step(s, 'A', { type: 'respondToAttack', blocks: [] }), s); // attacker frozen
});

// --- endPhase / endTurn ------------------------------------------------------
test('endPhase: walks attack → action → buy → cleanup and runs cleanup', () => {
  let s = newGame();
  assert.equal(s.phase, 'attack');
  s = step(s, 'A', { type: 'endPhase' }); assert.equal(s.phase, 'action');
  s = step(s, 'A', { type: 'endPhase' }); assert.equal(s.phase, 'buy');
  newInst(s, 'carbon', 'A', 'hand'); // push hand to 6 (over hand size 5)
  s = step(s, 'A', { type: 'endPhase' });
  assert.equal(s.phase, 'cleanup');
  assert.equal(handCount(s, 'A'), 5); // cleanup discarded the surplus
});

test('endTurn: passes to the next player and refreshes their hand', () => {
  let s = newGame();
  s = step(s, 'A', { type: 'endTurn' });
  assert.equal(s.turnOrder[s.activeIndex], 'B');
  assert.equal(s.round, 1);
  assert.equal(s.phase, 'attack');
  assert.equal(handCount(s, 'B'), 5);
});

test('endTurn: the round advances when play wraps back to the first seat', () => {
  let s = newGame();
  s = step(s, 'A', { type: 'endTurn' });
  s = step(s, 'B', { type: 'endTurn' });
  assert.equal(s.turnOrder[s.activeIndex], 'A');
  assert.equal(s.round, 2);
});
