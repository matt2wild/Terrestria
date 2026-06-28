// =============================================================================
// engine/keywords.ts — keyword queries (printed + attached upgrades + granted),
// stacking by summing, plus the recompute-model effective stats and upkeep.
// =============================================================================
import type { GameState, Inst, Keyword } from './types.js';
import { def } from './core.js';

const kname = (k: Keyword): string => (typeof k === 'string' ? k : k.kw);
const kval = (k: Keyword): number => (typeof k === 'string' ? 1 : k.n);

function allKw(s: GameState, c: Inst): Keyword[] {
  const up = c.upgrades.flatMap((id) => def(s.instances[id]).keywords ?? []);
  return [...(def(c).keywords ?? []), ...up, ...c.granted];
}

export const hasKw = (s: GameState, c: Inst, kw: string): boolean => allKw(s, c).some((k) => kname(k) === kw);
export const kwVal = (s: GameState, c: Inst, kw: string): number => allKw(s, c).filter((k) => kname(k) === kw).reduce((a, k) => a + kval(k), 0);

// Effective stats: base + upgrade auras − damage (recompute model, no stale state).
export function eff(s: GameState, c: Inst): { attack: number; health: number } {
  let attack = def(c).stats?.attack ?? 0;
  let health = def(c).stats?.health ?? 0;
  for (const upId of c.upgrades) for (const t of def(s.instances[upId]).triggers ?? [])
    if (t.on === 'whileInPlay') for (const e of t.effects)
      if (e.op === 'modifyStat' && e.target.scope === 'sourceCard') { attack += e.stat?.attack ?? 0; health += e.stat?.health ?? 0; }
  return { attack, health: health - c.damage };
}

export const upkeepOf = (s: GameState, c: Inst): number =>
  hasKw(s, c, 'offGrid') ? 0 : Math.max(0, (def(c).upkeep ?? 0) - kwVal(s, c, 'efficient'));
