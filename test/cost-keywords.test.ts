import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAfford, chargedAtBuy, hasKw, kwVal, eff } from '../engine.js';
import { payCost } from '../engine/cost.js';
import { upkeepOf } from '../engine/keywords.js';
import type { Player, CardDef } from '../engine.js';
import { newGame, newInst } from './helpers.js';

const player = (minerals: number, influence: number): Player => ({ minerals, influence } as Player);

test('canAfford: wild is paid from whatever is left over', () => {
  assert.equal(canAfford(player(2, 1), { minerals: 1, wild: 2 }), true);  // (2-1)+(1-0)=2 >= 2
  assert.equal(canAfford(player(2, 1), { minerals: 1, wild: 3 }), false); // surplus 2 < 3
  assert.equal(canAfford(player(0, 0), {}), true);                        // free
  assert.equal(canAfford(player(0, 0), undefined), true);                 // no cost
  assert.equal(canAfford(player(0, 5), { minerals: 1 }), false);          // not enough minerals specifically
});

test('payCost: spends explicit pools then covers wild from surplus minerals first', () => {
  const p = player(3, 2);
  payCost(p, { minerals: 1, wild: 3 }); // -1 mineral -> 2; wild 3 from minerals(2) then influence(1)
  assert.equal(p.minerals, 0);
  assert.equal(p.influence, 1);
});

test('payCost: pure wild draws across both pools', () => {
  const p = player(1, 4);
  payCost(p, { wild: 4 }); // 4 wild: 1 from minerals, 3 from influence
  assert.equal(p.minerals, 0);
  assert.equal(p.influence, 1);
});

test('chargedAtBuy: only resources are charged at buy time', () => {
  assert.equal(chargedAtBuy({ kind: 'resource' } as CardDef), true);
  assert.equal(chargedAtBuy({ kind: 'permanent' } as CardDef), false);
  assert.equal(chargedAtBuy({ kind: 'operation' } as CardDef), false);
});

test('keywords: parameterized values stack by summing', () => {
  const s = newGame();
  const c = newInst(s, 'groditz', 'A', 'board'); // printed: armor 2
  assert.equal(hasKw(s, c, 'armor'), true);
  assert.equal(kwVal(s, c, 'armor'), 2);
  c.granted.push({ kw: 'armor', n: 1 });           // granted armor 1
  assert.equal(kwVal(s, c, 'armor'), 3);            // 2 + 1
});

test('eff: effective health is base minus marked damage', () => {
  const s = newGame();
  const c = newInst(s, 'groditz', 'A', 'board'); // 2/3
  assert.deepEqual(eff(s, c), { attack: 2, health: 3 });
  c.damage = 2;
  assert.equal(eff(s, c).health, 1);
});

test('upkeepOf: offGrid zeroes upkeep; efficient reduces it', () => {
  const s = newGame();
  const c = newInst(s, 'starhawk', 'A', 'board'); // upkeep 2
  assert.equal(upkeepOf(s, c), 2);
  c.granted.push({ kw: 'efficient', n: 1 });
  assert.equal(upkeepOf(s, c), 1);
  c.granted.push('offGrid');
  assert.equal(upkeepOf(s, c), 0);
});
