// =============================================================================
// engine/types.ts — every shared type/interface for the engine. No runtime code.
// =============================================================================
export type PlayerId = string;
export type Phase = 'attack' | 'action' | 'buy' | 'cleanup';
export type Tier = 'S' | 'I' | 'II' | 'III';

// `kind` is what the rules engine branches on; `type` is the descriptive flavor
// string straight off the card ("Unit - Human Pirates", "Fortification", …).
//   resource  — pay to acquire, free to play, cycles to discard
//   operation — free to buy, pay to play, one-shot, cycles to discard
//   permanent — free to buy, pay to play, stays on the board
//   core      — the Colony Core (special; seized via Dispossession)
//   colony    — the player's colony card (its stats live on the Player record)
//   waste     — cannot be played
export type Kind = 'resource' | 'operation' | 'permanent' | 'core' | 'colony' | 'waste';

export type Keyword = string | { kw: string; n: number };

export type TargetScope =
  | 'self' | 'sourceCard' | 'targetPlayer' | 'allOpponents'
  | 'ownPermanents' | 'enemyPermanents';

// A cost in the three columns the spreadsheet uses: Minerals / Influence / Either.
// `wild` ("Either") is payable with minerals OR influence, player's choice.
export interface ResCost { minerals?: number; influence?: number; wild?: number; }

export interface Effect {
  op: string;                                    // verb (see applyEffect)
  target: { scope: TargetScope; ofKind?: Kind[]; count?: number };
  amount?: number;
  resource?: 'minerals' | 'influence' | 'energy' | 'loyalty';
  stat?: { attack?: number; health?: number };
  keyword?: string;
  schedule?: { delay: number; cadence: 'burst' | 'progressive'; payload: Effect[] };
}
export interface Trigger { on: string; taps?: boolean; cost?: ResCost; effects: Effect[]; }

// Immutable catalog record (never mutated by a game).
export interface CardDef {
  id: string; name: string;
  kind: Kind;
  category: string;         // buy-stack axis: 'mineral','influence','diplomacy',…
  type: string;             // descriptive flavor string from the sheet
  tier?: Tier;
  cost?: ResCost;           // charged at BUY for resources, at PLAY for actions
  stats?: { attack: number; health: number };
  produces?: number;        // energy/power produced (core/battery)
  handBonus?: number;       // +hand size
  storageBonus?: number;    // +storage
  buyBonus?: number;        // +buys per turn while in play
  upkeep?: number;          // ⚡ per turn while in play
  attachTo?: Kind[];
  incubation?: { delay: number; cadence: 'burst' | 'progressive' };
  keywords?: Keyword[];
  triggers?: Trigger[];
  text?: string;
}

// Mutable per-game instance = a reference to a def + riders.
export interface Inst {
  id: string; defId: string; controller: PlayerId;
  zone: 'board' | 'hand' | 'deck' | 'discard' | 'incubating';
  tapped: boolean; damage: number; active: boolean;
  summonedThisTurn: boolean;
  attachedTo?: string; upgrades: string[];
  granted: Keyword[];
  incubation?: { remaining: number; cadence: 'burst' | 'progressive'; payload: Effect[]; targets: PlayerId[] };
}

export interface Player {
  id: PlayerId; name: string; seat: number; connected: boolean; retentionDays: number;
  integrity: number; loyalty: number;
  minerals: number; influence: number; energy: number;
  storage: number; handSize: number; buys: number;
  scored: string[]; abilities: string[];
  directiveTier: Record<string, number>;        // stages completed per active directive
  // per-turn / per-round bookkeeping for objective predicates
  generatedThisTurn: number; damageDealtThisTurn: number;
  lostPermThisRound: boolean; attackedThisRound: boolean; destroyedCount: number;
}

export interface Gate {
  attacks: { attackerId: string; target: { player?: PlayerId; instId?: string } }[];
  waitingOn: PlayerId[];
  blocks: Record<PlayerId, { blockerId: string; attackerId: string }[]>;
}

// A buy source. Resource & battery stacks are homogeneous (one card type) and
// fully visible; mixed action stacks are bought blind off the top.
// `acquire: 'pay'`  → resource stacks; buying charges the card's cost.
// `acquire: 'free'` → action & battery stacks; buying is free, you pay when you play.
// `blind: true`     → bought sight-unseen (mixed action piles only).
export interface BuyStack {
  key: string;            // `${category}:${tier}`, or `battery:${id}` for battery piles
  category: string; tier: Tier;
  acquire: 'pay' | 'free';
  blind: boolean;
  cards: string[];        // remaining defIds in random order; top = last element
}

// `flavors` holds the 3 active Directive ids for this game (see engine/directives.ts).
// Per-directive progress lives on each Player as `directiveTier`.
export interface ObjectiveState { flavors: string[]; }
export interface Pact { a: PlayerId; b: PlayerId; bindingRounds: number; formedRound: number; }

export interface GameState {
  gameId: string; version: number; catalogVersion: number;
  status: 'lobby' | 'playing' | 'finished';
  seed: number; rngCalls: number;
  turnOrder: PlayerId[]; activeIndex: number; round: number; phase: Phase;
  players: Record<PlayerId, Player>;
  instances: Record<string, Inst>;
  supply: Record<string, BuyStack>;   // keyed by `${category}:${tier}`
  pending: Gate | null;
  incubating: string[];               // instanceIds of incubating schemes
  objectives: ObjectiveState; pacts: Pact[];
  log: string[]; winner?: PlayerId;
}

export interface Ctx { playerId: PlayerId; now: number; }

export type Catalog = Map<string, CardDef>;

export interface SetupConfig {
  startingBoard: string[];                 // defIds in play at game start (core, etc.)
  startingDeck: string[];                  // defIds shuffled into each player's deck
  resourceCopies?: number;                 // copies of each card in a resource stack
  actionCopies?: number;                   // copies of each card in an action stack
  objectiveFlavors?: string[];
}

export type Action =
  | { type: 'startGame' }
  | { type: 'playCard'; instId: string; chosen?: PlayerId[] }
  | { type: 'activate'; instId: string; triggerIndex: number; chosen?: PlayerId[] }
  | { type: 'buyCard'; stackKey: string }              // buy the top card of a stack (blind for actions)
  | { type: 'declareAttack'; attacks: Gate['attacks'] }
  | { type: 'respondToAttack'; blocks: { blockerId: string; attackerId: string }[] }
  | { type: 'scoreObjective'; flavor: string }
  | { type: 'endPhase' }
  | { type: 'endTurn' };
