import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step, newInst, instOf } from './helpers.js';

// ---- the headline rule: resources pay-to-acquire / free-to-play -------------

test('resource: buying charges its cost (free Carbon at Tier I)', () => {
  let s = newGame();
  const before = s.supply['mineral:I'].cards.length;
  s = step(s, 'A', { type: 'buyCard', stackKey: 'mineral:I' }); // Carbon, cost {}
  assert.equal(s.supply['mineral:I'].cards.length, before - 1, 'stack drops by one');
  assert.equal(s.players.A.buys, 0, 'a buy was consumed');
  assert.ok(instOf(s, 'A', 'carbon', 'discard'), 'card goes to discard');
});

test('resource: an unaffordable buy is rejected with no state change', () => {
  let s = newGame(); // A has 0 minerals/influence
  const before = s.supply['mineral:II'].cards.length;
  s = step(s, 'A', { type: 'buyCard', stackKey: 'mineral:II' }); // Silicon {minerals:1,wild:2}
  assert.equal(s.players.A.buys, 1, 'buy not consumed');
  assert.equal(s.supply['mineral:II'].cards.length, before, 'stack untouched');
  assert.equal(instOf(s, 'A', 'silicon', 'discard'), undefined);
});

test('resource: playing one is free and banks resources', () => {
  let s = newGame();
  const c = newInst(s, 'silicon', 'A', 'hand'); // Gain 2 Minerals on play
  s = step(s, 'A', { type: 'playCard', instId: c.id });
  assert.equal(s.players.A.minerals, 2, 'gained resources');
  assert.equal(s.players.A.influence, 0, 'paid nothing to play');
  assert.equal(s.instances[c.id].zone, 'discard', 'resource cycles to discard');
});

// ---- the other side: actions free-to-buy / pay-to-play ----------------------

test('action: buying is free and blind but still consumes a buy', () => {
  let s = newGame();
  const before = s.supply['warfare:I'].cards.length;
  s = step(s, 'A', { type: 'buyCard', stackKey: 'warfare:I' });
  assert.equal(s.players.A.minerals, 0, 'no resources spent acquiring');
  assert.equal(s.players.A.influence, 0);
  assert.equal(s.players.A.buys, 0, 'a buy was consumed');
  assert.equal(s.supply['warfare:I'].cards.length, before - 1);
});

test('action: playing one pays its cost; unaffordable is rejected', () => {
  let s = newGame();
  const c = newInst(s, 'kinetic-riflemen', 'A', 'hand'); // play cost {minerals:2, wild:2}
  // unaffordable: nothing happens
  let s1 = step(s, 'A', { type: 'playCard', instId: c.id });
  assert.equal(s1.instances[c.id].zone, 'hand', 'still in hand — rejected');
  // now afford it
  s.players.A.minerals = 4;
  let s2 = step(s, 'A', { type: 'playCard', instId: c.id });
  assert.equal(s2.instances[c.id].zone, 'board', 'permanent enters play');
  assert.equal(s2.players.A.minerals, 0, 'paid 2 minerals + 2 wild from minerals');
});

test('buying with no buys left is rejected', () => {
  let s = newGame();
  s = step(s, 'A', { type: 'buyCard', stackKey: 'mineral:I' }); // uses the only buy
  assert.equal(s.players.A.buys, 0);
  const before = s.supply['mineral:I'].cards.length;
  s = step(s, 'A', { type: 'buyCard', stackKey: 'mineral:I' });
  assert.equal(s.supply['mineral:I'].cards.length, before, 'second buy rejected');
});

// ---- shuffled, typed buy stacks --------------------------------------------

test('supply: one stack per category:tier, resources pay / actions free', () => {
  const s = newGame();
  for (const st of Object.values(s.supply)) {
    const isResource = st.category === 'mineral' || st.category === 'influence';
    assert.equal(st.acquire, isResource ? 'pay' : 'free', `${st.key} acquire`);
  }
  assert.ok(s.supply['mineral:I'], 'mineral:I stack exists');
  assert.ok(s.supply['warfare:I'] && s.supply['structure:II'], 'action stacks exist');
});

test('supply: resource stacks are homogeneous; action stacks mix cards', () => {
  const s = newGame();
  assert.ok(s.supply['mineral:I'].cards.every((id) => id === 'carbon'));
  const warfare1 = new Set(s.supply['warfare:I'].cards);
  assert.ok(warfare1.size > 1, 'an action stack contains multiple distinct cards');
});

test('supply: stack order is deterministic per seed but varies across seeds', () => {
  const a = newGame(1).supply['warfare:I'].cards.join(',');
  const b = newGame(1).supply['warfare:I'].cards.join(',');
  const c = newGame(2).supply['warfare:I'].cards.join(',');
  assert.equal(a, b, 'same seed → same shuffle');
  assert.notEqual(a, c, 'different seed → different shuffle');
});
