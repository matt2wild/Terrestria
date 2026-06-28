// =============================================================================
// catalog.ts — immutable card definitions, recreated from the Colony spreadsheet
// ("Vlads Cards" sheet) under the pay-to-acquire / pay-to-play economy.
//
// THE COST RULE (read this first):
//   The sheet's "Cost to Play [Buy] (Minerals/Influence/Either)" column means two
//   different things depending on the card class — and that is the whole mechanic:
//
//     • RESOURCE cards (Mineral / Influence categories) printed their cost in
//       [brackets] = a BUY price. They are PAY-TO-ACQUIRE, FREE-TO-PLAY: spend
//       resources to buy them, then play them for free to bank resources.
//
//     • EVERY OTHER card printed an un-bracketed cost = a PLAY price. They are
//       FREE-TO-BUY, PAY-TO-PLAY: pulled blind off an Action pile for nothing,
//       paid for only when you actually play them.
//
//   In code a card has ONE `cost`. The engine charges it at BUY time when
//   `kind === 'resource'` and at PLAY time otherwise (see engine.ts chargedAtBuy).
//
// Costs are { minerals, influence, wild } where `wild` is the "Either" column —
// payable from minerals OR influence.
//
// Effects: the unambiguous, self-targeting effects (gain resources / integrity /
// loyalty, draw, +power/+handsize/+storage/+buy) are encoded as triggers so the
// economy actually runs. Richer card text (activated abilities, combat tricks,
// Loyalty-gated "NL ->" modes, Planetfall, etc.) is preserved verbatim in `text`.
// =============================================================================
import type { CardDef, Effect, Trigger, SetupConfig } from './engine.js';

export const CATALOG_VERSION = 2;

// --- terse effect builders ---------------------------------------------------
const onPlay = (...effects: Effect[]): Trigger => ({ on: 'onPlay', effects });
const gain = (resource: 'minerals' | 'influence', amount: number): Effect => ({ op: 'modifyResource', target: { scope: 'self' }, resource, amount });
const integ = (amount: number): Effect => ({ op: 'modifyIntegrity', target: { scope: 'self' }, amount });
const loy = (amount: number): Effect => ({ op: 'modifyLoyalty', target: { scope: 'self' }, amount });
const oppLoy = (amount: number): Effect => ({ op: 'modifyLoyalty', target: { scope: 'allOpponents' }, amount });
const tgtLoy = (amount: number): Effect => ({ op: 'modifyLoyalty', target: { scope: 'targetPlayer' }, amount });
const drawN = (amount: number): Effect => ({ op: 'drawCards', target: { scope: 'self' }, amount });
const hitColony = (amount: number): Effect => ({ op: 'modifyIntegrity', target: { scope: 'targetPlayer' }, amount });

export const CARDS: CardDef[] = [
  // =========================================================================
  // FOUNDER / COLONY / WASTE — special cards, never in the buy stacks.
  // =========================================================================
  { id: 'player-colony', name: 'Player Colony', kind: 'colony', category: 'colony', type: 'Permanent', tier: 'S',
    text: 'Start the game with 3 Loyalty. This Colony has 1 Storage. (20 Integrity / 3 Loyalty — baked into player start values.)' },
  { id: 'colony-core', name: 'Colony Core', kind: 'core', category: 'founder', type: 'Colony Core', tier: 'S', produces: 1,
    text: "Plus 1 Power. This card can't be interacted with. When you hit 0 Integrity, flip this card over (Dispossession seizes it)." },
  { id: 'damaged-colony-core', name: 'Damaged Colony Core', kind: 'core', category: 'founder', type: 'Colony Core', tier: 'S', produces: 1,
    text: "Plus 1 Power. This card can't be interacted with. Can't be repaired with Loyalty. Spend 6 Resources: Repair this card." },
  { id: 'core-amplifier', name: 'Core Amplifier', kind: 'permanent', category: 'founder', type: 'Battery', produces: 1, handBonus: 1,
    text: 'Plus 1 Power. Plus 1 Handsize. This card can only be gained by collapsing another Colony.' },
  { id: 'colony-drones', name: 'Colony Drones', kind: 'operation', category: 'founder', type: 'Operation',
    triggers: [onPlay(integ(2))], text: 'Choose One: Gain 2 Integrity. Gain 1 Mineral or Influence.' },
  { id: 'colony-aid', name: 'Colony Aid', kind: 'operation', category: 'founder', type: 'Operation',
    triggers: [onPlay(loy(1))], text: 'Choose One: Gain 1 Loyalty. Pay 1 Loyalty, Waste 1.' },
  { id: 'battery-processor', name: 'Battery Processor', kind: 'permanent', category: 'battery', type: 'Battery', produces: 1,
    text: 'Plus 1 Power.' },
  { id: 'slum', name: 'Slum', kind: 'waste', category: 'waste', type: 'Waste Card',
    text: 'This card cannot be played.' },

  // =========================================================================
  // RESOURCE cards — PAY-TO-ACQUIRE, FREE-TO-PLAY. Cost below is the BUY price.
  // =========================================================================
  { id: 'carbon', name: 'Carbon', kind: 'resource', category: 'mineral', type: 'Resource', tier: 'I', cost: {},
    triggers: [onPlay(gain('minerals', 1))], text: 'Gain 1 Mineral.' },
  { id: 'silicon', name: 'Silicon', kind: 'resource', category: 'mineral', type: 'Resource', tier: 'II', cost: { minerals: 1, wild: 2 },
    triggers: [onPlay(gain('minerals', 2))], text: 'Gain 2 Minerals.' },
  { id: 'titanium', name: 'Titanium', kind: 'resource', category: 'mineral', type: 'Resource', tier: 'III', cost: { minerals: 2, wild: 4 },
    triggers: [onPlay(gain('minerals', 3))], text: 'Gain 3 Minerals.' },
  { id: 'appeal', name: 'Appeal', kind: 'resource', category: 'influence', type: 'Resource', tier: 'I', cost: {},
    triggers: [onPlay(gain('influence', 1))], text: 'Gain 1 Influence.' },
  { id: 'compromise', name: 'Compromise', kind: 'resource', category: 'influence', type: 'Resource', tier: 'II', cost: { influence: 1, wild: 2 },
    triggers: [onPlay(gain('influence', 2))], text: 'Gain 2 Influence.' },
  { id: 'clout', name: 'Clout', kind: 'resource', category: 'influence', type: 'Resource', tier: 'III', cost: { influence: 2, wild: 4 },
    triggers: [onPlay(gain('influence', 3))], text: 'Gain 3 Influence.' },

  // =========================================================================
  // ACTION cards — FREE-TO-BUY, PAY-TO-PLAY. Cost below is the PLAY price.
  // =========================================================================

  

  // ---- Diplomacy ----
  { id: 'peaceful-protests', name: 'Peaceful Protests', kind: 'operation', category: 'diplomacy', type: 'Counter Operation', tier: 'I', cost: { influence: 1, wild: 1 },
    triggers: [onPlay(loy(1))], text: 'Expend up to 1 Unit or Fortification. +1 Loyalty. After attackers are declared, cancel the attack of 1 attacking unit. The owner of that unit loses 1 Loyalty.' },
  { id: 'improve-relations', name: 'Improve Relations', kind: 'operation', category: 'diplomacy', type: 'Operation', tier: 'I', cost: { influence: 1, wild: 1 },
    triggers: [onPlay(drawN(1), loy(1))], text: 'Choose One (an opponent may pick an unchosen option; if they do, you resolve the final one): Draw 1. Gain 1 Loyalty. Buy a card with -1 (Hard) Resource cost.' },
  { id: 'propaganda', name: 'Propaganda', kind: 'operation', category: 'diplomacy', type: 'Operation', tier: 'I', cost: { influence: 1, wild: 1 },
    triggers: [onPlay(gain('influence', 1), tgtLoy(1))], text: 'Target Colony gains 1 Loyalty. Plus 1 Influence.' },
  { id: 'priority-briefings', name: 'Priority Briefings', kind: 'permanent', category: 'diplomacy', type: 'Enhancement', tier: 'I', cost: { influence: 1, wild: 2 },
    text: 'You may look at the top card of your deck at any time. ACTION (2): Draw a card.' },
  { id: 'trade-agreement', name: 'Trade Agreement', kind: 'operation', category: 'diplomacy', type: 'Operation', tier: 'I', cost: { influence: 1, wild: 2 },
    triggers: [onPlay(drawN(2))], text: 'Both you and another target Colony Draw 2.' },
  { id: 'impassioned-speakers', name: 'Impassioned Speakers', kind: 'permanent', category: 'covert', type: 'Unit - Human Operatives', tier: 'I', cost: { influence: 1, wild: 3 }, upkeep: 1, stats: { attack: 1, health: 3 },
    text: 'When you Defend, each opposing Colony loses 1 Loyalty.' },
  { id: 'infrastructure-projects', name: 'Infrastructure Projects', kind: 'permanent', category: 'diplomacy', type: 'Enhancement', tier: 'I', cost: { influence: 2, wild: 2 }, upkeep: 1, buyBonus: 1,
    text: 'Plus 1 Buy. ACTION (1) during the Buy Phase: Action Cards you Buy this turn cost 1 less Mineral.' },
  { id: 'diplomatic-corps', name: 'Diplomatic Corps', kind: 'permanent', category: 'diplomacy', type: 'Enhancement', tier: 'I', cost: { influence: 2, wild: 2 }, upkeep: 1, stats: { attack: 0, health: 3 },
    text: 'When you gain Loyalty, you may spend 1 Influence to get that amount plus one instead. ACTION (3): Draw 2, Discard 1.' },
  { id: 'non-aggression-pact', name: 'Non-Aggression Pact', kind: 'operation', category: 'diplomacy', type: 'Operation', tier: 'I', cost: { influence: 3, wild: 1 },
    triggers: [onPlay(drawN(2), loy(1))], text: 'Both you and another Colony Draw 2 and gain 1 Loyalty. Until your next turn, both Colonies must pay 1 Loyalty and Discard 2 before declaring an attack towards the other.' },
  { id: 'evacuate', name: 'Evacuate', kind: 'operation', category: 'covert', type: 'Counter Operation', tier: 'II', cost: { influence: 1, wild: 4 },
    triggers: [onPlay(loy(1))], text: 'Gain 1 Loyalty, you may Waste a card from your hand. Use during the Assault Phase: Disable target Unit; if it was in combat, remove it from that Combat.' },
  { id: 'a-new-start', name: 'A New Start', kind: 'operation', category: 'diplomacy', type: 'Operation', tier: 'II', cost: { influence: 3, wild: 2 },
    triggers: [onPlay(loy(1), oppLoy(-1))], text: 'Gain 1 Loyalty. Each opposing Colony loses 1 Loyalty.' },
  { id: 'indoctrination', name: 'Indoctrination', kind: 'operation', category: 'diplomacy', type: 'Operation', tier: 'II', cost: { influence: 2, wild: 3 },
    triggers: [onPlay(gain('influence', 2), tgtLoy(2))], text: 'Target Colony gains 2 Loyalty. Plus 2 Influence.' },
  { id: 'breaking-relations', name: 'Breaking Relations', kind: 'operation', category: 'covert', type: 'Operation', tier: 'II', cost: { influence: 3, wild: 2 },
    triggers: [onPlay(gain('influence', 2), tgtLoy(-2))], text: 'Remove 2 Loyalty. Each opposing Colony that lost Loyalty during this turn Discards 1. Plus 2 Influence.' },
  { id: 'interrogations', name: 'Interrogations', kind: 'operation', category: 'covert', type: 'Operation', tier: 'II', cost: { influence: 2, wild: 4 },
    triggers: [onPlay(gain('influence', 2))], text: "Draw 1 for each Operation or Counter Operation you've played this turn. Plus 2 Influence." },
  { id: 'triple-point', name: 'Triple Point', kind: 'operation', category: 'covert', type: 'Counter Operation', tier: 'II', cost: { influence: 3, wild: 3 },
    triggers: [onPlay(loy(1), tgtLoy(-1))], text: 'Gain 1 Loyalty, Remove 1 Loyalty. Gain 1 Loyalty or Remove 1 Loyalty. Use at the Start of the Assault Phase: Disable 1 Unit you control, then Disable any 2 units.' },
  { id: 'dissent', name: 'Dissent', kind: 'operation', category: 'covert', type: 'Operation', tier: 'I', cost: { influence: 1, wild: 1 },
    triggers: [onPlay(gain('influence', 1), tgtLoy(-1))], text: 'Remove 1 Loyalty. Plus 1 Influence.' },
  { id: 'trade-posts', name: 'Trade Posts', kind: 'permanent', category: 'diplomacy', type: 'Unit - Orbital Station', tier: 'II', cost: { influence: 2, wild: 4 }, upkeep: 1, stats: { attack: 3, health: 4 },
    text: 'Planetfall: Each Colony places a Loyalty from their reinforcements onto this card. When Colonies attack you, they lose 1 Loyalty and remove a Loyalty cube they own from this card. ACTION (1): Draw 2, then Discard 1. Each other Colony with a Loyalty cube here Draws 1.' },
  { id: 'protectorate-colony', name: 'Protectorate Colony', kind: 'permanent', category: 'diplomacy', type: 'Unit - Micro Colony', tier: 'II', cost: { influence: 2, wild: 5 }, upkeep: 2, stats: { attack: 4, health: 4 }, handBonus: 1,
    text: 'Plus 1 Handsize. Forward; must Defend your Colony if able. Vigilance. XL -> +1 Shields per 2 Loyalty.' },
  { id: 'planetary-unification', name: 'Planetary Unification', kind: 'permanent', category: 'diplomacy', type: 'Fortification', tier: 'II', cost: { influence: 4, wild: 4 }, upkeep: 2, stats: { attack: 0, health: 3 },
    text: 'At the start of your turn, choose up to 3 Colonies; each places 1 Loyalty they control onto this card (counts as Loyalty loss). 3L -> When attacked, your Armies have +1 Shields per Loyalty on this card belonging to the attacker.' },
  { id: 'colony-of-progress', name: 'Colony of Progress', kind: 'permanent', category: 'diplomacy', type: 'Doctrine', tier: 'II', cost: { influence: 3, wild: 4 }, upkeep: 2,
    text: '4L -> Loyalty cubes you control count as 2 Loyalty (does not include Loyalty on this card).' },

  // ---- Warfare / Mercenary ----
  { id: 'retired-veterans', name: 'Retired Veterans', kind: 'permanent', category: 'warfare', type: 'Unit - Human Soldiers', tier: 'I', cost: { wild: 2 }, stats: { attack: 2, health: 2 },
    text: '' },
  { id: 'scythian-footsoldiers', name: 'Scythian Footsoldiers', kind: 'permanent', category: 'mercenary', type: 'Unit - Human Pirates', tier: 'I', cost: { minerals: 1, wild: 1 }, stats: { attack: 2, health: 1 },
    text: 'When expended, gain 1 Wild. 1L -> +1 Shields (before assigning damage to your Army, reduce the total damage by 1).' },
  { id: 'redrock-grunts', name: 'Redrock Grunts', kind: 'permanent', category: 'mercenary', type: 'Unit - Human Pirates', tier: 'I', cost: { minerals: 1, wild: 1 }, upkeep: 1, stats: { attack: 2, health: 2 },
    text: 'Planetfall: Target Colony reveals their hand and discards a resource card. Draw 1. When expended: You may gain a Tier II Resource card.' },
  { id: 'scythian-assassins', name: 'Scythian Assassins', kind: 'permanent', category: 'mercenary', type: 'Unit - Human Marksmen', tier: 'I', cost: { influence: 1, wild: 1 }, upkeep: 1, stats: { attack: 2, health: 1 },
    text: '2L: Do 2 damage to a unit, then expend this unit.' },
  { id: 'avion-bike-squadron', name: 'Avion Bike Squadron', kind: 'permanent', category: 'mercenary', type: 'Unit - Hoverbike Squadron', tier: 'I', cost: { minerals: 2, wild: 1 }, upkeep: 1, stats: { attack: 3, health: 1 }, keywords: ['rush'],
    text: 'Rush (may attack the turn it was played). ACTION (1) during the Assault Phase: Plus 1 Durability until end of turn.' },
  { id: 'protective-services', name: 'Protective Services', kind: 'operation', category: 'warfare', type: 'Operation', tier: 'I', cost: { influence: 1, wild: 2 },
    text: 'Expend any number of units you control, then choose one per expended unit: Gain 2 Integrity. Gain 1 Loyalty.' },
  { id: 'airstrike', name: 'Airstrike', kind: 'operation', category: 'warfare', type: 'Counter Operation', tier: 'I', cost: { wild: 3 },
    triggers: [onPlay(hitColony(-2))], text: 'Do 2 damage to a Colony. Play any time during combat: Do 2 damage to a Unit or Fortification. Shields can block this damage.' },
  { id: 'salvaged-apc', name: 'Salvaged APC', kind: 'permanent', category: 'mercenary', type: 'Mercenary - Transport Machine', tier: 'I', cost: { wild: 4 }, upkeep: 1, stats: { attack: 2, health: 3 }, keywords: [{ kw: 'armor', n: 1 }],
    text: 'Plus 1 Shields. When it enters play, you may place 2 Loyalty on it to give it Rush. 2L -> +1 Durability.' },
  { id: 'hired-thieves', name: 'Hired Thieves', kind: 'permanent', category: 'mercenary', type: 'Enhancement', tier: 'I', cost: { minerals: 1, influence: 1, wild: 2 }, upkeep: 1, stats: { attack: 0, health: 3 },
    text: 'At the start of your Buy Phase, if you dealt damage to a Colony, gain 1 Mineral or Influence for each expended unit you control.' },
  { id: 'kinetic-riflemen', name: 'Kinetic Riflemen', kind: 'permanent', category: 'warfare', type: 'Unit - Human Riflemen', tier: 'I', cost: { minerals: 2, wild: 2 }, upkeep: 1, stats: { attack: 2, health: 3 },
    text: '2L -> +1 Attack. 1L -> +1 Durability.' },
  { id: 'a25-roman-prime', name: 'A-25 Roman Prime', kind: 'permanent', category: 'warfare', type: 'Unit - Experimental Soldier', tier: 'II', cost: { influence: 2, wild: 3 }, upkeep: 1, stats: { attack: 2, health: 4 },
    text: 'ACTION (1): +1 Attack. 1L -> Enemy armies have -2 Shields.' },
  { id: 'scythian-grenadiers', name: 'Scythian Grenadiers', kind: 'permanent', category: 'mercenary', type: 'Unit - Human Demolitionists', tier: 'II', cost: { minerals: 1, influence: 1, wild: 3 }, upkeep: 1, stats: { attack: 3, health: 3 },
    text: 'Opposing Armies fighting this unit have -1 Shields. 1L -> While attacking, the Defender’s Fortifications have base Durability reduced by 1.' },
  { id: 'orbital-relay-network', name: 'Orbital Relay Network', kind: 'permanent', category: 'warfare', type: 'Enhancement', tier: 'II', cost: { minerals: 2, wild: 3 }, upkeep: 1,
    text: 'Units you gain may be placed anywhere in your Deck. 1L -> +1 Wild. 2L -> +1 Wild.' },
  { id: 'redrock-despoilers', name: 'Redrock Despoilers', kind: 'permanent', category: 'mercenary', type: 'Unit - Human Pirates', tier: 'II', cost: { minerals: 2, wild: 4 }, upkeep: 1, stats: { attack: 3, health: 2 },
    text: 'When expended: You may gain a Tier III Resource card. 2L -> +1 Durability. 2L -> +1 Durability.' },
  { id: 'groditz', name: 'Gröditz', kind: 'permanent', category: 'warfare', type: 'Unit - Armored Mech', tier: 'II', cost: { minerals: 1, wild: 5 }, upkeep: 2, stats: { attack: 2, health: 3 }, keywords: [{ kw: 'armor', n: 2 }],
    text: 'Plus 2 Shields. After Defenders are declared, +1 Attack for each enemy unit in Army.' },
  { id: 'redrock-overloaders', name: 'Redrock Overloaders', kind: 'permanent', category: 'mercenary', type: 'Unit - Human Saboteurs', tier: 'II', cost: { minerals: 1, influence: 1, wild: 3 }, upkeep: 1, stats: { attack: 2, health: 3 },
    text: 'ACTION (3): Disable up to 2 Units or Fortifications, then Disable this card.' },
  { id: 'avion-hovertank', name: 'Avion Hovertank', kind: 'permanent', category: 'mercenary', type: 'Unit - Armored Hovertank', tier: 'II', cost: { minerals: 2, wild: 5 }, upkeep: 2, stats: { attack: 4, health: 3 }, keywords: [{ kw: 'armor', n: 2 }, 'rush'],
    text: 'Plus 2 Shields. Rush (may attack the turn it was played).' },
  { id: 'manpower', name: 'Manpower', kind: 'operation', category: 'warfare', type: 'Operation', tier: 'II', cost: { influence: 2, wild: 7 },
    triggers: [onPlay(drawN(3))], text: 'Draw 3. This card costs 1 less (wild resource) for each unit you control.' },
  { id: 'world-dominion', name: 'World Dominion', kind: 'permanent', category: 'warfare', type: 'Fortification', tier: 'II', cost: { minerals: 2, influence: 2, wild: 4 }, upkeep: 2, stats: { attack: 0, health: 3 },
    text: 'Units you control gain Rush. When you deal damage to Fortifications or Colonies, gain Integrity equal to the damage dealt. 4L -> Your armies have +1 Shields and +1 Attack when attacking a Colony with less Integrity than you.' },
  { id: 'starhawk', name: 'Starhawk', kind: 'permanent', category: 'mercenary', type: 'Unit - Transforming Mech', tier: 'II', cost: { minerals: 3, wild: 4 }, upkeep: 2, stats: { attack: 4, health: 4 }, keywords: [{ kw: 'armor', n: 2 }],
    text: 'Plus 2 Shields. 4L -> After Defenders are assigned, produce 4 additional hits and assign them to a unit in an Army. Shields can block this damage.' },

  // ---- Industrial / Structure ----
  { id: 'carbon-hull', name: 'Carbon Hull', kind: 'permanent', category: 'structure', type: 'Fortification', tier: 'I', cost: { minerals: 1, wild: 1 }, stats: { attack: 0, health: 3 },
    text: '' },
  { id: 'repair', name: 'Repair', kind: 'operation', category: 'industrial', type: 'Operation', tier: 'I', cost: { minerals: 1, wild: 1 },
    triggers: [onPlay(integ(2), gain('minerals', 1))], text: 'Gain 2 Integrity. Gain 1 Mineral.' },
  { id: 'radar-tower', name: 'Radar Tower', kind: 'permanent', category: 'structure', type: 'Enhancement', tier: 'I', cost: { minerals: 1, wild: 1 }, upkeep: 1, stats: { attack: 0, health: 2 },
    text: 'When you make a Blind Buy, look at 2 additional cards. 2L -> 1 Wild.' },
  { id: 'lucky-find', name: 'Lucky Find', kind: 'operation', category: 'industrial', type: 'Counter Operation', tier: 'I', cost: { minerals: 2 },
    text: 'You may Waste a card from your hand. +1 Buy. When an opponent gains a Resource card: Gain a Tier II Resource card.' },
  { id: 'trenchers', name: 'Trenchers', kind: 'permanent', category: 'industrial', type: 'Unit - Human Engineers', tier: 'I', cost: { minerals: 2, wild: 1 }, upkeep: 1, stats: { attack: 1, health: 1 }, storageBonus: 1,
    text: 'Plus 1 Storage. 2A + 1R: This unit permanently gains +1/+1, then Exhaust this card.' },
  { id: 'colony-trenches', name: 'Colony Trenches', kind: 'permanent', category: 'structure', type: 'Fortification', tier: 'I', cost: { minerals: 1, wild: 2 }, upkeep: 1, stats: { attack: 0, health: 2 },
    text: 'Before you declare Defenders: Ready up to 2 Units you control; they gain 1 Attack and 1 Durability until end of turn.' },
  { id: 'courier-network', name: 'Courier Network', kind: 'permanent', category: 'industrial', type: 'Enhancement', tier: 'I', cost: { minerals: 2, wild: 2 }, upkeep: 1, storageBonus: 1,
    text: 'Plus 1 Storage. 1A during the Buy Phase: The next Action Card you Buy this turn costs 1 less Influence.' },
  { id: 'recycling-initiatives', name: 'Recycling Initiatives', kind: 'operation', category: 'industrial', type: 'Operation', tier: 'I', cost: { minerals: 1, wild: 3 },
    triggers: [onPlay(drawN(1), integ(2))], text: 'You may Waste a card from your hand. Draw 1. Gain 2 Integrity.' },
  { id: 'satellite-comms', name: 'Satellite Comms', kind: 'permanent', category: 'structure', type: 'Enhancement', tier: 'I', cost: { minerals: 3, wild: 1 }, upkeep: 1, handBonus: 1,
    text: 'Plus 1 Handsize.' },
  { id: 'carbon-tank', name: 'Carbon Tank', kind: 'permanent', category: 'industrial', type: 'Unit - Armored Tank', tier: 'II', cost: { minerals: 2, wild: 2 }, upkeep: 1, stats: { attack: 3, health: 2 }, keywords: [{ kw: 'armor', n: 1 }],
    text: 'Plus 1 Shields. ACTION (3): Attach a Resource card from your hand onto this card; while attached, this unit has no Power Upkeep.' },
  { id: 'resource-silos', name: 'Resource Silos', kind: 'permanent', category: 'structure', type: 'Enhancement', tier: 'II', cost: { minerals: 2, wild: 3 }, upkeep: 1, storageBonus: 2, buyBonus: 2,
    text: 'Plus 2 Storage. Plus 2 Buys. 3L -> +1 Mineral, +1 Wild.' },
  { id: 'barracks', name: 'Barracks', kind: 'permanent', category: 'structure', type: 'Fortification', tier: 'II', cost: { minerals: 2, wild: 3 }, upkeep: 1, stats: { attack: 0, health: 4 },
    text: 'All units you control have +1 Durability.' },
  { id: 'firing-range', name: 'Firing Range', kind: 'permanent', category: 'structure', type: 'Fortification', tier: 'II', cost: { minerals: 3, wild: 2 }, upkeep: 1, stats: { attack: 0, health: 4 },
    text: 'Units you control have +1 Attack.' },
  { id: 'docking-bay', name: 'Docking Bay', kind: 'permanent', category: 'structure', type: 'Enhancement', tier: 'II', cost: { minerals: 2, wild: 3 }, upkeep: 1, buyBonus: 1,
    text: 'Plus 1 Buy. Silicon and Titanium you Buy have their Mineral costs waived.' },
  { id: 'capacitor-bay', name: 'Capacitor Bay', kind: 'permanent', category: 'structure', type: 'Enhancement', tier: 'II', cost: { minerals: 2, wild: 4 }, upkeep: 1,
    text: 'Batteries you Buy cost 2 less Resources. 2L -> Batteries you gain may be placed on the top of your deck.' },
  { id: 'titanic-freighter', name: 'Titanic Freighter', kind: 'operation', category: 'structure', type: 'Operation', tier: 'II', cost: { minerals: 3, wild: 3 },
    text: 'Waste up to 1 card from your hand. Gain a Tier III Resource card.' },
  { id: 'emergency-action-plan', name: 'Emergency Action Plan', kind: 'operation', category: 'industrial', type: 'Operation', tier: 'II', cost: { minerals: 2, wild: 4 },
    triggers: [onPlay(integ(4), gain('minerals', 2), drawN(2))], text: 'Gain 4 Integrity. Gain 2 Minerals. Draw 2.' },
  { id: 'symbol-of-unity', name: 'Symbol of Unity', kind: 'permanent', category: 'structure', type: 'Enhancement', tier: 'II', cost: { minerals: 3, wild: 4 }, upkeep: 2,
    text: 'Up to thrice per turn, whenever you gain Integrity or Loyalty, Draw 1. A2 -> Gain 2 Integrity or 1 Loyalty, then exhaust this card.' },
  { id: 'kinetic-artillery', name: 'Kinetic Artillery', kind: 'permanent', category: 'structure', type: 'Unit - Heavy Artillery', tier: 'II', cost: { minerals: 2, wild: 5 }, upkeep: 2, stats: { attack: 3, health: 5 },
    text: 'Must Defend your Colony if able. 4L -> Enemy Armies lose -1 Shields per Loyalty.' },
  { id: 'sectorwide-expansion', name: 'Sectorwide Expansion', kind: 'permanent', category: 'structure', type: 'Fortification', tier: 'II', cost: { minerals: 3, wild: 5 }, upkeep: 2, stats: { attack: 0, health: 4 }, handBonus: 1, storageBonus: 1, buyBonus: 1,
    text: 'Plus 1 Handsize, +1 Storage, +1 Buy. You may have more than 20 Integrity. ACTION (2): pay 3 Minerals per "Sectorwide Expansion" you control to create a token copy (token needs no power).' },

// ---- Battery (power) ----
  { id: 'solar-power-grid', name: 'Solar Power Grid', kind: 'permanent', category: 'battery', type: 'Permanent', tier: 'II', cost: { wild: 2 }, produces: 1,
    text: 'Plus 1 Power.' },
  { id: 'battery-unit', name: 'Battery Unit', kind: 'permanent', category: 'battery', type: 'Permanent', tier: 'II', cost: { wild: 5 }, produces: 2,
    text: 'Plus 2 Power.\nPlus 1 Storage.', storageBonus: 1 },
  { id: 'fusion-reactor', name: 'Fusion Reactor', kind: 'permanent', category: 'battery', type: 'Battery', tier: 'II', cost: { wild: 8 }, produces: 3,
    text: 'Plus 3 Power.\nPlus 1 Handsize' , handBonus: 1},
  ];

export const CATALOG = new Map(CARDS.map((c) => [c.id, c]));

// -----------------------------------------------------------------------------
// Game setup: starting board + deck and the buy-stack fill rates.
// The colony's 20 Integrity / 3 Loyalty / 1 Storage live on the Player record
// (engine START), so only the Colony Core is placed on the board at start.
// The starting deck mirrors the spreadsheet's 14-card "Starting Deck".
// -----------------------------------------------------------------------------
export const SETUP: SetupConfig = {
  startingBoard: ['colony-core'],
  startingDeck: [
    'silicon', 'silicon', 'silicon', 'silicon',
    'compromise', 'compromise', 'compromise', 'compromise',
    'battery-processor', 'battery-processor',
    'colony-drones', 'colony-drones',
    'colony-aid', 'colony-aid',
  ],
  resourceCopies: 20,   // resource stacks are deep (you buy from them constantly)
  actionCopies: 4,      // 4 copies per action card, per the sheet's design note
  // objectiveFlavors omitted → the engine draws 3 random Directives each game.
};
