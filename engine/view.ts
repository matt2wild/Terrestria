// =============================================================================
// engine/view.ts — per-player view with hidden information filtered out.
// Resource stacks (homogeneous) reveal their card & cost; action stacks stay blind.
// =============================================================================
import type { GameState, PlayerId } from './types.js';
import { def, board, ownBoard, cat } from './core.js';
import { eff } from './keywords.js';
import { objectivesView } from './objectives.js';

export function viewFor(s: GameState, viewer: PlayerId) {
  const me = s.players[viewer];
  return {
    round: s.round, phase: s.phase, activePlayer: s.turnOrder[s.activeIndex], yourTurn: s.turnOrder[s.activeIndex] === viewer,
    status: s.status, winner: s.winner, objectives: s.objectives, directives: objectivesView(s, viewer),
    you: { integrity: me.integrity, loyalty: me.loyalty, minerals: me.minerals, influence: me.influence, energy: me.energy, buys: me.buys, scored: me.scored, abilities: me.abilities,
      hand: Object.values(s.instances).filter((i) => i.controller === viewer && i.zone === 'hand').map((i) => def(i).name) },
    board: board(s).map((i) => ({ name: def(i).name, controller: i.controller, tapped: i.tapped, active: i.active, ...eff(s, i) })),
    // Stacks expose category/tier/acquire/count. Resource stacks are homogeneous,
    // so their card identity & cost are revealed; action stacks stay blind.
    supply: Object.values(s.supply).map((st) => {
      const top = st.cards.length ? cat().get(st.cards[st.cards.length - 1])! : undefined;
      return {
        key: st.key, category: st.category, tier: st.tier, acquire: st.acquire, blind: st.blind, count: st.cards.length,
        ...(!st.blind && top ? { card: top.name, cost: top.cost ?? {} } : {}),
      };
    }),
    opponents: s.turnOrder.filter((p) => p !== viewer).map((p) => ({ id: p, integrity: s.players[p].integrity, loyalty: s.players[p].loyalty,
      handCount: Object.values(s.instances).filter((i) => i.controller === p && i.zone === 'hand').length,
      hasCore: ownBoard(s, p).some((i) => def(i).kind === 'core') })),
    pending: s.pending && { attacks: s.pending.attacks.length, youMustRespond: s.pending.waitingOn.includes(viewer) },
  };
}
