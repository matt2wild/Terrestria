// =============================================================================
// engine/netview.ts — the per-player view shipped to a *networked* client.
//
// Unlike view.ts (a compact summary), this projection carries enough structure
// for a remote, untrusted client to RENDER the board and CONSTRUCT actions
// (instance ids for play/attack/block, stack keys for buys) while still hiding
// secret information (opponents' hands, blind stack contents).
//
// Card *definitions* are static reference data — the client fetches the whole
// catalog once (GET /api/catalog) and looks defs up by id. Per-poll views stay
// small: ids + the dynamic, per-instance state that actually changes.
//
// Rule-derived eligibility (`playable`, `canAttack`, `canBuy`) is computed HERE,
// server-side, so the engine stays the single source of truth and the client is
// a thin renderer. The reducer still re-validates every action it receives.
// =============================================================================
import type { GameState, PlayerId, Inst } from './types.js';
import { def, board, ownBoard, cat, active } from './core.js';
import { eff, hasKw } from './keywords.js';
import { canAfford, chargedAtBuy } from './cost.js';
import { objectivesView, type DirectiveView } from './objectives.js';

export interface NetCard {
  instId: string; defId: string; controller: PlayerId;
  tapped: boolean; active: boolean; damage: number;
  attack: number; health: number;      // effective, current (health already minus damage)
}
export interface NetHandCard { instId: string; defId: string; playable: boolean; }
export interface NetStack {
  key: string; category: string; tier: string;
  acquire: 'pay' | 'free'; blind: boolean; count: number;
  topDefId?: string; canBuy: boolean;   // topDefId only revealed for non-blind stacks
}
export interface NetAttack { attackerId: string; attackerDefId: string; attack: number; targetPlayer?: PlayerId; }
export interface NetPending {
  youMustRespond: boolean; waitingOnId: PlayerId; waitingOnName: string;
  attacks: NetAttack[];
  yourBlockers: { instId: string; defId: string; attack: number; health: number }[];
}
export interface NetView {
  gameId: string; version: number;
  status: GameState['status']; winner?: PlayerId; winnerName?: string;
  round: number; phase: GameState['phase'];
  activePlayer: PlayerId; activePlayerName: string; yourTurn: boolean;
  viewerId: PlayerId;
  objectiveFlavors: string[];
  directives: DirectiveView[];
  you: {
    id: PlayerId; name: string; seat: number;
    integrity: number; loyalty: number;
    minerals: number; influence: number; energy: number;
    storage: number; handSize: number; buys: number;
    scored: string[]; abilities: string[];
    hand: NetHandCard[];
  };
  board: { mine: (NetCard & { canAttack: boolean })[]; theirs: NetCard[] };
  opponents: { id: PlayerId; name: string; integrity: number; loyalty: number; handCount: number; hasCore: boolean; scored: number }[];
  supply: NetStack[];
  pending: NetPending | null;
  log: string[];
}

// Mirror of the reducer's attacker gate (declareAttack): an untapped, active unit
// with attack > 0 that isn't summoning-sick (unless rush/rapid).
function canAttack(s: GameState, i: Inst): boolean {
  const d = def(i);
  if (i.tapped || !i.active || (d.stats?.attack ?? 0) <= 0) return false;
  if (i.summonedThisTurn && !hasKw(s, i, 'rush') && !hasKw(s, i, 'rapid')) return false;
  return true;
}
function canBlock(i: Inst): boolean { return !i.tapped && i.active && (def(i).stats?.health ?? 0) > 0; }

function netCard(s: GameState, i: Inst): NetCard {
  const e = eff(s, i);
  return { instId: i.id, defId: i.defId, controller: i.controller, tapped: i.tapped, active: i.active, damage: i.damage, attack: e.attack, health: e.health };
}

export function netViewFor(s: GameState, viewer: PlayerId): NetView {
  const me = s.players[viewer];
  const isActive = s.status === 'playing' && active(s).id === viewer;
  const inGate = !!s.pending;
  const C = cat();

  const hand = Object.values(s.instances)
    .filter((i) => i.controller === viewer && i.zone === 'hand')
    .map((i): NetHandCard => {
      const d = def(i);
      const playable = isActive && !inGate && s.phase === 'action' &&
        (d.kind === 'resource' || (d.kind !== 'waste' && canAfford(me, d.cost)));
      return { instId: i.id, defId: i.defId, playable };
    });

  const mine = ownBoard(s, viewer).map((i) => ({
    ...netCard(s, i),
    canAttack: isActive && !inGate && s.phase === 'attack' && canAttack(s, i),
  }));
  const theirs = board(s).filter((i) => i.controller !== viewer).map((i) => netCard(s, i));

  const supply: NetStack[] = Object.values(s.supply)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((st) => {
      const topDefId = st.cards.length ? st.cards[st.cards.length - 1] : undefined;
      const top = topDefId ? C.get(topDefId) : undefined;
      const buyCost = st.acquire === 'pay' ? top?.cost : undefined;
      const canBuy = isActive && !inGate && s.phase === 'buy' && st.cards.length > 0 && me.buys > 0 && canAfford(me, buyCost);
      return {
        key: st.key, category: st.category, tier: st.tier, acquire: st.acquire, blind: st.blind, count: st.cards.length,
        ...(!st.blind && topDefId ? { topDefId } : {}),
        canBuy,
      };
    });

  let pending: NetPending | null = null;
  if (s.pending) {
    const g = s.pending;
    const youMustRespond = g.waitingOn.includes(viewer);
    const waitingOnId = g.waitingOn[0];
    pending = {
      youMustRespond, waitingOnId, waitingOnName: s.players[waitingOnId]?.name ?? waitingOnId,
      attacks: g.attacks.map((a): NetAttack => {
        const at = s.instances[a.attackerId];
        return { attackerId: a.attackerId, attackerDefId: at?.defId ?? '?', attack: at ? eff(s, at).attack : 0, targetPlayer: a.target.player };
      }),
      yourBlockers: youMustRespond
        ? ownBoard(s, viewer).filter(canBlock).map((b) => { const e = eff(s, b); return { instId: b.id, defId: b.defId, attack: e.attack, health: e.health }; })
        : [],
    };
  }

  return {
    gameId: s.gameId, version: s.version,
    status: s.status, winner: s.winner, winnerName: s.winner ? s.players[s.winner]?.name : undefined,
    round: s.round, phase: s.phase,
    activePlayer: s.turnOrder[s.activeIndex], activePlayerName: s.players[s.turnOrder[s.activeIndex]]?.name ?? '',
    yourTurn: isActive, viewerId: viewer,
    objectiveFlavors: s.objectives.flavors,
    directives: objectivesView(s, viewer),
    you: {
      id: me.id, name: me.name, seat: me.seat,
      integrity: me.integrity, loyalty: me.loyalty,
      minerals: me.minerals, influence: me.influence, energy: me.energy,
      storage: me.storage, handSize: me.handSize, buys: me.buys,
      scored: me.scored, abilities: me.abilities, hand,
    },
    board: { mine, theirs },
    opponents: s.turnOrder.filter((p) => p !== viewer).map((p) => ({
      id: p, name: s.players[p].name, integrity: s.players[p].integrity, loyalty: s.players[p].loyalty,
      handCount: Object.values(s.instances).filter((i) => i.controller === p && i.zone === 'hand').length,
      hasCore: ownBoard(s, p).some((i) => def(i).kind === 'core'),
      scored: s.players[p].scored.length,
    })),
    supply,
    pending,
    log: s.log.slice(-60),
  };
}
