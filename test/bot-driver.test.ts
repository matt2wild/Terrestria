// =============================================================================
// test/bot-driver.test.ts — the server-driven CPU seat: adding a bot to a lobby
// and having it take its whole turn automatically after the human acts.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryGameStore } from '../server/store.js';
import { LobbyService, LobbyError } from '../server/lobby.js';

test('lobby: the host can add a CPU seat', async () => {
  const svc = new LobbyService(new MemoryGameStore());
  const { room, auth } = await svc.createRoom('Me');
  const r = await svc.addBot(room.code, auth.playerId, auth.token);
  assert.equal(r.players.length, 2);
  assert.ok(r.players.some((p) => p.isBot), 'a CPU player is present');
  assert.ok(r.canStart, 'a human + a CPU is enough to start');
});

test('lobby: only the host may add a CPU', async () => {
  const svc = new LobbyService(new MemoryGameStore());
  const { room, auth } = await svc.createRoom('Me');
  const guest = await svc.joinRoom(room.code, 'Guest');
  await assert.rejects(() => svc.addBot(room.code, guest.auth.playerId, guest.auth.token), LobbyError);
});

test('solo vs CPU: the CPU takes its whole turn automatically', async () => {
  const svc = new LobbyService(new MemoryGameStore());
  const { room, auth } = await svc.createRoom('Me');
  await svc.addBot(room.code, auth.playerId, auth.token);
  await svc.startGame(room.code, auth.playerId, auth.token);

  // Host (active first) ends the turn; the server should drive the CPU through
  // its whole turn and hand control straight back to the human.
  const view = await svc.submitAction(room.code, auth.playerId, auth.token, { type: 'endTurn' });
  assert.equal(view.activePlayer, auth.playerId, 'control returns to the human');
  assert.equal(view.yourTurn, true);
  assert.equal(view.round, 2, 'the CPU ended its turn, advancing to round 2');
});
