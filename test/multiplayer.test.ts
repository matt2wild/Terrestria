// =============================================================================
// test/multiplayer.test.ts — the lobby/networking layer: join codes, the store's
// optimistic concurrency + TTL, and the LobbyService lifecycle (create → join →
// start → act), auth enforcement, and stale-game reaping.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCode, normalizeCode, isWellFormedCode, makeToken, CODE_LENGTH } from '../server/codes.js';
import { MemoryGameStore, ConflictError, ConcurrencyError, type Room } from '../server/store.js';
import { LobbyService, AuthError, LobbyError } from '../server/lobby.js';

// ---- codes -----------------------------------------------------------------
test('codes: 6 chars from an unambiguous, well-formed alphabet', () => {
  for (let i = 0; i < 500; i++) {
    const c = makeCode();
    assert.equal(c.length, CODE_LENGTH);
    assert.ok(isWellFormedCode(c), `"${c}" should be well-formed`);
    assert.ok(!/[01OIL]/.test(c), `"${c}" must avoid ambiguous glyphs`);
  }
});

test('codes: normalizeCode strips whitespace and uppercases (lossless)', () => {
  assert.equal(normalizeCode(' ab c2 3 '), 'ABC23');
  assert.equal(normalizeCode('xyz789'), 'XYZ789');
});

test('codes: tokens are unique and non-trivial', () => {
  const a = makeToken(), b = makeToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 20);
});

// ---- store -----------------------------------------------------------------
function sampleRoom(code: string, now = 0): Room {
  return {
    code, hostId: 'h', phase: 'lobby',
    players: [{ id: 'h', name: 'Host', token: 't', isHost: true, joinedAt: now }],
    game: null, seed: 1, version: 0, createdAt: now, lastActivityAt: now, expiresAt: now + 1000,
  };
}

test('store: create rejects duplicate codes', async () => {
  const store = new MemoryGameStore();
  await store.create(sampleRoom('AAA111'));
  await assert.rejects(() => store.create(sampleRoom('AAA111')), ConflictError);
});

test('store: conditional put enforces optimistic concurrency', async () => {
  const store = new MemoryGameStore();
  await store.create(sampleRoom('BBB222'));      // stored at version 1
  const r1 = await store.get('BBB222');
  const r2 = await store.get('BBB222');          // a stale concurrent reader
  assert.ok(r1 && r2);
  await store.put({ ...r1!, seed: 99 });          // succeeds, bumps to version 2
  await assert.rejects(() => store.put({ ...r2!, seed: 77 }), ConcurrencyError); // stale write rejected
});

test('store: deleteExpired reaps only past-due rooms', async () => {
  const store = new MemoryGameStore();
  await store.create({ ...sampleRoom('OLD111'), expiresAt: 100 });
  await store.create({ ...sampleRoom('NEW222'), expiresAt: 5000 });
  const reaped = await store.deleteExpired(1000);
  assert.deepEqual(reaped, ['OLD111']);
  assert.equal(await store.get('OLD111'), null);
  assert.ok(await store.get('NEW222'));
});

// ---- lobby lifecycle -------------------------------------------------------
test('lobby: create → join → start runs the full flow', async () => {
  const lobby = new LobbyService(new MemoryGameStore());
  const { room, auth: host } = await lobby.createRoom('Io Colony');
  assert.equal(room.code.length, CODE_LENGTH);
  assert.equal(room.players.length, 1);
  assert.equal(room.canStart, false); // need 2

  const { auth: guest } = await lobby.joinRoom(room.code, 'Europa');
  const afterJoin = await lobby.getRoom(room.code);
  assert.equal(afterJoin.players.length, 2);
  assert.equal(afterJoin.canStart, true);

  const started = await lobby.startGame(room.code, host.playerId, host.token);
  assert.equal(started.phase, 'active');

  // both players get a hidden-info-filtered view
  const hostView = await lobby.getGameView(room.code, host.playerId, host.token);
  const guestView = await lobby.getGameView(room.code, guest.playerId, guest.token);
  assert.equal(hostView.status, 'playing');
  assert.equal(hostView.yourTurn, true);
  assert.equal(guestView.yourTurn, false);
  assert.equal(hostView.you.hand.length, 5);                 // active player refreshes to hand size
  assert.ok(Array.isArray(guestView.you.hand));              // guest draws on their own turn (count is opener-dependent)
  // opponents expose only a COUNT — never card identities — and it matches reality
  assert.equal(guestView.opponents[0].handCount, hostView.you.hand.length);
  assert.equal(hostView.opponents[0].handCount, guestView.you.hand.length);
  assert.equal((hostView.opponents[0] as any).hand, undefined);
});

test('lobby: only the host may start, and only with enough players', async () => {
  const lobby = new LobbyService(new MemoryGameStore());
  const { room, auth: host } = await lobby.createRoom('Host');
  await assert.rejects(() => lobby.startGame(room.code, host.playerId, host.token), LobbyError); // too few players
  const { auth: guest } = await lobby.joinRoom(room.code, 'Guest');
  await assert.rejects(() => lobby.startGame(room.code, guest.playerId, guest.token), LobbyError); // not host
  const started = await lobby.startGame(room.code, host.playerId, host.token);
  assert.equal(started.phase, 'active');
});

test('lobby: actions require a valid token and bump the game version', async () => {
  const lobby = new LobbyService(new MemoryGameStore());
  const { room, auth: host } = await lobby.createRoom('Host');
  const { auth: guest } = await lobby.joinRoom(room.code, 'Guest');
  await lobby.startGame(room.code, host.playerId, host.token);

  // wrong token is rejected
  await assert.rejects(() => lobby.submitAction(room.code, host.playerId, 'bogus', { type: 'endTurn' }), AuthError);

  const before = (await lobby.getGameView(room.code, host.playerId, host.token)).version;
  const after = await lobby.submitAction(room.code, host.playerId, host.token, { type: 'endTurn' });
  assert.ok(after.version > before, 'a legal action advances the engine version');
  assert.equal(after.activePlayer, guest.playerId, 'turn passes to the other player');

  // an out-of-turn action is rejected by the engine: game version does not advance
  const v1 = after.version;
  const rejected = await lobby.submitAction(room.code, host.playerId, host.token, { type: 'endTurn' });
  assert.equal(rejected.version, v1, 'illegal move leaves the engine state unchanged');
});

test('lobby: cannot join or act once started / cannot view before start', async () => {
  const lobby = new LobbyService(new MemoryGameStore());
  const { room, auth: host } = await lobby.createRoom('Host');
  await assert.rejects(() => lobby.getGameView(room.code, host.playerId, host.token), LobbyError); // not started
  await lobby.joinRoom(room.code, 'Guest');
  await lobby.startGame(room.code, host.playerId, host.token);
  await assert.rejects(() => lobby.joinRoom(room.code, 'Latecomer'), LobbyError); // already started
});

test('lobby: stale games are reaped after the TTL, and activity refreshes it', async () => {
  let now = 0;
  const ttl = 1000;
  const lobby = new LobbyService(new MemoryGameStore(), () => now, ttl);
  const { room } = await lobby.createRoom('Host');

  now = 500;                                   // within TTL …
  await lobby.joinRoom(room.code, 'Guest');     // … activity refreshes expiry to 500 + 1000
  now = 1200;                                   // past the original expiry, before the refreshed one
  assert.deepEqual(await lobby.sweep(), []);    // still alive thanks to the join
  const alive = await lobby.getRoom(room.code);
  assert.equal(alive.players.length, 2);

  now = 2000;                                   // past the refreshed expiry (1500)
  assert.deepEqual(await lobby.sweep(), [room.code]);
  await assert.rejects(() => lobby.getRoom(room.code), /no game/);
});
