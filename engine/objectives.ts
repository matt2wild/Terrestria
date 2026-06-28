// =============================================================================
// engine/objectives.ts — scoring the Directive ladders (see engine/directives.ts).
// Each active directive advances independently: meet the next stage's condition,
// tap your Core, advance a tier (gaining an ability). Completing the Finisher
// wins the game.
// =============================================================================
import type { GameState, Player } from './types.js';
import { def, ownBoard, log } from './core.js';
import { canAfford, payCost } from './cost.js';
import { DIRECTIVES } from './directives.js';

// The next rung a player would score on a directive (or the Finisher).
function nextStage(s: GameState, p: Player, id: string) {
  const d = DIRECTIVES[id];
  const done = p.directiveTier[id] ?? 0;
  if (done < d.tiers.length) return { kind: 'tier' as const, idx: done, tier: d.tiers[done] };
  if (done === d.tiers.length) return { kind: 'finisher' as const, idx: done };
  return null; // already won via this directive
}

export function scoreObjective(s: GameState, p: Player, id: string): boolean {
  if (!s.objectives.flavors.includes(id)) return false;
  const d = DIRECTIVES[id]; if (!d) return false;
  const stage = nextStage(s, p, id); if (!stage) return false;
  const core = ownBoard(s, p.id).find((i) => def(i).kind === 'core' && !i.tapped);
  if (!core) { log(s, `${p.id} cannot score — no untapped Core`); return false; }

  if (stage.kind === 'tier') {
    const t = stage.tier;
    if (!t.met(s, p)) return false;
    if (!canAfford(p, t.cost) || p.loyalty < (t.loyalty ?? 0)) return false;
    payCost(p, t.cost); p.loyalty -= t.loyalty ?? 0;
    core.tapped = true;
    p.directiveTier[id] = stage.idx + 1;
    p.scored.push(`${id}-${t.stage}`); p.abilities.push(`${id}-${t.stage}-ability`);
    log(s, `★ ${p.id} scores ${d.name} ${t.stage}`);
    return true;
  }

  // Finisher → victory
  if (!d.finisher.met(s, p)) return false;
  core.tapped = true;
  p.directiveTier[id] = stage.idx + 1;
  p.scored.push(`${id}-F`); p.abilities.push(`${id}-F-ability`);
  s.status = 'finished'; s.winner = p.id;
  log(s, `🏆 ${p.id} completes the ${d.name} Finisher and WINS`);
  return true;
}

// A per-player, render-ready view of the active directives and the viewer's
// progress — consumed by the UI (and exposed through viewFor).
export interface DirectiveView {
  id: string; name: string; quote?: string; opener: string;
  tier: number;                       // stages completed
  stages: { stage: string; text: string; done: boolean; next: boolean; met: boolean }[];
  finisher: { text: string; next: boolean; met: boolean };
  won: boolean;
}
export function objectivesView(s: GameState, pid: string): DirectiveView[] {
  const p = s.players[pid];
  return s.objectives.flavors.map((id) => {
    const d = DIRECTIVES[id];
    const done = p.directiveTier[id] ?? 0;
    const stages = d.tiers.map((t, i) => ({
      stage: t.stage, text: t.text,
      done: i < done,
      next: i === done,
      met: i === done ? t.met(s, p) : false,
    }));
    const finisherNext = done === d.tiers.length;
    return {
      id, name: d.name, quote: d.quote, opener: d.opener.text,
      tier: done, stages,
      finisher: { text: d.finisher.text, next: finisherNext, met: finisherNext ? d.finisher.met(s, p) : false },
      won: done > d.tiers.length,
    };
  });
}
