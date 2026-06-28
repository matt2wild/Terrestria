// =============================================================================
// engine/cost.ts — the two-sided cost model. minerals / influence / wild ("Either").
// Resources are charged when BOUGHT; every other card is charged when PLAYED.
// =============================================================================
import type { Player, ResCost, CardDef } from './types.js';

export const chargedAtBuy = (d: CardDef): boolean => d.kind === 'resource';

export function canAfford(p: Player, c?: ResCost): boolean {
  if (!c) return true;
  const m = c.minerals ?? 0, i = c.influence ?? 0, w = c.wild ?? 0;
  if (p.minerals < m || p.influence < i) return false;
  return (p.minerals - m) + (p.influence - i) >= w; // wild paid from whatever is left
}

export function payCost(p: Player, c?: ResCost): void {
  if (!c) return;
  const m = c.minerals ?? 0, i = c.influence ?? 0; let w = c.wild ?? 0;
  p.minerals -= m; p.influence -= i;
  const fromMin = Math.min(w, p.minerals); p.minerals -= fromMin; w -= fromMin; // spend surplus minerals first
  p.influence -= w;
}
