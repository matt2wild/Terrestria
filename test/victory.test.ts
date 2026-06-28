// Victory conditions: the Finisher win, last-Core-standing, and the multiplayer
// comeback rule (dispossession doesn't end the game while others hold a Core).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed } from '../engine.js';
import { newGame, newGameDir, step, newInst, instOf, createGame, SETUP } from './helpers.js';

const THREE = [
  { id: 'A', name: 'A', retentionDays: 0 },
  { id: 'B', name: 'B', retentionDays: 0 },
  { id: 'C', name: 'C', retentionDays: 0 },
];
const coresOf = (s: ReturnType<typeof newGame>, p: string) =>
  Object.values(s.instances).filter((i) => i.controller === p && i.zone === 'board' && i.defId.endsWith('colony-core')).length;

test('Finisher: completing a directive Finisher wins, and a finished game rejects all actions', () => {
  let s = newGameDir(['prosperity', 'supremacy', 'development']);
  s.players.A.directiveTier.prosperity = 2; // cleared I & II → Finisher is the next rung
  s.players.A.generatedThisTurn = 12;        // Prosperity Finisher: produce 12+
  s = step(s, 'A', { type: 'scoreObjective', flavor: 'prosperity' });
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, 'A');
  assert.equal(isAllowed(s, { playerId: 'A', now: 0 }, { type: 'endPhase' }), false);
  assert.equal(step(s, 'A', { type: 'endTurn' }), s); // unchanged: reduce returns the finished state
  assert.equal(s.winner, 'A');
});

test('last Core standing: losing your only Core hands the win to the survivor', () => {
  let s = newGame();
  instOf(s, 'B', 'colony-core')!.zone = 'discard'; // B loses its Core
  s = step(s, 'A', { type: 'endPhase' });           // end-of-reduce check fires
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, 'A');
});

test('comeback: in 3 players, dispossession does not end the game while others hold Cores', () => {
  let s = createGame('t3', THREE, SETUP, 1);
  s = step(s, 'A', { type: 'startGame' });
  const u = newInst(s, 'kinetic-riflemen', 'A', 'board'); // 2/3
  s.players.B.integrity = 2;
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  s = step(s, 'B', { type: 'respondToAttack', blocks: [] });
  assert.equal(s.status, 'playing');        // C still holds a Core → no winner yet
  assert.equal(coresOf(s, 'B'), 0);          // B was dispossessed
  assert.equal(coresOf(s, 'A'), 2);          // A holds its own + B's seized Core
  assert.equal(s.players.B.integrity, 10);   // integrity reset to recovery value
});

test('the real penalty of dispossession: a colony without a Core cannot score', () => {
  let s = createGame('t3', THREE, SETUP, 1);
  s = step(s, 'A', { type: 'startGame' });
  instOf(s, 'A', 'colony-core')!.zone = 'discard'; // A has no Core (B & C still do → game continues)
  s.players.A.destroyedCount = 1; s.players.A.minerals = 9; s.players.A.influence = 9;
  s = step(s, 'A', { type: 'scoreObjective', flavor: 'domination' });
  assert.equal(s.status, 'playing');
  assert.equal(s.players.A.scored.length, 0); // rejected: no Core to tap
});
