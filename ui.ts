// =============================================================================
// ui.ts — a minimal hotseat browser client for the Colony engine.
// It renders straight from the live GameState and dispatches Actions through
// reduce(); the engine enforces every rule. Two players share one screen, with
// a "pass the device" overlay between turns so hands stay secret.
// =============================================================================
import {
  createGame, reduce, setCatalog, def, canAfford, hasKw, objectivesView,
  type GameState, type Action, type PlayerId, type Inst, type ResCost,
} from './engine.js';
import { CATALOG, SETUP } from './catalog.js';
import { playWholeTurn, resolveGates } from './bot.js';

setCatalog(CATALOG);

const PLAYERS = [
  { id: 'A', name: 'Colony A', retentionDays: 0 },
  { id: 'B', name: 'Colony B', retentionDays: 0 },
];

let state: GameState;
let seed = 0;
let shownActor: PlayerId | null = null;          // who the screen is currently revealed to
const selectedAttackers = new Set<string>();

const getState = () => state;
function apply(pid: PlayerId, a: Action) { state = reduce(state, { playerId: pid, now: Date.now() }, a); render(); }

// who must act right now: a waiting defender during combat, else the active player
function actor(): PlayerId { return state.pending ? state.pending.waitingOn[0] : state.turnOrder[state.activeIndex]; }
function opp(pid: PlayerId): PlayerId { return state.turnOrder.find((p) => p !== pid)!; }
function name(pid: PlayerId): string { return state.players[pid]?.name ?? pid; }
function boardOf(pid: PlayerId): Inst[] { return Object.values(state.instances).filter((i) => i.controller === pid && i.zone === 'board'); }
function handOf(pid: PlayerId): Inst[] { return Object.values(state.instances).filter((i) => i.controller === pid && i.zone === 'hand'); }

// --- small helpers -----------------------------------------------------------
function esc(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
function el(id: string): HTMLElement { return document.getElementById(id)!; }

function costInner(c?: ResCost): string {
  if (!c) return '';
  const out: string[] = [];
  if (c.minerals) out.push(`${c.minerals}<span class="res-min">⛏</span>`);
  if (c.influence) out.push(`${c.influence}<span class="res-inf">✦</span>`);
  if (c.wild) out.push(`${c.wild}<span class="res-wild">◇</span>`);
  return out.join(' ');
}
function costBadge(c: ResCost | undefined, freeLabel: string): string {
  const inner = costInner(c);
  return `<span class="cost">${inner || freeLabel}</span>`;
}

function eligibleAttacker(i: Inst): boolean {
  const d = def(i);
  if (i.tapped || !i.active || (d.stats?.attack ?? 0) <= 0) return false;
  if (i.summonedThisTurn && !hasKw(state, i, 'rush') && !hasKw(state, i, 'rapid')) return false;
  return true;
}
function eligibleBlocker(i: Inst): boolean { return !i.tapped && i.active && (def(i).stats?.health ?? 0) > 0; }

// --- card rendering ----------------------------------------------------------
function renderCard(i: Inst, opts: { act?: string; disabled?: boolean; selected?: boolean } = {}): string {
  const d = def(i);
  const cls = ['card'];
  if (d.kind === 'resource') cls.push('resource');
  if (opts.act && !opts.disabled) cls.push('clickable');
  if (opts.disabled) cls.push('disabled');
  if (opts.selected) cls.push('selected');
  if (i.zone === 'board' && i.tapped) cls.push('tapped');
  if (i.zone === 'board' && !i.active) cls.push('inactive');
  const data = opts.act && !opts.disabled ? ` data-act="${opts.act}" data-id="${i.id}"` : '';
  const cost = d.kind === 'resource' ? '<span class="cost">free</span>' : costBadge(d.cost, 'free');
  const stats = d.stats ? `<div class="stat-line">${d.stats.attack}/${d.stats.health - i.damage}</div>` : '';
  const meta = `${d.tier ?? '–'} • ${esc(d.type)}${d.upkeep ? ` • ⚡${d.upkeep}` : ''}`;
  return `<div class="${cls.join(' ')}"${data}>
    ${cost}
    <div class="cn">${esc(d.name)}</div>
    <div class="meta">${meta}</div>
    ${stats}
    <div class="txt">${esc(d.text ?? '')}</div>
  </div>`;
}

// --- panels ------------------------------------------------------------------
function renderTop(): void {
  const o = state.objectives;
  el('topbar').innerHTML = `
    <span class="title">COLONY</span>
    <span class="tag">Round <b>${state.round}</b></span>
    <span class="tag">Phase <b>${state.phase}</b></span>
    <span class="tag">Active <b>${esc(name(state.turnOrder[state.activeIndex]))}</b></span>
    <span class="tag">Directives: ${o.flavors.join(' · ')}</span>
    <span class="spacer"></span>
    <button data-act="ai" ${state.status !== 'playing' ? 'disabled' : ''}>🤖 AI takes this turn</button>
    <button data-act="new-game">↻ New game</button>`;
}

function renderMe(me: PlayerId): void {
  const p = state.players[me];
  el('me').innerHTML = `
    <h3>${esc(p.name)} — your colony</h3>
    <div class="stats">
      <span class="stat">Integrity <b>${p.integrity}</b></span>
      <span class="stat">Loyalty <b>${p.loyalty}</b></span>
      <span class="stat res-min">Minerals <b>${p.minerals}</b></span>
      <span class="stat res-inf">Influence <b>${p.influence}</b></span>
      <span class="stat">Energy <b>${p.energy}</b></span>
      <span class="stat">Buys <b>${p.buys}</b></span>
      <span class="stat">Storage <b>${p.storage}</b></span>
      <span class="stat">Hand size <b>${p.handSize}</b></span>
      <span class="stat">Scored <b>${p.scored.length}</b></span>
    </div>`;
}

function renderControls(me: PlayerId): void {
  const inGate = !!state.pending;
  const confirmAtk = (state.phase === 'attack' && !inGate && selectedAttackers.size > 0)
    ? `<button class="go" data-act="confirm-attack">Attack ${esc(name(opp(me)))} with ${selectedAttackers.size}</button>` : '';
  el('controls').innerHTML = `
    <h3>Turn — ${state.phase} phase</h3>
    <div class="btnrow">
      ${confirmAtk}
      <button data-act="endphase" ${inGate ? 'disabled' : ''}>End phase →</button>
      <button class="primary" data-act="endturn" ${inGate ? 'disabled' : ''}>End turn ⏭</button>
    </div>
    ${state.phase === 'attack' && !inGate ? '<div class="meta" style="margin-top:6px">Click your units below to pick attackers. Score Directives in the panel above.</div>' : ''}`;
}

// The Directives panel: each active directive's quote, opener, and its
// Opener → I → II → (III) → Finisher ladder with the viewer's progress.
function renderObjectives(me: PlayerId): void {
  const inGate = !!state.pending;
  const dirs = objectivesView(state, me);
  const cards = dirs.map((d) => {
    const rungs = d.stages.map((st) => {
      const cls = st.done ? 'rung done' : st.next ? 'rung next' : 'rung locked';
      const btn = st.next && st.met && !inGate
        ? `<button class="go" data-act="score" data-flavor="${d.id}">Score ${st.stage}</button>` : '';
      const mark = st.done ? '✓' : st.stage;
      return `<div class="${cls}"><span class="rl">${mark}</span><span class="rt">${esc(st.text)}</span>${btn}</div>`;
    }).join('');
    const fcls = d.won ? 'rung fin done' : d.finisher.next ? 'rung fin next' : 'rung fin locked';
    const fbtn = d.finisher.next && d.finisher.met && !inGate
      ? `<button class="win" data-act="score" data-flavor="${d.id}">Score to WIN</button>` : '';
    const fin = `<div class="${fcls}"><span class="rl">★</span><span class="rt"><b>Finisher.</b> ${esc(d.finisher.text)}</span>${fbtn}</div>`;
    return `<div class="dir">
      <div class="dir-head"><span class="dn">${esc(d.name)}</span><span class="pill">${d.won ? 'WON 🏆' : `stage ${d.tier}`}</span></div>
      ${d.quote ? `<div class="quote">“${esc(d.quote)}”</div>` : ''}
      <div class="opener">Opener — ${esc(d.opener)}</div>
      <div class="ladder">${rungs}${fin}</div>
    </div>`;
  }).join('');
  el('objectives').innerHTML = `<h3>Directives — score on your turn (taps your Core)</h3><div class="dirs">${cards}</div>`;
}

function renderHand(me: PlayerId): void {
  const p = state.players[me];
  const cards = handOf(me).map((i) => {
    const d = def(i);
    const playable = d.kind === 'resource' ? true : (d.kind !== 'waste' && canAfford(p, d.cost));
    return renderCard(i, { act: 'play', disabled: !playable });
  }).join('');
  el('hand').innerHTML = `<h3>Hand (${handOf(me).length})</h3><div class="cards">${cards || '<span class="meta">empty</span>'}</div>`;
}

function renderOpp(me: PlayerId): void {
  const o = opp(me); const op = state.players[o];
  el('opp').innerHTML = `
    <h3>Opponent — ${esc(op.name)}</h3>
    <div class="stats">
      <span class="stat">Integrity <b>${op.integrity}</b></span>
      <span class="stat">Loyalty <b>${op.loyalty}</b></span>
      <span class="stat">Hand <b>${handOf(o).length}</b></span>
      <span class="stat">Has Core <b>${boardOf(o).some((i) => def(i).kind === 'core') ? 'yes' : 'NO'}</b></span>
      <span class="stat">Scored <b>${op.scored.length}</b></span>
    </div>`;
}

function renderBoard(me: PlayerId): void {
  const attackPhase = state.phase === 'attack' && !state.pending;
  const mine = boardOf(me).map((i) =>
    renderCard(i, attackPhase && eligibleAttacker(i)
      ? { act: 'attacker', selected: selectedAttackers.has(i.id) } : {})).join('');
  const theirs = boardOf(opp(me)).map((i) => renderCard(i, {})).join('');
  el('board').innerHTML = `
    <h3>Your board</h3><div class="cards">${mine || '<span class="meta">no permanents</span>'}</div>
    <h3 style="margin-top:10px">Their board</h3><div class="cards">${theirs || '<span class="meta">no permanents</span>'}</div>`;
}

function renderCombat(me: PlayerId): void {
  const g = state.pending;
  if (g && g.waitingOn.includes(me)) {
    const blockers = boardOf(me).filter(eligibleBlocker);
    const rows = g.attacks.map((a) => {
      const at = state.instances[a.attackerId];
      const ad = def(at);
      const opts = ['<option value="">— take the hit —</option>',
        ...blockers.map((b) => `<option value="${b.id}">block w/ ${esc(def(b).name)} (${def(b).stats?.attack ?? 0}/${(def(b).stats?.health ?? 0) - b.damage})</option>`)].join('');
      return `<div class="combat-row">
        <span><b>${esc(ad.name)}</b> ⚔ ${ad.stats?.attack ?? 0} → your colony</span>
        <select data-attacker="${a.attackerId}">${opts}</select>
      </div>`;
    }).join('');
    el('combat').innerHTML = `<h3>⚔ Incoming attack — assign blocks</h3>${rows}
      <div class="btnrow" style="margin-top:8px">
        <button class="go" data-act="confirm-blocks">Confirm blocks</button>
        <button data-act="take-hit">Take it all</button>
      </div>`;
  } else if (g) {
    el('combat').innerHTML = `<h3>⚔ Combat</h3><div class="meta">Waiting for ${esc(name(g.waitingOn[0]))} to respond…</div>`;
  } else {
    el('combat').innerHTML = `<h3>⚔ Combat</h3><div class="meta">No combat in progress.</div>`;
  }
}

function renderStacks(me: PlayerId): void {
  const p = state.players[me];
  const stacks = Object.values(state.supply).sort((a, b) => a.key.localeCompare(b.key));
  const row = (st: typeof stacks[number]): string => {
    const empty = st.cards.length === 0;
    const noBuys = p.buys <= 0;
    if (st.acquire === 'pay') {
      const top = empty ? undefined : CATALOG.get(st.cards[st.cards.length - 1])!;
      const afford = top ? canAfford(p, top.cost) : false;
      const dis = empty || noBuys || !afford;
      return `<div class="stack pay">
        <div class="st-top"><span class="sk">${st.key}</span><span class="si">×${st.cards.length}</span></div>
        <div class="st-mid">${top ? esc(top.name) : '—'}</div>
        <div class="st-bot">${top ? costBadge(top.cost, 'free') : '<span></span>'}<button data-act="buy" data-stack="${st.key}" ${dis ? 'disabled' : ''}>Buy</button></div>
      </div>`;
    }
    const dis = empty || noBuys;
    return `<div class="stack free">
      <div class="st-top"><span class="sk">${st.key}</span><span class="si">×${st.cards.length}</span></div>
      <div class="st-mid">blind</div>
      <div class="st-bot"><span></span><button data-act="buy" data-stack="${st.key}" ${dis ? 'disabled' : ''}>Pull</button></div>
    </div>`;
  };
  // Battery sources are visible (not blind), one small icon per pile, 3 to a row.
  // A battery pile is homogeneous, so its card is derived from the key (`battery:<id>`).
  const batDef = (st: typeof stacks[number]) => CATALOG.get(st.key.replace(/^battery:/, ''));
  const batPow = (st: typeof stacks[number]) => batDef(st)?.produces ?? 0;
  const batteryTile = (st: typeof stacks[number]): string => {
    const d = batDef(st);
    const pow = batPow(st);
    const nm = d ? esc(d.name) : '—';
    const dis = st.cards.length === 0 || p.buys <= 0;
    const act = dis ? '' : `data-act="buy" data-stack="${st.key}"`;
    return `<div class="bat${dis ? ' disabled' : ''}" ${act} title="${nm}: +${pow} Power · free to acquire, pay to play">
      <div class="bat-pow">⚡${pow}</div>
      <div class="bat-name">${nm}</div>
      <div class="bat-n">×${st.cards.length}</div>
    </div>`;
  };
  const battery = stacks
    .filter((s) => s.category === 'battery')
    .sort((a, b) => batPow(a) - batPow(b))   // order by power output (ascending)
    .map(batteryTile).join('');
  // Order resource stacks tier-by-tier (mineral, influence, …) so the 2-column
  // row-major grid puts each resource type in its own column, tiers aligned by row.
  const TIER_RANK: Record<string, number> = { I: 0, II: 1, III: 2 };
  const CAT_RANK: Record<string, number> = { mineral: 0, influence: 1 };
  const pay = stacks
    .filter((s) => s.acquire === 'pay')
    .sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || (CAT_RANK[a.category] ?? 9) - (CAT_RANK[b.category] ?? 9))
    .map(row).join('');
  const action = stacks.filter((s) => s.acquire === 'free' && s.category !== 'battery').map(row).join('');
  el('stacks').innerHTML = `
    <h3>Battery sources — visible piles</h3><div class="bat-grid">${battery}</div>
    <h3 style="margin-top:10px">Resource stacks — pay to acquire</h3><div class="stack-grid">${pay}</div>
    <h3 style="margin-top:10px">Action stacks — free &amp; blind</h3><div class="stack-grid">${action}</div>
    <div class="meta" style="margin-top:6px">Buys left this turn: <b>${p.buys}</b></div>`;
}

function renderLog(): void {
  const lines = state.log.slice(-40).map(esc).join('\n');
  el('log').innerHTML = `<h3>Log</h3><div class="loglines">${lines}</div>`;
  const lg = el('log').querySelector('.loglines'); if (lg) lg.scrollTop = lg.scrollHeight;
}

function setOverlay(html: string): void { const o = el('overlay'); o.innerHTML = html; o.classList.remove('hidden'); }
function hideOverlay(): void { el('overlay').classList.add('hidden'); }

function render(): void {
  const me = actor();
  renderTop(); renderObjectives(me); renderMe(me); renderControls(me); renderHand(me);
  renderOpp(me); renderCombat(me); renderBoard(me); renderStacks(me); renderLog();
  if (state.status === 'finished') {
    setOverlay(`<div class="card-box"><h1 class="win">${esc(name(state.winner!))} wins! 🏆</h1>
      <p>Round ${state.round} • ${state.players[state.winner!].scored.length} objectives scored</p>
      <button class="go" data-act="new-game">Play again</button></div>`);
  } else if (me !== shownActor) {
    setOverlay(`<div class="card-box"><h1>${esc(name(me))}</h1>
      <p>${state.pending ? 'Your colony is under attack — assign blocks.' : 'Your turn. Keep your hand secret.'}</p>
      <span class="pill">Round ${state.round} • ${state.phase}</span><br><br>
      <button class="primary" data-act="reveal">Reveal &amp; continue</button></div>`);
  } else {
    hideOverlay();
  }
}

// --- actions -----------------------------------------------------------------
function confirmAttack(me: PlayerId): void {
  if (selectedAttackers.size === 0) return;
  const target = { player: opp(me) };
  const attacks = [...selectedAttackers].map((id) => ({ attackerId: id, target }));
  selectedAttackers.clear();
  apply(me, { type: 'declareAttack', attacks });
}
function confirmBlocks(me: PlayerId): void {
  const blocks: { blockerId: string; attackerId: string }[] = [];
  document.querySelectorAll<HTMLSelectElement>('select[data-attacker]').forEach((sel) => {
    if (sel.value) blocks.push({ blockerId: sel.value, attackerId: sel.dataset.attacker! });
  });
  apply(me, { type: 'respondToAttack', blocks });
}
function aiTurn(): void {
  if (state.status !== 'playing') return;
  if (state.pending) resolveGates(getState, apply);
  else playWholeTurn(getState, apply, actor());
}
function newGame(): void {
  seed = Math.floor(Math.random() * 1e9);
  state = createGame('local', PLAYERS, SETUP, seed);
  state = reduce(state, { playerId: 'A', now: Date.now() }, { type: 'startGame' });
  selectedAttackers.clear();
  shownActor = null;
  render();
}

// --- click routing -----------------------------------------------------------
el('app').addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!t) return;
  const me = actor();
  switch (t.dataset.act) {
    case 'reveal': shownActor = actor(); render(); break;
    case 'new-game': newGame(); break;
    case 'play': apply(me, { type: 'playCard', instId: t.dataset.id!, chosen: [opp(me)] }); break;
    case 'buy': apply(me, { type: 'buyCard', stackKey: t.dataset.stack! }); break;
    case 'attacker': {
      const id = t.dataset.id!;
      if (selectedAttackers.has(id)) selectedAttackers.delete(id); else selectedAttackers.add(id);
      render(); break;
    }
    case 'confirm-attack': confirmAttack(me); break;
    case 'confirm-blocks': confirmBlocks(me); break;
    case 'take-hit': apply(me, { type: 'respondToAttack', blocks: [] }); break;
    case 'score': apply(me, { type: 'scoreObjective', flavor: t.dataset.flavor! }); break;
    case 'endphase': selectedAttackers.clear(); apply(me, { type: 'endPhase' }); break;
    case 'endturn': selectedAttackers.clear(); apply(me, { type: 'endTurn' }); break;
    case 'ai': aiTurn(); break;
  }
});

newGame();
