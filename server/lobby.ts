// =============================================================================
// server/lobby.ts — the application service that ties the store, the engine
// handler, and the join-code scheme together. It owns the *rules of the lobby*
// (who may start, when you can join) but delegates game rules to the engine and
// persistence to the GameStore.
//
// All writes go through `mutate()`, which re-reads and retries on optimistic-lock
// conflicts — the same pattern a DynamoDB conditional write needs under
// concurrent players acting at once.
// =============================================================================
import type { NetView, Action, PlayerId } from '../engine.js';
import {
  type GameStore, type Room, type RoomPlayer, type RoomPhase,
  ConflictError, NotFoundError, ConcurrencyError,
} from './store.js';
import { newGame, applyAction, viewForPlayer } from './engineHandler.js';
import { makeCode, makeToken, makePlayerId, normalizeCode } from './codes.js';
import { CONFIG } from './config.js';

export class AuthError extends Error {}     // bad/missing token for a player
export class LobbyError extends Error {}    // rule violation (full, wrong phase, not host, …)

// What a client is allowed to see about a room (no tokens).
export interface PublicRoom {
  code: string;
  phase: RoomPhase;
  hostId: PlayerId;
  players: { id: PlayerId; name: string; isHost: boolean }[];
  minPlayers: number;
  maxPlayers: number;
  canStart: boolean;
  winner?: PlayerId;
  winnerName?: string;
  expiresInMs: number;        // time until reaped if no further activity
}

export interface Auth { playerId: PlayerId; token: string; }

export class LobbyService {
  constructor(
    private store: GameStore,
    private now: () => number = Date.now,
    private ttlMs: number = CONFIG.gameTtlMs,
  ) {}

  // ---- lifecycle -----------------------------------------------------------

  async createRoom(hostName: string): Promise<{ room: PublicRoom; auth: Auth }> {
    const name = cleanName(hostName, 'Host');
    const host: RoomPlayer = { id: makePlayerId(), name, token: makeToken(), isHost: true, joinedAt: this.now() };
    // Retry on the (rare) code collision with a fresh code.
    for (let attempt = 0; attempt < 8; attempt++) {
      const t = this.now();
      const room: Room = {
        code: makeCode(), hostId: host.id, phase: 'lobby', players: [host], game: null,
        seed: Math.floor(Math.random() * 1e9), version: 0,
        createdAt: t, lastActivityAt: t, expiresAt: t + this.ttlMs,
      };
      try {
        const created = await this.store.create(room);
        return { room: this.toPublic(created), auth: { playerId: host.id, token: host.token } };
      } catch (e) {
        if (e instanceof ConflictError) continue;
        throw e;
      }
    }
    throw new LobbyError('could not allocate a unique game code, please retry');
  }

  async joinRoom(rawCode: string, playerName: string): Promise<{ room: PublicRoom; auth: Auth }> {
    const code = normalizeCode(rawCode);
    const auth: Auth = { playerId: makePlayerId(), token: makeToken() };
    const room = await this.mutate(code, (r) => {
      if (r.phase !== 'lobby') throw new LobbyError('this game has already started');
      if (r.players.length >= CONFIG.maxPlayers) throw new LobbyError('this game is full');
      const name = uniqueName(cleanName(playerName, `Player ${r.players.length + 1}`), r.players);
      r.players.push({ id: auth.playerId, name, token: auth.token, isHost: false, joinedAt: this.now() });
      this.touch(r);
      return r;
    });
    return { room: this.toPublic(room), auth };
  }

  async startGame(rawCode: string, playerId: PlayerId, token: string): Promise<PublicRoom> {
    const code = normalizeCode(rawCode);
    const room = await this.mutate(code, (r) => {
      this.authorize(r, playerId, token);
      if (r.hostId !== playerId) throw new LobbyError('only the host can start the game');
      if (r.phase !== 'lobby') throw new LobbyError('the game has already started');
      if (r.players.length < CONFIG.minPlayers) throw new LobbyError(`need at least ${CONFIG.minPlayers} players to start`);
      r.game = newGame(r.code, r.players.map((p) => ({ id: p.id, name: p.name })), r.seed);
      r.phase = 'active';
      this.touch(r);
      return r;
    });
    return this.toPublic(room);
  }

  // ---- gameplay ------------------------------------------------------------

  async submitAction(rawCode: string, playerId: PlayerId, token: string, action: Action): Promise<NetView> {
    const code = normalizeCode(rawCode);
    const room = await this.mutate(code, (r) => {
      this.authorize(r, playerId, token);
      if (r.phase !== 'active' || !r.game) throw new LobbyError('the game is not in progress');
      r.game = applyAction(r.game, playerId, action, this.now());
      if (r.game.status === 'finished') r.phase = 'finished';
      this.touch(r);
      return r;
    });
    return viewForPlayer(room.game!, playerId);
  }

  // ---- reads (no mutation) -------------------------------------------------

  async getRoom(rawCode: string): Promise<PublicRoom> {
    const room = await this.load(normalizeCode(rawCode));
    return this.toPublic(room);
  }

  async getGameView(rawCode: string, playerId: PlayerId, token: string): Promise<NetView> {
    const room = await this.load(normalizeCode(rawCode));
    this.authorize(room, playerId, token);
    if (!room.game) throw new LobbyError('the game has not started yet');
    return viewForPlayer(room.game, playerId);
  }

  async listRooms(): Promise<PublicRoom[]> {
    return (await this.store.list()).map((r) => this.toPublic(r));
  }

  /** Reap inactive games. Returns reaped codes. Mirrors DynamoDB TTL expiry. */
  async sweep(): Promise<string[]> {
    return this.store.deleteExpired(this.now());
  }

  // ---- internals -----------------------------------------------------------

  private async load(code: string): Promise<Room> {
    const room = await this.store.get(code);
    if (!room) throw new NotFoundError(`no game with code ${code}`);
    return room;
  }

  private authorize(room: Room, playerId: PlayerId, token: string): RoomPlayer {
    const player = room.players.find((p) => p.id === playerId);
    if (!player || player.token !== token) throw new AuthError('not authorized for this game');
    return player;
  }

  private touch(room: Room): void {
    room.lastActivityAt = this.now();
    room.expiresAt = room.lastActivityAt + this.ttlMs;
  }

  // read-modify-write with optimistic-lock retry
  private async mutate(code: string, fn: (room: Room) => Room): Promise<Room> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const room = await this.load(code);
      const next = fn(room);
      try {
        return await this.store.put(next);
      } catch (e) {
        if (e instanceof ConcurrencyError) continue; // someone else wrote first; re-read and retry
        throw e;
      }
    }
    throw new ConcurrencyError(`too many concurrent writes on ${code}`);
  }

  private toPublic(room: Room): PublicRoom {
    return {
      code: room.code,
      phase: room.phase,
      hostId: room.hostId,
      players: room.players.map((p) => ({ id: p.id, name: p.name, isHost: p.isHost })),
      minPlayers: CONFIG.minPlayers,
      maxPlayers: CONFIG.maxPlayers,
      canStart: room.phase === 'lobby' && room.players.length >= CONFIG.minPlayers && room.players.length <= CONFIG.maxPlayers,
      winner: room.game?.winner,
      winnerName: room.game?.winner ? room.game.players[room.game.winner]?.name : undefined,
      expiresInMs: Math.max(0, room.expiresAt - this.now()),
    };
  }
}

// ---- small helpers ---------------------------------------------------------
function cleanName(raw: string, fallback: string): string {
  const n = (raw ?? '').trim().slice(0, 24);
  return n.length ? n : fallback;
}
function uniqueName(name: string, players: RoomPlayer[]): string {
  const taken = new Set(players.map((p) => p.name));
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) { const candidate = `${name} (${i})`; if (!taken.has(candidate)) return candidate; }
}
