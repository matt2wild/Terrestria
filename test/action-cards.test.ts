// =============================================================================
// test/action-cards.test.ts — one block per ACTION card in the catalog.
//
// Each card gets:
//   • A normal test for the parts the engine ALREADY models (encoded onPlay
//     triggers, costs, stats, keywords, passive hand/storage/buy/power bonuses).
//     These should pass today.
//   • `{ todo: true }` tests for every mechanic the card's text describes that
//     the engine does NOT yet model. A todo test that fails is reported as a
//     pending TODO (it does NOT fail the suite); once the mechanic is built the
//     test should go green and the `todo` flag can be dropped.
//
// The companion breakdown of which mechanics are missing (and why) lives in
// card-mechanics-gaps.md at the repo root.
//
// Resource-gain assertions use the wallet-delta helper `gainedRes` so they are
// robust to which pool paid the cost and to directive openers; loyalty / integrity
// / draw assertions use before/after deltas for the same reason.
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, newGame, step, newInst } from './helpers.js';
import { eff, hasKw } from '../engine.js';
import type { GameState, PlayerId } from '../engine.js';

// --- local helpers -----------------------------------------------------------
const handCount = (s: GameState, p: PlayerId): number =>
  Object.values(s.instances).filter((i) => i.controller === p && i.zone === 'hand').length;
const wallet = (s: GameState, p: PlayerId): number => s.players[p].minerals + s.players[p].influence;
const costUnits = (defId: string): number => {
  const c = CATALOG.get(defId)!.cost ?? {};
  return (c.minerals ?? 0) + (c.influence ?? 0) + (c.wild ?? 0);
};
// Net resources banked by playing `defId` (cancels out whatever pool paid the cost).
const gainedRes = (sBefore: GameState, sAfter: GameState, defId: string): number =>
  wallet(sAfter, 'A') - wallet(sBefore, 'A') + costUnits(defId);

// Give A a deep wallet so play costs never reject the action under test.
const rich = (s: GameState, p: PlayerId = 'A', m = 99, i = 99): void => { s.players[p].minerals = m; s.players[p].influence = i; };
// Put `n` upkeep-free power producers on the board so upkeep-N cards don't brown out.
const power = (s: GameState, p: PlayerId, n: number): void => { for (let k = 0; k < n; k++) newInst(s, 'battery-processor', p, 'board'); };
// Play a card from hand; returns the new state and the instance id.
function play(s: GameState, p: PlayerId, defId: string, chosen?: PlayerId[]): { s: GameState; id: string } {
  const c = newInst(s, defId, p, 'hand');
  return { s: step(s, p, { type: 'playCard', instId: c.id, chosen }), id: c.id };
}
// Pass A → B → back to A so A refreshes (passive bonuses recompute, power is paid).
function refreshA(s: GameState): GameState {
  s = step(s, 'A', { type: 'endTurn' });
  s = step(s, 'B', { type: 'endTurn' });
  return s;
}

// =============================================================================
// FOUNDER OPERATIONS (Choose-One modals)
// =============================================================================
test('colony-drones: encoded mode gains 2 Integrity', () => {
  let s = newGame(); rich(s);
  const before = s.players.A.integrity;
  const r = play(s, 'A', 'colony-drones');
  assert.equal(r.s.players.A.integrity, before + 2);
  assert.equal(r.s.instances[r.id].zone, 'discard');
});
test('colony-drones: alternate mode "Gain 1 Mineral or Influence"', { todo: true }, () => {
  // Choose-One is not modeled — the engine always applies the first (integrity) mode.
  let s = newGame(); rich(s, 'A', 0, 0);
  const before = wallet(s, 'A');
  const r = play(s, 'A', 'colony-drones'); // intend: pick the resource mode
  assert.equal(wallet(r.s, 'A'), before + 1, 'should be able to choose +1 resource instead');
});

test('colony-aid: encoded mode gains 1 Loyalty', () => {
  let s = newGame(); rich(s);
  const before = s.players.A.loyalty;
  const r = play(s, 'A', 'colony-aid');
  assert.equal(r.s.players.A.loyalty, before + 1);
});
test('colony-aid: alternate mode "Pay 1 Loyalty, Waste 1"', { todo: true }, () => {
  // No Choose-One, and no "Waste a card from hand" effect exists.
  assert.ok(false, 'TODO(engine): modal choice + Waste-from-hand not modeled');
});

// =============================================================================
// DIPLOMACY / COVERT
// =============================================================================
test('peaceful-protests: encoded +1 Loyalty on play', () => {
  let s = newGame(); rich(s);
  const before = s.players.A.loyalty;
  const r = play(s, 'A', 'peaceful-protests');
  assert.equal(r.s.players.A.loyalty, before + 1);
});
test('peaceful-protests: Expend a Unit/Fortification, then cancel an attack (counter)', { todo: true }, () => {
  // Needs: Expend cost, instant-speed Counter Operation play during the attack
  // gate, attack cancellation, and "owner loses 1 Loyalty".
  assert.ok(false, 'TODO(engine): Expend + Counter-Operation timing + cancel-attack not modeled');
});

test('improve-relations: card is playable and cycles to discard', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'improve-relations');
  assert.equal(r.s.instances[r.id].zone, 'discard');
});
test('improve-relations: Choose-One should apply only ONE of draw/loyalty/buy', { todo: true }, () => {
  // BUG/GAP: the catalog encodes BOTH drawN(1) AND loy(1); the card is "Choose One".
  let s = newGame(); rich(s);
  const loyBefore = s.players.A.loyalty;
  const handBefore = handCount(s, 'A');
  const r = play(s, 'A', 'improve-relations');
  const drew = handCount(r.s, 'A') - handBefore;
  const gainedLoy = r.s.players.A.loyalty - loyBefore;
  assert.equal(drew + gainedLoy, 1, 'exactly one mode should resolve, not both');
});
test('improve-relations: opponent may take an unchosen mode (interactive modal)', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): opponent-picks-a-mode interaction + "-1 Hard cost buy" mode not modeled');
});

test('propaganda: encoded +1 Influence and target gains 1 Loyalty', () => {
  let s = newGame(); rich(s);
  const loyB = s.players.B.loyalty;
  const r = play(s, 'A', 'propaganda'); // default target = opponent B
  assert.equal(gainedRes(s, r.s, 'propaganda'), 1, '+1 Influence banked');
  assert.equal(r.s.players.B.loyalty, loyB + 1, 'target colony gains 1 Loyalty');
});
test('propaganda: may target your own colony for the Loyalty', () => {
  let s = newGame(); rich(s);
  const loyA = s.players.A.loyalty;
  const r = play(s, 'A', 'propaganda', ['A']); // chosen self
  assert.equal(r.s.players.A.loyalty, loyA + 1);
});

test('priority-briefings: enters play as an Enhancement permanent', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'priority-briefings');
  assert.equal(r.s.instances[r.id].zone, 'board');
});
test('priority-briefings: "look at top card any time" (deck peek)', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): top-of-deck peek / scry not modeled');
});
test('priority-briefings: ACTION (2): Draw a card (power-cost activated ability)', { todo: true }, () => {
  // onActivate exists but its cost is ResCost (no energy field), and nothing is encoded.
  assert.ok(false, 'TODO(engine): ACTION (n) power-cost activated abilities not representable');
});

test('trade-agreement: encoded self draws 2', () => {
  let s = newGame(); rich(s);
  const before = handCount(s, 'A');
  const r = play(s, 'A', 'trade-agreement');
  assert.equal(handCount(r.s, 'A'), before + 2);
});
test('trade-agreement: the OTHER target Colony should also Draw 2', { todo: true }, () => {
  let s = newGame(); rich(s);
  const before = handCount(s, 'B');
  const r = play(s, 'A', 'trade-agreement', ['B']);
  assert.equal(handCount(r.s, 'B'), before + 2, 'opponent should draw too');
});

test('impassioned-speakers: enters play as a 1/3 Unit with upkeep 1', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'impassioned-speakers');
  const c = r.s.instances[r.id];
  assert.equal(c.zone, 'board');
  assert.deepEqual(eff(r.s, c), { attack: 1, health: 3 });
});
test('impassioned-speakers: when you Defend, each opposing Colony loses 1 Loyalty', { todo: true }, () => {
  // No onDefend event is dispatched anywhere.
  let s = newGame();
  s = step(s, 'A', { type: 'endTurn' }); // B's turn — B attacks, A defends
  const sp = newInst(s, 'impassioned-speakers', 'A', 'board');
  const atk = newInst(s, 'retired-veterans', 'B', 'board');
  const loyB = s.players.B.loyalty;
  s = step(s, 'B', { type: 'declareAttack', attacks: [{ attackerId: atk.id, target: { player: 'A' } }] });
  s = step(s, 'A', { type: 'respondToAttack', blocks: [{ blockerId: sp.id, attackerId: atk.id }] });
  assert.equal(s.players.B.loyalty, loyB - 1, 'defending should drain attacker Loyalty');
});

test('infrastructure-projects: passive +1 Buy applies at Refresh', () => {
  let s = newGame();
  newInst(s, 'infrastructure-projects', 'A', 'board'); // buyBonus 1, upkeep 1
  s = refreshA(s);
  assert.equal(s.players.A.buys, 2); // base 1 + 1
});
test('infrastructure-projects: ACTION (1) during Buy Phase — bought actions cost 1 less Mineral', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): ACTION (n) ability + per-turn buy-cost reduction not modeled');
});

test('diplomatic-corps: enters play as a 0/3 Enhancement with upkeep 1', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'diplomatic-corps');
  assert.equal(r.s.instances[r.id].zone, 'board');
});
test('diplomatic-corps: spend 1 Influence to add +1 when you gain Loyalty', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): replacement trigger on Loyalty gain not modeled');
});
test('diplomatic-corps: ACTION (3): Draw 2, Discard 1', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): ACTION (n) ability + Discard effect not modeled');
});

test('non-aggression-pact: encoded self Draws 2 and gains 1 Loyalty', () => {
  let s = newGame(); rich(s);
  const before = handCount(s, 'A');
  const loyA = s.players.A.loyalty;
  const r = play(s, 'A', 'non-aggression-pact');
  assert.equal(handCount(r.s, 'A'), before + 2);
  assert.equal(r.s.players.A.loyalty, loyA + 1);
});
test('non-aggression-pact: partner also Draws 2 / gains Loyalty and a binding attack-tax forms', { todo: true }, () => {
  // The opponent benefit + the "pay 1 Loyalty & Discard 2 before attacking" tax (a
  // temporary Pact-like restriction) are not modeled. formPact() exists but is unused here.
  let s = newGame(); rich(s);
  const before = handCount(s, 'B');
  const r = play(s, 'A', 'non-aggression-pact', ['B']);
  assert.equal(handCount(r.s, 'B'), before + 2, 'partner should draw too');
});

test('evacuate: encoded +1 Loyalty on play', () => {
  let s = newGame(); rich(s);
  const before = s.players.A.loyalty;
  const r = play(s, 'A', 'evacuate');
  assert.equal(r.s.players.A.loyalty, before + 1);
});
test('evacuate: Waste a card, and Disable/remove a unit from combat (Counter)', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): Waste-from-hand + Disable + combat removal + counter timing not modeled');
});

test('a-new-start: encoded +1 Loyalty self and -1 Loyalty to every opponent', () => {
  let s = newGame(); rich(s);
  const loyA = s.players.A.loyalty, loyB = s.players.B.loyalty;
  const r = play(s, 'A', 'a-new-start');
  assert.equal(r.s.players.A.loyalty, loyA + 1);
  assert.equal(r.s.players.B.loyalty, loyB - 1);
});

test('indoctrination: encoded +2 Influence and target gains 2 Loyalty', () => {
  let s = newGame(); rich(s);
  const loyB = s.players.B.loyalty;
  const r = play(s, 'A', 'indoctrination');
  assert.equal(gainedRes(s, r.s, 'indoctrination'), 2);
  assert.equal(r.s.players.B.loyalty, loyB + 2);
});

test('breaking-relations: encoded +2 Influence and target loses 2 Loyalty', () => {
  let s = newGame(); rich(s);
  const loyB = s.players.B.loyalty;
  const r = play(s, 'A', 'breaking-relations');
  assert.equal(gainedRes(s, r.s, 'breaking-relations'), 2);
  assert.equal(r.s.players.B.loyalty, loyB - 2);
});
test('breaking-relations: each opponent that lost Loyalty this turn Discards 1', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): Discard effect + "lost-loyalty-this-turn" tracking not modeled');
});

test('interrogations: encoded +2 Influence on play', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'interrogations');
  assert.equal(gainedRes(s, r.s, 'interrogations'), 2);
});
test('interrogations: Draw 1 per Operation/Counter-Op played this turn', { todo: true }, () => {
  // Nothing tracks "operations played this turn", and no draw is encoded.
  let s = newGame(); rich(s);
  play(s, 'A', 'dissent');        // 1 operation already this turn
  const handBefore = handCount(s, 'A');
  const r = play(s, 'A', 'interrogations');
  assert.ok(handCount(r.s, 'A') - handBefore >= 1, 'should draw for prior operations');
});

test('triple-point: encoded +1 Loyalty self and -1 Loyalty target', () => {
  let s = newGame(); rich(s);
  const loyA = s.players.A.loyalty, loyB = s.players.B.loyalty;
  const r = play(s, 'A', 'triple-point');
  assert.equal(r.s.players.A.loyalty, loyA + 1);
  assert.equal(r.s.players.B.loyalty, loyB - 1);
});
test('triple-point: second modal Loyalty swing + Assault-phase Disable chain', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): modal choice + Disable + assault-phase timing not modeled');
});

test('dissent: encoded +1 Influence and target loses 1 Loyalty', () => {
  let s = newGame(); rich(s);
  const loyB = s.players.B.loyalty;
  const r = play(s, 'A', 'dissent');
  assert.equal(gainedRes(s, r.s, 'dissent'), 1);
  assert.equal(r.s.players.B.loyalty, loyB - 1);
});

test('trade-posts: enters play as a 3/4 Orbital Station Unit', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'trade-posts');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 3, health: 4 });
});
test('trade-posts: Planetfall loyalty-cube seeding', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): Planetfall trigger + loyalty cubes on cards not modeled');
});
test('trade-posts: attackers lose Loyalty + remove a cube; ACTION (1) shared draw', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): whenAttacked trigger + loyalty cubes + ACTION (n) not modeled');
});

test('protectorate-colony: passive +1 Handsize applies at Refresh', () => {
  let s = newGame();
  newInst(s, 'protectorate-colony', 'A', 'board'); // handBonus 1, upkeep 2
  power(s, 'A', 2); // cover upkeep 2 so it doesn't brown out
  s = refreshA(s);
  assert.equal(s.players.A.handSize, 6); // base 5 + 1
});
test('protectorate-colony: Forward / must-Defend / Vigilance / XL Loyalty-scaling Shields', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): Forward, must-Defend, Vigilance, and Loyalty-threshold (XL ->) Shields not modeled');
});

test('planetary-unification: enters play as a 0/3 Fortification', () => {
  let s = newGame(); rich(s); power(s, 'A', 2);
  const r = play(s, 'A', 'planetary-unification');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 0, health: 3 });
});
test('planetary-unification: start-of-turn loyalty-cube placement + 3L attacked-Shields', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): start-of-turn cube placement + Loyalty-threshold whenAttacked Shields not modeled');
});

test('colony-of-progress: enters play as a Doctrine permanent', () => {
  let s = newGame(); rich(s); power(s, 'A', 2);
  const r = play(s, 'A', 'colony-of-progress');
  assert.equal(r.s.instances[r.id].zone, 'board');
});
test('colony-of-progress: 4L -> your Loyalty cubes count as 2 Loyalty', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): Loyalty-threshold mode + loyalty-cube valuation not modeled');
});

// =============================================================================
// WARFARE / MERCENARY
// =============================================================================
test('retired-veterans: vanilla 2/2 Unit, no text', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'retired-veterans');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 2, health: 2 });
});

test('scythian-footsoldiers: enters play as a 2/1 Unit', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'scythian-footsoldiers');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 2, health: 1 });
});
test('scythian-footsoldiers: when expended gain 1 Wild; 1L -> +1 Shields', { todo: true }, () => {
  // onExpend trigger, a gainable "Wild" pool, and Loyalty-threshold Shields all missing.
  assert.ok(false, 'TODO(engine): onExpend + gain-Wild + Loyalty-threshold Shields not modeled');
});

test('redrock-grunts: enters play as a 2/2 Unit with upkeep 1', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'redrock-grunts');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 2, health: 2 });
});
test('redrock-grunts: Planetfall hand-reveal + resource discard; onExpend gain a Tier II Resource', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): Planetfall + reveal hand + targeted Discard + onExpend gain-a-card not modeled');
});

test('scythian-assassins: enters play as a 2/1 Unit with upkeep 1', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'scythian-assassins');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 2, health: 1 });
});
test('scythian-assassins: 2L: Do 2 damage to a unit, then expend this unit', { todo: true }, () => {
  // Loyalty-cost activated ability + direct damage to a chosen unit + self-expend.
  assert.ok(false, 'TODO(engine): Loyalty-cost activated ability + targeted unit damage + expend not modeled');
});

test('avion-bike-squadron: 3/1 Unit with Rush may attack the turn it lands', () => {
  let s = newGame();
  const u = newInst(s, 'avion-bike-squadron', 'A', 'board');
  s.instances[u.id].summonedThisTurn = true;
  assert.equal(hasKw(s, s.instances[u.id], 'rush'), true);
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  assert.ok(s.pending, 'rush bypasses summoning sickness');
});
test('avion-bike-squadron: ACTION (1) during Assault Phase: +1 Durability EOT', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): ACTION (n) ability + temporary Durability buff not modeled');
});

test('protective-services: card is playable and cycles to discard', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'protective-services');
  assert.equal(r.s.instances[r.id].zone, 'discard');
});
test('protective-services: Expend N units, choose +2 Integrity or +1 Loyalty each', { todo: true }, () => {
  // No triggers encoded at all; needs Expend-as-cost + per-unit modal choice.
  let s = newGame(); rich(s);
  newInst(s, 'retired-veterans', 'A', 'board');
  const before = s.players.A.integrity;
  const r = play(s, 'A', 'protective-services');
  assert.ok(r.s.players.A.integrity > before, 'expending a unit should yield Integrity/Loyalty');
});

test('airstrike: encoded — Do 2 damage to a Colony', () => {
  let s = newGame(); rich(s);
  const intB = s.players.B.integrity;
  const r = play(s, 'A', 'airstrike'); // default target B
  assert.equal(r.s.players.B.integrity, intB - 2);
});
test('airstrike: combat-time mode — Do 2 damage to a Unit/Fortification (Shields block)', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): instant combat-time play + damage-to-permanent mode + Shield interaction not modeled');
});

test('salvaged-apc: 2/3 Transport with Armor 1 (Plus 1 Shields)', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'salvaged-apc');
  assert.equal(hasKw(r.s, r.s.instances[r.id], 'armor'), true);
});
test('salvaged-apc: on enter, may pay 2 Loyalty for Rush; 2L -> +1 Durability', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): enter-play optional Loyalty-for-keyword + Loyalty-threshold Durability not modeled');
});

test('hired-thieves: enters play as a 0/3 Enhancement with upkeep 1', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'hired-thieves');
  assert.equal(r.s.instances[r.id].zone, 'board');
});
test('hired-thieves: start of Buy Phase, if you damaged a Colony, gain res per expended unit', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): start-of-Buy-Phase trigger + expended-unit count + conditional payout not modeled');
});

test('kinetic-riflemen: enters play as a 2/3 Unit', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'kinetic-riflemen');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 2, health: 3 });
});
test('kinetic-riflemen: 2L -> +1 Attack and 1L -> +1 Durability', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): Loyalty-threshold stat modes not modeled');
});

test('a25-roman-prime: enters play as a 2/4 Unit', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'a25-roman-prime');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 2, health: 4 });
});
test('a25-roman-prime: ACTION (1): +1 Attack; 1L -> Enemy armies -2 Shields', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): ACTION (n) ability + enemy-army Shield aura not modeled');
});

test('scythian-grenadiers: enters play as a 3/3 Unit', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'scythian-grenadiers');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 3, health: 3 });
});
test('scythian-grenadiers: opposing Armies have -1 Shields; 1L -> reduce Fort Durability', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): combat Shield aura + Loyalty-threshold Fortification debuff not modeled');
});

test('orbital-relay-network: enters play as an Enhancement with upkeep 1', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'orbital-relay-network');
  assert.equal(r.s.instances[r.id].zone, 'board');
});
test('orbital-relay-network: gained Units may go anywhere in deck; 1L/2L -> +1 Wild', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): deck-placement on gain + Loyalty-threshold gain-Wild not modeled');
});

test('redrock-despoilers: enters play as a 3/2 Unit', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'redrock-despoilers');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 3, health: 2 });
});
test('redrock-despoilers: onExpend gain a Tier III Resource; 2L -> +1 Durability (x2)', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): onExpend gain-a-card + Loyalty-threshold Durability not modeled');
});

test('groditz: 2/3 Armored Mech with Armor 2 (Plus 2 Shields)', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'groditz');
  assert.equal(hasKw(r.s, r.s.instances[r.id], 'armor'), true);
});
test('groditz: after Defenders declared, +1 Attack per enemy unit in the Army', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): after-Defenders combat trigger + conditional Attack buff not modeled');
});

test('redrock-overloaders: enters play as a 2/3 Unit', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'redrock-overloaders');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 2, health: 3 });
});
test('redrock-overloaders: ACTION (3): Disable up to 2 Units/Forts, then Disable self', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): ACTION (n) ability + Disable effect not modeled');
});

test('avion-hovertank: 4/3 Unit with Armor 2 and Rush — both modeled', () => {
  let s = newGame();
  const u = newInst(s, 'avion-hovertank', 'A', 'board');
  assert.deepEqual(eff(s, s.instances[u.id]), { attack: 4, health: 3 });
  assert.equal(hasKw(s, s.instances[u.id], 'armor'), true);
  s.instances[u.id].summonedThisTurn = true;
  s = step(s, 'A', { type: 'declareAttack', attacks: [{ attackerId: u.id, target: { player: 'B' } }] });
  assert.ok(s.pending, 'Rush lets it attack immediately');
});

test('manpower: encoded — Draw 3', () => {
  let s = newGame(); rich(s);
  const before = handCount(s, 'A');
  const r = play(s, 'A', 'manpower');
  assert.equal(handCount(r.s, 'A'), before + 3);
});
test('manpower: costs 1 less Wild per Unit you control (dynamic cost reduction)', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): dynamic play-cost reduction not modeled');
});

test('world-dominion: enters play as a 0/3 Fortification', () => {
  let s = newGame(); rich(s); power(s, 'A', 2);
  const r = play(s, 'A', 'world-dominion');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 0, health: 3 });
});
test('world-dominion: grants Rush to all your Units (passive aura)', { todo: true }, () => {
  let s = newGame();
  newInst(s, 'world-dominion', 'A', 'board');
  const u = newInst(s, 'retired-veterans', 'A', 'board');
  assert.equal(hasKw(s, s.instances[u.id], 'rush'), true, 'all your units should have Rush');
});
test('world-dominion: lifegain on damage to Forts/Colonies; 4L -> combat buff', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): on-deal-damage lifegain trigger + Loyalty-threshold combat buff not modeled');
});

test('starhawk: 4/4 Unit with Armor 2', () => {
  let s = newGame(); rich(s); power(s, 'A', 2);
  const r = play(s, 'A', 'starhawk');
  assert.equal(hasKw(r.s, r.s.instances[r.id], 'armor'), true);
});
test('starhawk: 4L -> after Defenders assigned, produce 4 extra hits', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): Loyalty-threshold mode + extra-hits combat effect not modeled');
});

// =============================================================================
// INDUSTRIAL / STRUCTURE
// =============================================================================
test('carbon-hull: vanilla 0/3 Fortification', () => {
  let s = newGame();
  const f = newInst(s, 'carbon-hull', 'A', 'board');
  assert.deepEqual(eff(s, s.instances[f.id]), { attack: 0, health: 3 });
});

test('repair: encoded +2 Integrity and +1 Mineral', () => {
  let s = newGame(); rich(s);
  const intA = s.players.A.integrity;
  const r = play(s, 'A', 'repair');
  assert.equal(r.s.players.A.integrity, intA + 2);
  assert.equal(gainedRes(s, r.s, 'repair'), 1);
});

test('radar-tower: enters play as a 0/2 Enhancement', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'radar-tower');
  assert.equal(r.s.instances[r.id].zone, 'board');
});
test('radar-tower: Blind-Buy scout (+2 cards look); 2L -> 1 Wild', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): Blind-Buy scouting + Loyalty-threshold gain-Wild not modeled');
});

test('lucky-find: card is playable and cycles to discard', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'lucky-find');
  assert.equal(r.s.instances[r.id].zone, 'discard');
});
test('lucky-find: one-shot +1 Buy', { todo: true }, () => {
  // No effect op modifies `buys`; +Buy only exists as a passive permanent stat.
  let s = newGame(); rich(s);
  const before = s.players.A.buys;
  const r = play(s, 'A', 'lucky-find');
  assert.equal(r.s.players.A.buys, before + 1);
});
test('lucky-find: Waste a card; when an opponent gains a Resource card, gain a Tier II Resource', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): Waste-from-hand + opponent-gain trigger + gain-a-card not modeled');
});

test('trenchers: passive +1 Storage applies at Refresh', () => {
  let s = newGame();
  newInst(s, 'trenchers', 'A', 'board'); // storageBonus 1, upkeep 1
  s = refreshA(s);
  assert.equal(s.players.A.storage, 2); // base 1 + 1
});
test('trenchers: "2A + 1R" -> permanent +1/+1 then Exhaust', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): attack/resource activation cost + permanent stat growth + Exhaust not modeled');
});

test('colony-trenches: enters play as a 0/2 Fortification', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'colony-trenches');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 0, health: 2 });
});
test('colony-trenches: before declaring Defenders, Ready 2 Units and buff them EOT', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): pre-Defender trigger + Ready (untap) effect + temporary buffs not modeled');
});

test('courier-network: passive +1 Storage applies at Refresh', () => {
  let s = newGame();
  newInst(s, 'courier-network', 'A', 'board'); // storageBonus 1, upkeep 1
  s = refreshA(s);
  assert.equal(s.players.A.storage, 2);
});
test('courier-network: 1A during Buy Phase — next bought Action costs 1 less Influence', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): activation cost + per-turn buy-cost reduction not modeled');
});

test('recycling-initiatives: encoded — Draw 1 and +2 Integrity', () => {
  let s = newGame(); rich(s);
  const before = handCount(s, 'A');
  const intA = s.players.A.integrity;
  const r = play(s, 'A', 'recycling-initiatives');
  assert.equal(handCount(r.s, 'A'), before + 1);
  assert.equal(r.s.players.A.integrity, intA + 2);
});
test('recycling-initiatives: "you may Waste a card from your hand"', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): Waste-from-hand not modeled');
});

test('satellite-comms: passive +1 Handsize applies at Refresh', () => {
  let s = newGame();
  newInst(s, 'satellite-comms', 'A', 'board'); // handBonus 1, upkeep 1
  s = refreshA(s);
  assert.equal(s.players.A.handSize, 6);
});

test('carbon-tank: 3/2 Unit with Armor 1', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'carbon-tank');
  assert.equal(hasKw(r.s, r.s.instances[r.id], 'armor'), true);
});
test('carbon-tank: ACTION (3): attach a Resource card to waive Power Upkeep', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): ACTION (n) attach-from-hand + upkeep-waiving attachment not modeled');
});

test('resource-silos: passive +2 Storage and +2 Buys apply at Refresh', () => {
  let s = newGame();
  newInst(s, 'resource-silos', 'A', 'board'); // storageBonus 2, buyBonus 2, upkeep 1
  s = refreshA(s);
  assert.equal(s.players.A.storage, 3);
  assert.equal(s.players.A.buys, 3);
});
test('resource-silos: 3L -> +1 Mineral, +1 Wild', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): Loyalty-threshold mode + gain-Wild not modeled');
});

test('barracks: enters play as a 0/4 Fortification', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'barracks');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 0, health: 4 });
});
test('barracks: all Units you control have +1 Durability (passive aura)', { todo: true }, () => {
  let s = newGame();
  newInst(s, 'barracks', 'A', 'board');
  const u = newInst(s, 'retired-veterans', 'A', 'board'); // base 2/2
  assert.equal(eff(s, s.instances[u.id]).health, 3, 'units should gain +1 health/durability');
});

test('firing-range: enters play as a 0/4 Fortification', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'firing-range');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 0, health: 4 });
});
test('firing-range: all Units you control have +1 Attack (passive aura)', { todo: true }, () => {
  let s = newGame();
  newInst(s, 'firing-range', 'A', 'board');
  const u = newInst(s, 'retired-veterans', 'A', 'board'); // base 2/2
  assert.equal(eff(s, s.instances[u.id]).attack, 3, 'units should gain +1 attack');
});

test('docking-bay: passive +1 Buy applies at Refresh', () => {
  let s = newGame();
  newInst(s, 'docking-bay', 'A', 'board'); // buyBonus 1, upkeep 1
  s = refreshA(s);
  assert.equal(s.players.A.buys, 2);
});
test('docking-bay: Silicon and Titanium you Buy have Mineral costs waived', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): conditional buy-cost waiver by card not modeled');
});

test('capacitor-bay: enters play as an Enhancement with upkeep 1', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'capacitor-bay');
  assert.equal(r.s.instances[r.id].zone, 'board');
});
test('capacitor-bay: Batteries cost 2 less; 2L -> Batteries to top of deck', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): buy-cost reduction by category + Loyalty-threshold deck placement not modeled');
});

test('titanic-freighter: card is playable and cycles to discard', () => {
  let s = newGame(); rich(s);
  const r = play(s, 'A', 'titanic-freighter');
  assert.equal(r.s.instances[r.id].zone, 'discard');
});
test('titanic-freighter: Waste up to 1 card; gain a Tier III Resource card', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): Waste-from-hand + gain-a-specific-card-from-supply not modeled');
});

test('emergency-action-plan: encoded +4 Integrity, +2 Minerals, Draw 2', () => {
  let s = newGame(); rich(s);
  const intA = s.players.A.integrity;
  const before = handCount(s, 'A');
  const r = play(s, 'A', 'emergency-action-plan');
  assert.equal(r.s.players.A.integrity, intA + 4);
  assert.equal(gainedRes(s, r.s, 'emergency-action-plan'), 2);
  assert.equal(handCount(r.s, 'A'), before + 2);
});

test('symbol-of-unity: enters play as an Enhancement with upkeep 2', () => {
  let s = newGame(); rich(s); power(s, 'A', 2);
  const r = play(s, 'A', 'symbol-of-unity');
  assert.equal(r.s.instances[r.id].zone, 'board');
});
test('symbol-of-unity: up to 3x/turn, on gaining Integrity or Loyalty, Draw 1', { todo: true }, () => {
  // Needs a gain-Integrity/Loyalty trigger with a per-turn use cap.
  let s = newGame(); power(s, 'A', 2);
  newInst(s, 'symbol-of-unity', 'A', 'board');
  s = refreshA(s);
  const before = handCount(s, 'A');
  s.players.A.integrity += 1; // a gain should ripple a draw — but nothing is watching
  // (no action to trigger it; documents the missing trigger)
  assert.ok(handCount(s, 'A') > before, 'gaining Integrity should draw');
});
test('symbol-of-unity: A2 -> Gain 2 Integrity or 1 Loyalty, then Exhaust', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): activation ability + modal choice + Exhaust not modeled');
});

test('kinetic-artillery: 3/5 Heavy Artillery Unit', () => {
  let s = newGame(); rich(s); power(s, 'A', 2);
  const r = play(s, 'A', 'kinetic-artillery');
  assert.deepEqual(eff(r.s, r.s.instances[r.id]), { attack: 3, health: 5 });
});
test('kinetic-artillery: must Defend if able; 4L -> Enemy Armies -1 Shields per Loyalty', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): must-Defend constraint + Loyalty-threshold scaling Shield debuff not modeled');
});

test('sectorwide-expansion: passive +1 Handsize/+1 Storage/+1 Buy apply at Refresh', () => {
  let s = newGame();
  newInst(s, 'sectorwide-expansion', 'A', 'board'); // handBonus/storageBonus/buyBonus 1, upkeep 2
  power(s, 'A', 2);
  s = refreshA(s);
  assert.equal(s.players.A.handSize, 6);
  assert.equal(s.players.A.storage, 2);
  assert.equal(s.players.A.buys, 2);
});
test('sectorwide-expansion: ACTION (2): pay 3 Minerals per copy to create a token copy', { todo: true }, () => {
  assert.ok(false, 'TODO(engine): ACTION (n) ability + token-copy creation not modeled');
});

// =============================================================================
// BATTERY (power)
// =============================================================================
test('solar-power-grid: produces 1 Power at Refresh', () => {
  let s = newGame();
  newInst(s, 'solar-power-grid', 'A', 'board');
  s = refreshA(s);
  assert.equal(s.players.A.energy, 2); // Core 1 + grid 1
});

test('battery-unit: produces 2 Power and +1 Storage at Refresh', () => {
  let s = newGame();
  newInst(s, 'battery-unit', 'A', 'board');
  s = refreshA(s);
  assert.equal(s.players.A.energy, 3); // Core 1 + 2
  assert.equal(s.players.A.storage, 2); // base 1 + 1
});

test('fusion-reactor: produces 3 Power and +1 Handsize at Refresh', () => {
  let s = newGame();
  newInst(s, 'fusion-reactor', 'A', 'board');
  s = refreshA(s);
  assert.equal(s.players.A.energy, 4); // Core 1 + 3
  assert.equal(s.players.A.handSize, 6);
});
