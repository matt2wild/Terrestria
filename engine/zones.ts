// =============================================================================
// engine/zones.ts — deck/discard cycling and pacts (mutations with no dependency
// on the effect interpreter, so effects.ts can import these without a cycle).
// =============================================================================
import type { GameState, PlayerId } from './types.js';
import { log, rand } from './core.js';

export function draw(s: GameState, p: PlayerId, n: number): void {
  for (let i = 0; i < n; i++) {
    let deck = Object.values(s.instances).filter((x) => x.controller === p && x.zone === 'deck');
    if (deck.length === 0) {
      const disc = Object.values(s.instances).filter((x) => x.controller === p && x.zone === 'discard');
      if (disc.length === 0) return;
      for (const c of disc) c.zone = 'deck';
      deck = disc;
    }
    const pick = deck[Math.floor(rand(s) * deck.length)];
    pick.zone = 'hand';
  }
}

export function formPact(s: GameState, a: PlayerId, b: PlayerId): void {
  if (s.pacts.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))) return;
  s.pacts.push({ a, b, bindingRounds: 0, formedRound: s.round }); log(s, `Pact formed: ${a} ⇄ ${b}`);
}

export const inPact = (s: GameState, a: PlayerId, b: PlayerId): boolean =>
  s.pacts.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
