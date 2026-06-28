// =============================================================================
// server/store.ts — the persistence boundary.
//
// `GameStore` is the seam that lets game state move from process memory to
// DynamoDB without touching the lobby logic or the engine. It is deliberately
// shaped like a single-table DynamoDB access pattern:
//   - one item per Room, keyed by `code` (partition key)
//   - writes are conditional on a numeric `version` (optimistic locking →
//     DynamoDB ConditionExpression "version = :expected")
//   - `expiresAt` is an epoch-ms attribute that mirrors a DynamoDB TTL column;
//     `deleteExpired` is what TTL does for us natively in the cloud.
//
// `MemoryGameStore` is the local implementation. A future `DynamoGameStore`
// implements the same interface; nothing upstream changes.
// =============================================================================
import type { GameState, PlayerId } from '../engine.js';

export type RoomPhase = 'lobby' | 'active' | 'finished';

export interface RoomPlayer {
  id: PlayerId;
  name: string;
  token: string;        // per-player secret; authorizes this player's actions. Never leaked to others.
  isHost: boolean;
  joinedAt: number;
}

export interface Room {
  code: string;                 // 6-char join code = partition key
  hostId: PlayerId;
  phase: RoomPhase;             // server lifecycle: lobby → active → finished
  players: RoomPlayer[];
  game: GameState | null;       // null until the host starts; then the engine state
  seed: number;
  version: number;              // optimistic-concurrency token for the STORE (distinct from game.version)
  createdAt: number;
  lastActivityAt: number;       // bumped on every meaningful write (create/join/start/action)
  expiresAt: number;            // lastActivityAt + ttl → DynamoDB TTL attribute after migration
}

export class ConflictError extends Error {}      // code already exists
export class NotFoundError extends Error {}       // no such room
export class ConcurrencyError extends Error {}    // version mismatch on conditional put

export interface GameStore {
  create(room: Room): Promise<Room>;
  get(code: string): Promise<Room | null>;
  /** Conditional write: succeeds only if the stored version equals `room.version`. */
  put(room: Room): Promise<Room>;
  delete(code: string): Promise<void>;
  list(): Promise<Room[]>;
  /** Reap rooms whose expiresAt <= now. Returns the reaped codes. (DynamoDB TTL does this natively.) */
  deleteExpired(now: number): Promise<string[]>;
}

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryGameStore implements GameStore {
  private rooms = new Map<string, Room>();

  async create(room: Room): Promise<Room> {
    if (this.rooms.has(room.code)) throw new ConflictError(`room ${room.code} already exists`);
    const stored = { ...clone(room), version: 1 };
    this.rooms.set(room.code, stored);
    return clone(stored);
  }

  async get(code: string): Promise<Room | null> {
    const r = this.rooms.get(code);
    return r ? clone(r) : null;
  }

  async put(room: Room): Promise<Room> {
    const cur = this.rooms.get(room.code);
    if (!cur) throw new NotFoundError(`room ${room.code} not found`);
    if (cur.version !== room.version) {
      throw new ConcurrencyError(`version conflict on ${room.code}: have ${cur.version}, got ${room.version}`);
    }
    const stored = { ...clone(room), version: cur.version + 1 };
    this.rooms.set(room.code, stored);
    return clone(stored);
  }

  async delete(code: string): Promise<void> { this.rooms.delete(code); }

  async list(): Promise<Room[]> { return [...this.rooms.values()].map(clone); }

  async deleteExpired(now: number): Promise<string[]> {
    const reaped: string[] = [];
    for (const [code, room] of this.rooms) {
      if (room.expiresAt <= now) { this.rooms.delete(code); reaped.push(code); }
    }
    return reaped;
  }
}
