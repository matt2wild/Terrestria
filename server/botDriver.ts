// =============================================================================
// server/botDriver.ts — advances CPU seats server-side.
//
// After every human action (and at game start) the lobby calls runBots(), which
// keeps acting for any bot seat until control returns to a human:
//   • a combat gate waiting on a bot  → the bot blocks with a free vanguard unit
//     (else takes the hit);
//   • the active player is a bot       → the bot plays a whole (non-attacking)
//     turn via the shared policy in bot.ts.
//
// It stops as soon as the active player is human and no gate is waiting on a
// bot, so a human is never auto-played and never has their blocks chosen for
// them. Pure data-in/data-out, like the rest of the engine boundary.
// =============================================================================
import { def, laneOf, type GameState, type PlayerId, type Action } from '../engine.js';
import { playWholeTurn } from '../bot.js';
import { applyAction } from './engineHandler.js';

export function runBots(game: GameState, isBot: (p: PlayerId) => boolean, now: number): GameState {
  let g = game;
  const get = (): GameState => g;
  const apply = (pid: PlayerId, a: Action): void => { g = applyAction(g, pid, a, now); };

  let guard = 0;
  while (g.status === 'playing' && guard++ < 400) {
    if (g.pending) {
      const bot = g.pending.waitingOn.find(isBot);
      if (!bot) break;                          // a human still owes a response — stop and wait for the UI
      const blocker = Object.values(g.instances).find((i) =>
        i.controller === bot && i.zone === 'board' && laneOf(i) === 'vanguard'
        && !i.tapped && i.active && def(i).kind !== 'core' && (def(i).stats?.health ?? 0) > 0);
      const atkId = g.pending.attacks[0]?.attackerId;
      apply(bot, { type: 'respondToAttack', blocks: blocker && atkId ? [{ blockerId: blocker.id, attackerId: atkId }] : [] });
      continue;
    }
    const active = g.turnOrder[g.activeIndex];
    if (isBot(active)) { playWholeTurn(get, apply, active, { attack: false }); continue; }
    break;                                       // human's turn — let them play
  }
  return g;
}
