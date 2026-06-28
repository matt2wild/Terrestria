// =============================================================================
// engine/setup.ts — game creation: build the shuffled buy stacks from the live
// catalog and seat the players with their starting board + deck.
// =============================================================================
import type { GameState, BuyStack, SetupConfig, CardDef } from './types.js';
import { cat, START, newInst, rand } from './core.js';
import { shuffle } from './rng.js';
import { DIRECTIVE_IDS, applyOpeners } from './directives.js';

// One stack per (category × tier): fill with `copies` of every card in that
// group, then SHUFFLE so the available card is random (blind for action stacks).
export function buildSupply(s: GameState, cfg: SetupConfig): Record<string, BuyStack> {
  const resourceCopies = cfg.resourceCopies ?? 10;
  const actionCopies = cfg.actionCopies ?? 4;
  const groups = new Map<string, CardDef[]>();
  for (const d of cat().values()) {
    // Only buyable cards land in stacks: resources + playable actions, tiers I/II/III.
    if (!(d.kind === 'resource' || d.kind === 'operation' || d.kind === 'permanent')) continue;
    if (!d.tier || d.tier === 'S') continue;
    // Battery sources get one visible pile *per card*; everything else groups by category:tier.
    const key = d.category === 'battery' ? `battery:${d.id}` : `${d.category}:${d.tier}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
  }
  const supply: Record<string, BuyStack> = {};
  for (const [key, defs] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cat0 = defs[0];
    const acquire: BuyStack['acquire'] = cat0.kind === 'resource' ? 'pay' : 'free';
    // Resource & battery piles are homogeneous → visible; mixed action piles are blind.
    const blind = !(cat0.category === 'mineral' || cat0.category === 'influence' || cat0.category === 'battery');
    const copies = acquire === 'pay' ? resourceCopies : actionCopies;
    const cards: string[] = [];
    for (const d of defs) for (let i = 0; i < copies; i++) cards.push(d.id);
    supply[key] = { key, category: cat0.category, tier: cat0.tier!, acquire, blind, cards: shuffle(cards, () => rand(s)) };
  }
  return supply;
}

export function createGame(
  gameId: string,
  players: { id: string; name: string; retentionDays: number }[],
  cfg: SetupConfig,
  seed = 1,
): GameState {
  const s: GameState = {
    gameId, version: 0, catalogVersion: 1, status: 'lobby', seed, rngCalls: 0,
    turnOrder: players.map((p) => p.id), activeIndex: 0, round: 1, phase: 'attack',
    players: {}, instances: {}, supply: {}, pending: null, incubating: [],
    objectives: { flavors: [] }, pacts: [], log: [],
  };
  // 3 active directives: pinned by config (tests/demos) or 3 drawn at random.
  s.objectives.flavors = cfg.objectiveFlavors ?? shuffle(DIRECTIVE_IDS, () => rand(s)).slice(0, 3);
  players.forEach((p, seat) => {
    s.players[p.id] = { id: p.id, name: p.name, seat, connected: true, retentionDays: p.retentionDays,
      integrity: START.integrity, loyalty: START.loyalty, minerals: 0, influence: 0, energy: 0,
      storage: START.storage, handSize: START.handSize, buys: START.buys,
      scored: [], abilities: [], directiveTier: {},
      generatedThisTurn: 0, damageDealtThisTurn: 0, lostPermThisRound: false, attackedThisRound: false, destroyedCount: 0 };
    for (const dId of cfg.startingBoard) newInst(s, dId, p.id, 'board');
    for (const dId of cfg.startingDeck) newInst(s, dId, p.id, 'deck');
  });
  s.supply = buildSupply(s, cfg);
  applyOpeners(s); // one-time directive Opener bonuses for every colony
  return s;
}
