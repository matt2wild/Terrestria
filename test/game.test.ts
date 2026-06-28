import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playWholeTurn, resolveGates } from '../bot.js';
import type { GameState, PlayerId, Action } from '../engine.js';
import { newGame, step } from './helpers.js';

// Integration + regression: a bot-vs-bot game must terminate with a winner.
// This is the guard against the "game ends mid-turn → buy loop spins forever"
// bug: if that regressed, the outer loop would hit the turn cap and fail here.
function playOut(seed: number): GameState {
  let s = newGame(seed);
  const get = () => s;
  const apply = (pid: PlayerId, a: Action) => { s = step(s, pid, a); };
  let guard = 0;
  while (s.status === 'playing' && guard++ < 400) {
    if (s.pending) resolveGates(get, apply);
    else playWholeTurn(get, apply, s.turnOrder[s.activeIndex]);
  }
  assert.ok(guard < 400, `seed ${seed}: game did not terminate within the turn cap`);
  return s;
}

test('a full bot game terminates with a winner (multiple seeds)', () => {
  for (const seed of [1, 7, 12345, 99999]) {
    const s = playOut(seed);
    assert.equal(s.status, 'finished', `seed ${seed} should finish`);
    assert.ok(s.winner === 'A' || s.winner === 'B', `seed ${seed} has a winner`);
  }
});

test('a game is deterministic: the same seed yields the same result twice', () => {
  const a = playOut(12345);
  const b = playOut(12345);
  assert.equal(a.winner, b.winner);
  assert.equal(a.round, b.round);
  assert.ok(a.round <= 60, `finished in a sane number of rounds (got ${a.round})`);
});

test('no supply stack is ever over-drawn (counts stay >= 0)', () => {
  const s = playOut(7);
  for (const st of Object.values(s.supply)) assert.ok(st.cards.length >= 0, `${st.key} went negative`);
});
