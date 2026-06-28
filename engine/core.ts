// =============================================================================
// engine/core.ts — the shared substrate: catalog access, starting constants,
// and the small state helpers every other module reaches for.
// =============================================================================
import type { GameState, PlayerId, Inst, CardDef, Catalog, Phase } from './types.js';
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
