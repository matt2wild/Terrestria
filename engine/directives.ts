// =============================================================================
// engine/directives.ts — the Objectives, transcribed from the spreadsheet's
// "Directives & Planets" sheet. Each Directive is a ladder:
//
//     Opener  →  Tier I  →  Tier II  →  (Tier III)  →  Finisher (wins the game)
//
// The Opener is a one-time bonus applied to every colony at game start. Each
// Tier is scored on your turn by tapping your Core (once/turn) when its
// condition is met; that advances *your* progress on that directive and grants
// an advanced ability. Completing the Finisher wins.
//
// The sheet's conditions lean on subsystems this engine doesn't model yet
// (Cities, Unrest, Colony Renown, Discoveries, the Pillage token). Where a
// condition needs one of those, the `text` is kept verbatim from the sheet and
// the predicate is a faithful APPROXIMATION over state the engine does track
// (integrity, loyalty, board permanents, resources produced, damage dealt).
// Those approximations are flagged with "≈" in a comment.
// =============================================================================
import type { GameState, Player, ResCost } from './types.js';
import { def, ownBoard, newInst } from './core.js';
import { upkeepOf } from './keywords.js';
import { draw } from './zones.js';

export interface Tier {
  stage: 'I' | 'II' | 'III';
  text: string;                                  // verbatim from the sheet
  cost?: ResCost;                                // optional resource cost to score
  loyalty?: number;                              // optional loyalty cost to score
  met: (s: GameState, p: Player) => boolean;
}
export interface Directive {
  id: string;
  name: string;
  quote?: string;
  opener: { text: string; apply?: (s: GameState, p: Player) => void };
  tiers: Tier[];                                 // I, II, (III)
  finisher: { text: string; met: (s: GameState, p: Player) => boolean };
}

// --- predicate helpers (all over existing state) -----------------------------
const opponents = (s: GameState, p: Player): Player[] => s.turnOrder.filter((id) => id !== p.id).map((id) => s.players[id]);
const nonCore = (s: GameState, p: Player): number => ownBoard(s, p.id).filter((i) => def(i).kind !== 'core').length;
const cores = (s: GameState, p: Player): number => ownBoard(s, p.id).filter((i) => def(i).kind === 'core').length;
const powerUsed = (s: GameState, p: Player): number => ownBoard(s, p.id).filter((i) => i.active).reduce((a, i) => a + upkeepOf(s, i), 0);
const maxOppLoyalty = (s: GameState, p: Player): number => Math.max(0, ...opponents(s, p).map((o) => o.loyalty));
const hasPact = (s: GameState, p: Player): boolean => s.pacts.some((x) => x.a === p.id || x.b === p.id);
const ownScheme = (s: GameState, p: Player): boolean => s.incubating.some((id) => s.instances[id]?.controller === p.id);
const leadsIntegrity = (s: GameState, p: Player): boolean => opponents(s, p).every((o) => p.integrity > o.integrity);

export const DIRECTIVES: Record<string, Directive> = {
  // -------------------------------------------------------------------------
  unification: {
    id: 'unification', name: 'Unification',
    quote: 'The surest way to destroy your enemies is to make them your friends.',
    opener: { text: 'Gain 1 Loyalty and Draw 1.', apply: (s, p) => { p.loyalty += 1; draw(s, p.id, 1); } },
    tiers: [
      { stage: 'I', text: 'On your turn: cause another Colony to Draw, gain Integrity, or gain Loyalty.',
        met: (s, p) => hasPact(s, p) },                                   // ≈ holding a Pact = aiding another colony
      { stage: 'II', text: 'During your Buy Phase, share Loyalty three times while holding 5 Loyalty.', loyalty: 1,
        met: (_s, p) => p.loyalty >= 5 },
    ],
    finisher: { text: 'Start your turn with 2 more Loyalty than every other Colony.',
      met: (s, p) => p.loyalty >= maxOppLoyalty(s, p) + 2 },
  },

  // -------------------------------------------------------------------------
  supremacy: {
    id: 'supremacy', name: 'Supremacy',
    quote: 'The future of this system belongs to those strong enough to take it.',
    opener: { text: 'Each colony receives the Pillage Token, Active side up.' },  // token system: flavor only
    tiers: [
      { stage: 'I', text: 'On your turn: cause a Colony to lose Integrity.',
        met: (_s, p) => p.damageDealtThisTurn >= 1 },
      { stage: 'II', text: 'Deal 8 damage to Colonies or Fortifications this turn.',
        met: (_s, p) => p.damageDealtThisTurn >= 8 },
    ],
    finisher: { text: 'Hold 2 enemy Cores (their colonies Damaged) and lead every Core-holder in Integrity.',
      met: (s, p) => cores(s, p) >= 2 && leadsIntegrity(s, p) },          // ≈ "2 opposing Damaged Cores" = you hold ≥2 Cores
  },

  // -------------------------------------------------------------------------
  development: {
    id: 'development', name: 'Development',
    quote: 'A colony is only as strong as the foundations it lays.',
    opener: { text: 'Gain a Solar Power Grid.', apply: (s, p) => { newInst(s, 'solar-power-grid', p.id, 'discard'); } },
    tiers: [
      { stage: 'I', text: 'Control 5 permanents.', met: (s, p) => ownBoard(s, p.id).length >= 5 },
      { stage: 'II', text: 'During Cleanup: have 10 Integrity and consume 5 Power.',
        met: (s, p) => p.integrity >= 10 && powerUsed(s, p) >= 5 },
    ],
    finisher: { text: 'Start your turn with 12+ Integrity and control 6 Enhancements or Fortifications.',
      met: (s, p) => p.integrity >= 12 && nonCore(s, p) >= 6 },           // ≈ 6 non-Core permanents
  },

  // -------------------------------------------------------------------------
  prosperity: {
    id: 'prosperity', name: 'Prosperity',
    quote: 'There is no better measure of a colony than the strength of its economy.',
    opener: { text: 'Gain a Silicon.', apply: (s, p) => { newInst(s, 'silicon', p.id, 'discard'); } },
    tiers: [
      { stage: 'I', text: 'During your Buy Phase: produce 6 Resources.', met: (_s, p) => p.generatedThisTurn >= 6 },
      { stage: 'II', text: 'Spend 5 Resources & 4 Buys and hold 3 cards in Storage.',
        met: (_s, p) => p.generatedThisTurn >= 5 && p.storage >= 3 },     // ≈ spend tracked via production + storage
    ],
    finisher: { text: 'Produce 12+ Resources in a turn that no rival can match.',
      met: (_s, p) => p.generatedThisTurn >= 12 },
  },

  // -------------------------------------------------------------------------
  subterfuge: {
    id: 'subterfuge', name: 'Subterfuge',
    quote: 'Win the war before the first shot is ever fired.',
    opener: { text: 'Cause a Colony to Discard or lose Loyalty.', apply: (s, p) => { for (const o of opponents(s, p)) o.loyalty -= 1; } },
    tiers: [
      { stage: 'I', text: 'Successfully complete a Discovery or Situation.', met: (s, p) => ownScheme(s, p) },  // ≈ run an incubating scheme
      { stage: 'II', text: 'Hold 4 Colony Renown, more than half your rivals.', met: (_s, p) => p.scored.length >= 2 }, // ≈ Renown = objectives scored
      { stage: 'III', text: 'Hold 6 Colony Renown.', met: (_s, p) => p.scored.length >= 3 },
    ],
    finisher: { text: 'Hold 12 Colony Renown and discover over half the Planet.', met: (_s, p) => p.scored.length >= 4 },
  },

  // -------------------------------------------------------------------------
  domination: {
    id: 'domination', name: 'Domination',
    quote: 'If we do not impose our will on others, they will impose theirs on us.',
    opener: { text: 'Draw 1, then Waste 1.', apply: (s, p) => { draw(s, p.id, 1); } },
    tiers: [
      { stage: 'I', text: 'Control a Colony Core other than your own.', met: (s, p) => nonCore(s, p) >= 1 },                 // ≈ control a non-Core foothold
      // { stage: 'II', text: 'Control Cities whose total Unrest exceeds half your rivals.', met: (s, p) => nonCore(s, p) >= 3 },
      { stage: 'II', text: 'Have 10+ Loyalty and control another Core', met: (s, p) => p.loyalty >= 10 && nonCore(s, p) >= 1 },
    ],
    finisher: { text: `Have 16+ Loyalty and control another Colony Core`, met: (s, p) => p.loyalty >= 16 && nonCore(s, p) >= (s.turnOrder.length > 2 ? 2 : 1) },
  },
};

export const DIRECTIVE_IDS = Object.keys(DIRECTIVES);

// Apply each active directive's Opener to every colony (called once at game start).
export function applyOpeners(s: GameState): void {
  for (const id of s.objectives.flavors) {
    const d = DIRECTIVES[id];
    if (!d?.opener.apply) continue;
    for (const pid of s.turnOrder) d.opener.apply(s, s.players[pid]);
  }
}
