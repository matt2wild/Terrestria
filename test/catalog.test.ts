import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargedAtBuy } from '../engine.js';
import { CARDS } from '../catalog.js';
import { newGame } from './helpers.js';

test('catalog has all 77 cards from the Vlads Cards sheet, with unique ids', () => {
  assert.equal(CARDS.length, 77);
  assert.equal(new Set(CARDS.map((c) => c.id)).size, 77, 'ids are unique');
});

test('exactly six resource cards, all in the Mineral/Influence categories', () => {
  const resources = CARDS.filter((c) => c.kind === 'resource');
  assert.equal(resources.length, 6);
  for (const c of resources) assert.ok(['mineral', 'influence'].includes(c.category), `${c.id} category`);
});

test('every cost uses only minerals / influence / wild', () => {
  for (const c of CARDS) {
    for (const k of Object.keys(c.cost ?? {})) {
      assert.ok(['minerals', 'influence', 'wild'].includes(k), `${c.id} has bad cost key "${k}"`);
    }
  }
});

test('two-sided economy invariant: resources charge at buy, everything else at play', () => {
  for (const c of CARDS) {
    assert.equal(chargedAtBuy(c), c.kind === 'resource', `${c.id} wrong charge timing`);
  }
});

test('resources are free-to-play with an on-play resource gain', () => {
  for (const c of CARDS.filter((c) => c.kind === 'resource')) {
    assert.ok(c.triggers?.some((t) => t.on === 'onPlay'), `${c.id} should grant resources on play`);
  }
});

test('every buyable card (tier I/II/III) lands in exactly one buy stack', () => {
  const s = newGame();
  const buyable = CARDS.filter((c) => ['resource', 'operation', 'permanent'].includes(c.kind) && c.tier && c.tier !== 'S');
  // every buyable id appears in its stack (battery piles are keyed per-card)
  for (const c of buyable) {
    const key = c.category === 'battery' ? `battery:${c.id}` : `${c.category}:${c.tier}`;
    const stack = s.supply[key];
    assert.ok(stack, `${c.id} expected a ${key} stack`);
    assert.ok(stack.cards.includes(c.id), `${c.id} missing from its stack`);
  }
  // founders / colony / waste never appear in the supply
  const stacked = new Set(Object.values(s.supply).flatMap((st) => st.cards));
  for (const c of CARDS.filter((c) => ['core', 'colony', 'waste'].includes(c.kind))) {
    assert.ok(!stacked.has(c.id), `${c.id} should not be buyable`);
  }
});
