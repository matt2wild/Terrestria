// =============================================================================
// server/engineHandler.ts — the ENGINE EXECUTION boundary.
//
// Everything here is pure and stateless: given a GameState (or the inputs to
// build one), it returns a new GameState or a view. This is exactly the surface
// that becomes a Lambda function later — the HTTP/store layers hand it plain
// data and get plain data back, no I/O in between.
//
// The catalog is static reference data; we register it once at import.
// =============================================================================
import {
  reduce, createGame, setCatalog, netViewFor,
  type Action, type GameState, type PlayerId, type NetView,
} from '../engine.js';
import { CATALOG, SETUP } from '../catalog.js';

setCatalog(CATALOG); // must precede any createGame/reduce call

export interface SeatInput { id: PlayerId; name: string; }

/** Create a fresh, already-started engine game for the seated players. */
export function newGame(gameId: string, seats: SeatInput[], seed: number): GameState {
  const game = createGame(
    gameId,
    seats.map((s) => ({ id: s.id, name: s.name, retentionDays: 0 })),
    SETUP,
    seed,
  );
  // Transition lobby → playing. Any seated player may issue startGame; the engine
  // only checks status, not seat, for this action.
  return reduce(game, { playerId: seats[0].id, now: Date.now() }, { type: 'startGame' });
}

/**
 * Apply one player action. The engine is authoritative: illegal moves are
 * rejected by returning the prior state unchanged (its `version` does not bump),
 * which the caller can detect by comparing versions.
 */
export function applyAction(game: GameState, playerId: PlayerId, action: Action, now: number): GameState {
  return reduce(game, { playerId, now }, action);
}

/** Hidden-info-filtered, render-ready projection for one player. */
export function viewForPlayer(game: GameState, playerId: PlayerId): NetView {
  return netViewFor(game, playerId);
}
