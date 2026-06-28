// Shared test helpers. Importing this module wires the catalog once.
import { createGame, reduce, setCatalog } from '../engine.js';
import type { GameState, Action, PlayerId } from '../engine.js';
import { CATALOG, SETUP } from '../catalog.js';

setCatalog(CATALOG);

export { CATALOG, SETUP, reduce, createGame };
export { newInst } from '../engine/core.js';
export type { GameState, Action, PlayerId };

export const PLAYERS = [
  { id: 'A', name: 'A', retentionDays: 0 },
  { id: 'B', name: 'B', retentionDays: 0 },
];

// A fresh 2-player game already started (A active, attack phase), random directives.
export function newGame(seed = 1): GameState {
  const s = createGame('test', PLAYERS, SETUP, seed);
  return reduce(s, { playerId: 'A', now: 0 }, { type: 'startGame' });
}

// Like newGame but with the 3 active Directives pinned (deterministic objectives).
export function newGameDir(flavors: string[], seed = 1): GameState {
  const s = createGame('test', PLAYERS, { ...SETUP, objectiveFlavors: flavors }, seed);
  return reduce(s, { playerId: 'A', now: 0 }, { type: 'startGame' });
}

export function step(s: GameState, pid: PlayerId, a: Action): GameState {
  return reduce(s, { playerId: pid, now: 0 }, a);
}

export function instOf(s: GameState, pid: PlayerId, defId: string, zone = 'board') {
  return Object.values(s.instances).find((i) => i.controller === pid && i.zone === zone && i.defId === defId);
}
