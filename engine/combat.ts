// =============================================================================
// engine/combat.ts — the synchronous Attack gate and its resolution.
// =============================================================================
import type { GameState, Gate, Inst, PlayerId } from './types.js';
import { def, log, active } from './core.js';
import { eff, kwVal, hasKw } from './keywords.js';
import { destroy, checkDispossession } from './effects.js';

export function openGate(s: GameState, attacks: Gate['attacks']): void {
  const defenders = new Set<PlayerId>();
  for (const a of attacks) {
    const at = s.instances[a.attackerId]; at.tapped = true;
    const dp = a.target.player ?? (a.target.instId ? s.instances[a.target.instId].controller : undefined);
    if (dp) { defenders.add(dp); s.players[dp].attackedThisRound = true; }
  }
  s.pending = { attacks, waitingOn: [...defenders], blocks: {} };
  log(s, `${active(s).id} declares ${attacks.length} attack(s)`);
}

export function resolveCombat(s: GameState): void {
  const g = s.pending!; const aggressor = active(s).id;
  for (const atk of g.attacks) {
    const attacker = s.instances[atk.attackerId]; if (!attacker || attacker.zone !== 'board') continue;
    const block = Object.values(g.blocks).flat().find((b) => b.attackerId === atk.attackerId);
    const dmg = eff(s, attacker).attack;
    if (block) {
      const blocker = s.instances[block.blockerId];
      const aDmg = Math.max(0, dmg - kwVal(s, blocker, 'armor'));
      const overkill = aDmg - eff(s, blocker).health;
      if (!consumeShield(s, blocker)) blocker.damage += aDmg;
      attacker.damage += eff(s, blocker).attack; // blocker hits back
      log(s, `${def(attacker).name} vs ${def(blocker).name}`);
      if (eff(s, blocker).health <= 0) destroy(s, blocker.id, aggressor);
      if (eff(s, attacker).health <= 0) destroy(s, attacker.id, blocker.controller);
      if (overkill > 0 && hasKw(s, attacker, 'breach')) { s.players[blocker.controller].integrity -= overkill; s.players[aggressor].damageDealtThisTurn += overkill; checkDispossession(s, blocker.controller, aggressor); log(s, `Breach! ${overkill} to ${blocker.controller}`); }
    } else if (atk.target.player) {
      const total = dmg + kwVal(s, attacker, 'siege');
      s.players[atk.target.player].integrity -= total;
      s.players[aggressor].damageDealtThisTurn += total;
      log(s, `${def(attacker).name} hits ${atk.target.player} for ${total} integrity`);
      checkDispossession(s, atk.target.player, aggressor);
    } else if (atk.target.instId) {
      const tgt = s.instances[atk.target.instId];
      if (tgt && !consumeShield(s, tgt)) { const applied = Math.max(0, dmg - kwVal(s, tgt, 'armor')); tgt.damage += applied; s.players[aggressor].damageDealtThisTurn += applied; if (eff(s, tgt).health <= 0) destroy(s, tgt.id, aggressor); }
    }
  }
  s.pending = null;
}

function consumeShield(s: GameState, c: Inst): boolean {
  const i = c.granted.findIndex((k) => (typeof k === 'string' ? k : k.kw) === 'shielded');
  if (i >= 0) { c.granted.splice(i, 1); return true; }
  if ((def(c).keywords ?? []).some((k) => (typeof k === 'string' ? k : k.kw) === 'shielded')) return true;
  return false;
}
