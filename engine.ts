// =============================================================================
// engine.ts — PUBLIC BARREL for the Jovian Frontier / Colony engine.
//
// The implementation is split into focused modules under ./engine/ :
//   types.ts      — all shared types (no runtime)
//   rng.ts        — deterministic RNG + shuffle
//   core.ts       — catalog access, START constants, shared state helpers
//   cost.ts       — the two-sided cost model (chargedAtBuy / canAfford / payCost)
//   keywords.ts   — keyword queries, effective stats, upkeep
//   zones.ts      — deck/discard cycling + pacts
//   effects.ts    — the effect interpreter, destroy/dispossession, incubation
//   combat.ts     — the synchronous Attack gate + resolution
//   objectives.ts — scoring conditions, costs, tier/capstone win logic
//   turn.ts       — Refresh + Cleanup bookkeeping
//   setup.ts      — buildSupply (shuffled stacks) + createGame
//   reducer.ts    — isAllowed + the pure reduce()
//   view.ts       — per-player hidden-info-filtered view
//
// Consumers should keep importing from './engine.js'; this file re-exports the
// stable public surface so the internal layout can change freely.
// =============================================================================
export type * from './engine/types.js';

export { rng } from './engine/rng.js';
export { START, setCatalog, def } from './engine/core.js';
export { chargedAtBuy, canAfford } from './engine/cost.js';
export { hasKw, kwVal, eff } from './engine/keywords.js';
export { applyEffect, dispatch, tickIncubation } from './engine/effects.js';
export { scoreObjective, objectivesView, type DirectiveView } from './engine/objectives.js';
export { DIRECTIVES } from './engine/directives.js';
export { isAllowed, reduce } from './engine/reducer.js';
export { viewFor } from './engine/view.js';
export { netViewFor } from './engine/netview.js';
export type { NetView, NetCard, NetHandCard, NetStack, NetAttack, NetPending } from './engine/netview.js';
export { buildSupply, createGame } from './engine/setup.js';
