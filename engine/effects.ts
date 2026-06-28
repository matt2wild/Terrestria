// =============================================================================
// engine/effects.ts — the data-driven effect interpreter, plus the mutations it
// is mutually recursive with (destroy fires onDestroy via applyEffect; the
// destroyPermanent verb calls destroy) and the incubation (scheme) machinery.
// =============================================================================
import type { GameState, Ctx, Inst, Effect, PlayerId } from './types.js';
import { def, log, active, board, ownBoard, START } from './core.js';
import { kwVal, hasKw } from './keywords.js';
import { draw, formPact } from './zones.js';

// --- target resolution -------------------------------------------------------
function targets(s: GameState, ctx: Ctx, src: Inst | null, sel: Effect['target'], chosen?: PlayerId[]): (PlayerId | string)[] {
  const ofKind = (i: Inst): boolean => !sel.ofKind || sel.ofKind.includes(def(i).kind);
  switch (sel.scope) {
    case 'self': return [ctx.playerId];
    case 'sourceCard': return src ? [src.id] : [];
    case 'targetPlayer': return chosen ?? [s.turnOrder.find((p) => p !== ctx.playerId)!];
    case 'allOpponents': return s.turnOrder.filter((p) => p !== ctx.playerId);
    case 'ownPermanents': return ownBoard(s, ctx.playerId).filter(ofKind).map((i) => i.id);
    case 'enemyPermanents': {
      const xs = board(s).filter((i) => i.controller !== ctx.playerId && ofKind(i));
      return (sel.count ? xs.slice(0, sel.count) : xs).map((i) => i.id);
    }
  }
}

// --- the interpreter: the single place a new verb plugs in -------------------
export function applyEffect(s: GameState, ctx: Ctx, src: Inst | null, e: Effect, chosen?: PlayerId[]): void {
  const ts = targets(s, ctx, src, e.target, chosen);
  switch (e.op) {
    case 'modifyResource': for (const p of ts) addRes(s, p as PlayerId, e.resource!, e.amount ?? 0); break;
    case 'modifyLoyalty': for (const p of ts) s.players[p as PlayerId].loyalty += e.amount ?? 0; break;
    case 'modifyIntegrity': for (const p of ts) { s.players[p as PlayerId].integrity += e.amount ?? 0; if ((e.amount ?? 0) < 0) checkDispossession(s, p as PlayerId, ctx.playerId); } break;
    case 'modifyStat': for (const id of ts) { const c = s.instances[id as string]; if (c) c.damage -= e.stat?.health ?? 0; } break; // instant heal/dmg
    case 'drawCards': for (const p of ts) draw(s, p as PlayerId, e.amount ?? 1); break;
    case 'destroyPermanent': for (const id of ts) destroy(s, id as string, ctx.playerId); break;
    case 'grantKeyword': for (const id of ts) s.instances[id as string]?.granted.push(e.keyword!); break;
    case 'formPact': formPact(s, ctx.playerId, ts[0] as PlayerId); break;
    case 'scheduleEffect': if (src) scheduleOn(s, src, e.schedule!, (chosen ?? targets(s, ctx, src, { scope: 'targetPlayer' }) as PlayerId[])); break;
  }
}

function addRes(s: GameState, p: PlayerId, r: string, n: number): void {
  const pl = s.players[p]; (pl as any)[r] += n;
  if (n > 0 && p === active(s).id) pl.generatedThisTurn += n;
}

export function dispatch(s: GameState, event: string, onlyController?: PlayerId): void {
  for (const c of board(s)) {
    if (!c.active) continue;
    if (onlyController && c.controller !== onlyController) continue;
    for (const t of def(c).triggers ?? []) if (t.on === event)
      for (const e of t.effects) applyEffect(s, { playerId: c.controller, now: 0 }, c, e);
  }
}

// --- destroy & dispossession (coupled to applyEffect via onDestroy) ----------
export function destroy(s: GameState, id: string, by: PlayerId): void {
  const c = s.instances[id]; if (!c || c.zone !== 'board') return;
  if (hasKw(s, c, 'hardened')) { log(s, `${def(c).name} is Hardened — survives`); return; }
  for (const t of def(c).triggers ?? []) if (t.on === 'onDestroy')
    for (const e of t.effects) applyEffect(s, { playerId: c.controller, now: 0 }, c, e, [by]);
  c.zone = 'discard'; c.damage = 0; c.upgrades = []; c.granted = [];
  s.players[c.controller].lostPermThisRound = true;
  if (c.controller !== by) s.players[by].destroyedCount++;
  log(s, `${def(c).name} destroyed`);
}

export function checkDispossession(s: GameState, victim: PlayerId, aggressor: PlayerId): void {
  const v = s.players[victim];
  if (v.integrity > 0) return;
  const core = ownBoard(s, victim).find((i) => def(i).kind === 'core');
  if (core && aggressor !== victim) { core.controller = aggressor; log(s, `DISPOSSESSION: ${aggressor} seizes ${victim}'s Colony Core`); }
  v.integrity = START.recovery; // recovery to half
  log(s, `${victim} integrity reset to ${v.integrity}`);
}

// --- incubation (schemes) ----------------------------------------------------
function scheduleOn(s: GameState, scheme: Inst, sch: NonNullable<Effect['schedule']>, tgts: PlayerId[]): void {
  const delay = Math.max(0, sch.delay - kwVal(s, scheme, 'catalyst'));
  scheme.zone = 'incubating';
  scheme.incubation = { remaining: delay, cadence: sch.cadence, payload: sch.payload, targets: tgts };
  if (!s.incubating.includes(scheme.id)) s.incubating.push(scheme.id);
  log(s, `${def(scheme).name} incubating (${delay} ticks, ${sch.cadence})`);
}

export function tickIncubation(s: GameState): void {
  for (const id of [...s.incubating]) {
    const c = s.instances[id]; const inc = c?.incubation; if (!inc) continue;
    inc.remaining--;
    const fire = (): void => { for (const e of inc.payload) applyEffect(s, { playerId: c.controller, now: 0 }, c, e, inc.targets); };
    if (inc.cadence === 'progressive') { fire(); log(s, `${def(c).name} fires a slice`); }
    if (inc.remaining <= 0) {
      if (inc.cadence === 'burst') { fire(); log(s, `${def(c).name} matures (burst)`); }
      s.incubating = s.incubating.filter((x) => x !== id); c.zone = 'discard'; c.incubation = undefined;
    }
  }
}
