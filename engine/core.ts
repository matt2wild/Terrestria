// =============================================================================
// engine/core.ts — the shared substrate: catalog access, starting constants,
// and the small state helpers every other module reaches for.
// =============================================================================
import type { GameState, PlayerId, Inst, CardDef, Catalog, Phase, Lane } from './types.js';
import { rng } from './rng.js';

// Starting colony values, taken from the "Player Colony" / "Colony Core" cards.
export const START = { integrity: 20, loyalty: 3, storage: 1, handSize: 5, buys: 1, recovery: 10 };

export const PHASES: Phase[] = ['attack', 'action', 'buy', 'cleanup'];

// Catalog: the engine receives a hydrating lookup; storage holds defId only.
let CAT: Catalog = new Map();
export function setCatalog(c: Catalog): void { CAT = c; }
export function cat(): Catalog { return CAT; }                 // internal: iterate / lookup by id
export function def(inst: Inst): CardDef { return CAT.get(inst.defId)!; }

// --- tiny state helpers ------------------------------------------------------
export const log = (s: GameState, m: string): void => { s.log.push(`[r${s.round} ${s.phase}] ${m}`); };
export const active = (s: GameState) => s.players[s.turnOrder[s.activeIndex]];
export const board = (s: GameState): Inst[] => Object.values(s.instances).filter((i) => i.zone === 'board');
export const ownBoard = (s: GameState, p: PlayerId): Inst[] => board(s).filter((i) => i.controller === p);
export const rand = (s: GameState): number => { const r = rng(s.seed + s.rngCalls)(); s.rngCalls++; return r; };

export function newInst(s: GameState, defId: string, controller: PlayerId, zone: Inst['zone']): Inst {
  const id = `c${Object.keys(s.instances).length + 1}_${defId}`;
  const i: Inst = { id, defId, controller, zone, tapped: false, damage: 0, active: true, summonedThisTurn: false, upgrades: [], granted: [] };
  s.instances[id] = i; return i;
}

// --- deployment lanes --------------------------------------------------------
// Which line a permanent occupies. Explicit `pos` wins; otherwise a sensible
// default: things with combat stats (units, fortifications) hold the VANGUARD,
// everything else (batteries, enhancements, doctrines) sits in SUPPORT. The
// Core / Colony are not in a lane. This default reproduces today's behavior —
// only stats-bearing cards ever attacked or blocked — so lanes add depth
// without changing any existing combat until a card is repositioned.
export function laneOf(i: Inst): Lane | null {
  const d = def(i);
  if (d.kind === 'core' || d.kind === 'colony') return null;
  if (i.pos) return i.pos.lane;
  return d.stats ? 'vanguard' : 'support';
}
export const laneCount = (s: GameState, p: PlayerId, lane: Lane): number =>
  ownBoard(s, p).filter((i) => laneOf(i) === lane).length;
