// Directive ladders (engine/directives.ts): openers, per-tier conditions,
// costs, ability grants, the rendered view, and rejection paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { objectivesView } from '../engine.js';
import { newGameDir, step, newInst, instOf } from './helpers.js';

test("opener: a directive's Opener bonus is applied to every colony at game start", () => {
  // Unification opener = "Gain 1 Loyalty and Draw 1"
  const s = newGameDir(['unification', 'development', 'supremacy']);
  assert.equal(s.players.A.loyalty, 4); // 3 base + 1
  assert.equal(s.players.B.loyalty, 4);
});

test('prosperity I: scoring requires producing 6 resources this turn', () => {
  let s = newGameDir(['prosperity', 'supremacy', 'development']);
  assert.equal(step(s, 'A', { type: 'scoreObjective', flavor: 'prosperity' }).players.A.directiveTier.prosperity ?? 0, 0);
  s.players.A.generatedThisTurn = 6;
  s = step(s, 'A', { type: 'scoreObjective', flavor: 'prosperity' });
  assert.equal(s.players.A.directiveTier.prosperity, 1);
  assert.ok(s.players.A.scored.includes('prosperity-I'));
  assert.ok(s.players.A.abilities.includes('prosperity-I-ability'));
  assert.equal(instOf(s, 'A', 'colony-core')!.tapped, true);
});

test('supremacy: tiers gate on damage dealt this turn (1, then 8)', () => {
  let s = newGameDir(['supremacy', 'development', 'prosperity']);
  s.players.A.damageDealtThisTurn = 1;
  s = step(s, 'A', { type: 'scoreObjective', flavor: 'supremacy' });
  assert.equal(s.players.A.directiveTier.supremacy, 1);
  // Tier II needs 8 damage; free the Core and retry with too little, then enough.
  instOf(s, 'A', 'colony-core')!.tapped = false;
  s.players.A.damageDealtThisTurn = 4;
  s = step(s, 'A', { type: 'scoreObjective', flavor: 'supremacy' });
  assert.equal(s.players.A.directiveTier.supremacy, 1); // still I
  s.players.A.damageDealtThisTurn = 8;
  s = step(s, 'A', { type: 'scoreObjective', flavor: 'supremacy' });
  assert.equal(s.players.A.directiveTier.supremacy, 2);
});

test('development I: control 5 permanents', () => {
  let s = newGameDir(['development', 'supremacy', 'prosperity']);
  for (let i = 0; i < 3; i++) newInst(s, 'carbon-hull', 'A', 'board'); // core + 3 = 4
  s = step(s, 'A', { type: 'scoreObjective', flavor: 'development' });
  assert.equal(s.players.A.directiveTier.development ?? 0, 0);
  newInst(s, 'carbon-hull', 'A', 'board'); // 5th permanent
  s = step(s, 'A', { type: 'scoreObjective', flavor: 'development' });
  assert.equal(s.players.A.directiveTier.development, 1);
});

test('unification II: costs 1 Loyalty and requires holding 5 Loyalty', () => {
  let s = newGameDir(['unification', 'supremacy', 'development']);
  s.players.A.directiveTier.unification = 1; // already cleared I
  s.players.A.loyalty = 4;
  s = step(s, 'A', { type: 'scoreObjective', flavor: 'unification' });
  assert.equal(s.players.A.directiveTier.unification, 1); // not enough Loyalty
  s.players.A.loyalty = 5;
  s = step(s, 'A', { type: 'scoreObjective', flavor: 'unification' });
  assert.equal(s.players.A.directiveTier.unification, 2);
  assert.equal(s.players.A.loyalty, 4); // paid 1
});

test('a directive not active this game cannot be scored', () => {
  let s = newGameDir(['prosperity', 'supremacy', 'development']);
  s.players.A.loyalty = 20;
  s = step(s, 'A', { type: 'scoreObjective', flavor: 'domination' }); // not a track
  assert.equal(s.players.A.directiveTier.domination ?? 0, 0);
});

test('objectivesView: marks done/next stages and whether the next is met', () => {
  let s = newGameDir(['prosperity', 'supremacy', 'development']);
  s.players.A.generatedThisTurn = 6;
  const v = objectivesView(s, 'A').find((d) => d.id === 'prosperity')!;
  assert.equal(v.tier, 0);
  assert.equal(v.stages[0].next, true);
  assert.equal(v.stages[0].met, true);   // 6 produced → tier I is scorable
  assert.equal(v.stages[1].next, false); // II not reachable yet
  assert.equal(v.finisher.next, false);
});
