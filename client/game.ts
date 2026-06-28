// =============================================================================
// client/game.ts — the networked game view. A thin renderer: it draws whatever
// the server's per-player NetView says and turns clicks into Actions posted back
// to the server. Card definitions come from the catalog (fetched once); only
// dynamic per-instance state arrives each poll.
//
// Unlike the old hotseat UI there is no "pass the device" — each browser shows
// only its own player's view, so hidden information stays hidden server-side.
// =============================================================================
import type {
  NetView, NetCard, NetHandCard, NetStack, Action, CardDef, ResCost, DirectiveView,
} from '../engine.js';
import type { Auth } from '../server/lobby.js';

type Send = (action: Action) => void | Promise<void>;

let catalog = new Map<string, CardDef>();
let view: NetView | null = null;
let send: Send = () => {};
let onLeave: () => void = () => {};
const selectedAttackers = new Set<string>();
let selectedOpponent: string | null = null;

// Bind the game-screen event handlers exactly once.
export function setupGame(opts: { send: Send; onLeave: () => void }): void {
  send = opts.send; onLeave = opts.onLeave;
  el('screen-game').addEventListener('click', onClick);
  el('screen-game').addEventListener('change', onChange);
}

// Card definitions are static; set them once the catalog has been fetched.
export function setGameCatalog(map: Map<string, CardDef>): void { catalog = map; }

// ---- small helpers ----------------------------------------------------------
const defOf = (id: string): CardDef | undefined => catalog.get(id);
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
const costBadge = (c: ResCost | undefined, freeLabel: string): string => `<span class="cost">${costInner(c) || freeLabel}</span>`;

const canAct = (): boolean => !!view && view.yourTurn && !view.pending;
const mustRespond = (): boolean => !!view?.pending?.youMustRespond;

// ---- card faces -------------------------------------------------------------
function cardFace(d: CardDef, statLine: string, opts: { act?: string; id?: string; disabled?: boolean; selected?: boolean; tapped?: boolean; inactive?: boolean }): string {
  const cls = ['card'];
  if (d.kind === 'resource') cls.push('resource');
  if (opts.act && !opts.disabled) cls.push('clickable');
  if (opts.disabled) cls.push('disabled');
  if (opts.selected) cls.push('selected');
  if (opts.tapped) cls.push('tapped');
  if (opts.inactive) cls.push('inactive');
  const data = opts.act && !opts.disabled ? ` data-act="${opts.act}" data-id="${opts.id}"` : '';
  const cost = d.kind === 'resource' ? '<span class="cost">free</span>' : costBadge(d.cost, 'free');
  const meta = `${d.tier ?? '–'} • ${esc(d.type)}${d.upkeep ? ` • ⚡${d.upkeep}` : ''}`;
  return `<div class="${cls.join(' ')}"${data}>
    ${cost}
    <div class="cn">${esc(d.name)}</div>
    <div class="meta">${meta}</div>
    ${statLine}
    <div class="txt">${esc(d.text ?? '')}</div>
  </div>`;
}
function boardCardHtml(c: NetCard, opts: { act?: string; selected?: boolean } = {}): string {
  const d = defOf(c.defId); if (!d) return '';
  const stats = d.stats ? `<div class="stat-line">${c.attack}/${c.health}</div>` : '';
  return cardFace(d, stats, { ...opts, id: c.instId, tapped: c.tapped, inactive: !c.active });
}
function handCardHtml(h: NetHandCard): string {
  const d = defOf(h.defId); if (!d) return '';
  const stats = d.stats ? `<div class="stat-line">${d.stats.attack}/${d.stats.health}</div>` : '';
  return cardFace(d, stats, { act: 'play', id: h.instId, disabled: !h.playable });
}

// ---- panels -----------------------------------------------------------------
function renderTop(v: NetView): void {
  const turn = v.status === 'finished' ? 'game over'
    : v.yourTurn ? 'your turn'
    : v.pending?.youMustRespond ? 'respond to attack'
    : `waiting for ${esc(v.activePlayerName)}`;
  el('topbar').innerHTML = `
    <span class="title">TERRESTRIA</span>
    <span class="tag">Round <b>${v.round}</b></span>
    <span class="tag">Phase <b>${v.phase}</b></span>
    <span class="tag turn ${v.yourTurn ? 'active-turn' : ''}">${turn}</span>
    <span class="tag">Directives: ${v.objectiveFlavors.join(' · ')}</span>
    <span class="spacer"></span>
    <span class="tag">Code <b>${esc(v.gameId)}</b></span>
    <button data-act="leave">Leave</button>`;
}

function renderMe(v: NetView): void {
  const p = v.you;
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

function opponentPicker(v: NetView): string {
  if (v.opponents.length <= 1) return '';
  const opts = v.opponents.map((o) => `<option value="${o.id}" ${o.id === selectedOpponent ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  return `<label class="target-pick">Target <select data-act="pick-opp">${opts}</select></label>`;
}

function renderControls(v: NetView): void {
  if (v.pending) {
    el('controls').innerHTML = `<h3>Combat</h3><div class="meta">${
      v.pending.youMustRespond ? 'Your colony is under attack — assign blocks below.' : `Waiting for ${esc(v.pending.waitingOnName)} to respond…`
    }</div>`;
    return;
  }
  if (!v.yourTurn) {
    el('controls').innerHTML = `<h3>Turn — ${v.phase} phase</h3><div class="meta">Waiting for <b>${esc(v.activePlayerName)}</b> to play…</div>`;
    return;
  }
  const confirmAtk = (v.phase === 'attack' && selectedAttackers.size > 0)
    ? `<button class="go" data-act="confirm-attack">Attack with ${selectedAttackers.size}</button>` : '';
  el('controls').innerHTML = `
    <h3>Turn — ${v.phase} phase</h3>
    ${opponentPicker(v)}
    <div class="btnrow">
      ${confirmAtk}
      <button data-act="endphase">End phase →</button>
      <button class="primary" data-act="endturn">End turn ⏭</button>
    </div>
    ${v.phase === 'attack' ? '<div class="meta" style="margin-top:6px">Click your units below to pick attackers. Score Directives in the panel above.</div>' : ''}`;
}

function renderObjectives(v: NetView): void {
  const allow = canAct();
  const cards = v.directives.map((d: DirectiveView) => {
    const rungs = d.stages.map((st) => {
      const cls = st.done ? 'rung done' : st.next ? 'rung next' : 'rung locked';
      const btn = st.next && st.met && allow ? `<button class="go" data-act="score" data-flavor="${d.id}">Score ${st.stage}</button>` : '';
      const mark = st.done ? '✓' : st.stage;
      return `<div class="${cls}"><span class="rl">${mark}</span><span class="rt">${esc(st.text)}</span>${btn}</div>`;
    }).join('');
    const fcls = d.won ? 'rung fin done' : d.finisher.next ? 'rung fin next' : 'rung fin locked';
    const fbtn = d.finisher.next && d.finisher.met && allow ? `<button class="win" data-act="score" data-flavor="${d.id}">Score to WIN</button>` : '';
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

function renderHand(v: NetView): void {
  const cards = v.you.hand.map(handCardHtml).join('');
  el('hand').innerHTML = `<h3>Hand (${v.you.hand.length})</h3><div class="cards">${cards || '<span class="meta">empty</span>'}</div>`;
}

function renderOpp(v: NetView): void {
  const rows = v.opponents.map((o) => `
    <div class="opp-row">
      <h3>${esc(o.name)}</h3>
      <div class="stats">
        <span class="stat">Integrity <b>${o.integrity}</b></span>
        <span class="stat">Loyalty <b>${o.loyalty}</b></span>
        <span class="stat">Hand <b>${o.handCount}</b></span>
        <span class="stat">Has Core <b>${o.hasCore ? 'yes' : 'NO'}</b></span>
        <span class="stat">Scored <b>${o.scored}</b></span>
      </div>
    </div>`).join('');
  el('opp').innerHTML = rows || '<div class="meta">No opponents.</div>';
}

function renderBoard(v: NetView): void {
  const attackPhase = canAct() && v.phase === 'attack';
  const mine = v.board.mine.map((c) =>
    boardCardHtml(c, attackPhase && c.canAttack ? { act: 'attacker', selected: selectedAttackers.has(c.instId) } : {})).join('');
  const theirs = v.board.theirs.map((c) => boardCardHtml(c, {})).join('');
  el('board').innerHTML = `
    <h3>Your board</h3><div class="cards">${mine || '<span class="meta">no permanents</span>'}</div>
    <h3 style="margin-top:10px">Enemy boards</h3><div class="cards">${theirs || '<span class="meta">no permanents</span>'}</div>`;
}

function renderCombat(v: NetView): void {
  const g = v.pending;
  if (g && g.youMustRespond) {
    const rows = g.attacks.map((a) => {
      const ad = defOf(a.attackerDefId);
      const opts = ['<option value="">— take the hit —</option>',
        ...g.yourBlockers.map((b) => { const bd = defOf(b.defId); return `<option value="${b.instId}">block w/ ${esc(bd?.name ?? '?')} (${b.attack}/${b.health})</option>`; })].join('');
      return `<div class="combat-row">
        <span><b>${esc(ad?.name ?? '?')}</b> ⚔ ${a.attack} → your colony</span>
        <select data-attacker="${a.attackerId}">${opts}</select>
      </div>`;
    }).join('');
    el('combat').innerHTML = `<h3>⚔ Incoming attack — assign blocks</h3>${rows}
      <div class="btnrow" style="margin-top:8px">
        <button class="go" data-act="confirm-blocks">Confirm blocks</button>
        <button data-act="take-hit">Take it all</button>
      </div>`;
  } else if (g) {
    el('combat').innerHTML = `<h3>⚔ Combat</h3><div class="meta">Waiting for ${esc(g.waitingOnName)} to respond…</div>`;
  } else {
    el('combat').innerHTML = `<h3>⚔ Combat</h3><div class="meta">No combat in progress.</div>`;
  }
}

function renderStacks(v: NetView): void {
  const stacks = v.supply;
  const row = (st: NetStack): string => {
    if (st.acquire === 'pay') {
      const top = st.topDefId ? defOf(st.topDefId) : undefined;
      return `<div class="stack pay">
        <div class="st-top"><span class="sk">${st.key}</span><span class="si">×${st.count}</span></div>
        <div class="st-mid">${top ? esc(top.name) : '—'}</div>
        <div class="st-bot">${top ? costBadge(top.cost, 'free') : '<span></span>'}<button data-act="buy" data-stack="${st.key}" ${st.canBuy ? '' : 'disabled'}>Buy</button></div>
      </div>`;
    }
    return `<div class="stack free">
      <div class="st-top"><span class="sk">${st.key}</span><span class="si">×${st.count}</span></div>
      <div class="st-mid">blind</div>
      <div class="st-bot"><span></span><button data-act="buy" data-stack="${st.key}" ${st.canBuy ? '' : 'disabled'}>Pull</button></div>
    </div>`;
  };
  const batDef = (st: NetStack) => defOf(st.key.replace(/^battery:/, ''));
  const batPow = (st: NetStack) => batDef(st)?.produces ?? 0;
  const batteryTile = (st: NetStack): string => {
    const d = batDef(st);
    const nm = d ? esc(d.name) : '—';
    const act = st.canBuy ? `data-act="buy" data-stack="${st.key}"` : '';
    return `<div class="bat${st.canBuy ? '' : ' disabled'}" ${act} title="${nm}: +${batPow(st)} Power">
      <div class="bat-pow">⚡${batPow(st)}</div><div class="bat-name">${nm}</div><div class="bat-n">×${st.count}</div>
    </div>`;
  };
  const battery = stacks.filter((s) => s.category === 'battery').sort((a, b) => batPow(a) - batPow(b)).map(batteryTile).join('');
  const TIER: Record<string, number> = { I: 0, II: 1, III: 2 };
  const CAT: Record<string, number> = { mineral: 0, influence: 1 };
  const pay = stacks.filter((s) => s.acquire === 'pay')
    .sort((a, b) => (TIER[a.tier] ?? 9) - (TIER[b.tier] ?? 9) || (CAT[a.category] ?? 9) - (CAT[b.category] ?? 9)).map(row).join('');
  const action = stacks.filter((s) => s.acquire === 'free' && s.category !== 'battery').map(row).join('');
  el('stacks').innerHTML = `
    <h3>Battery sources — visible piles</h3><div class="bat-grid">${battery}</div>
    <h3 style="margin-top:10px">Resource stacks — pay to acquire</h3><div class="stack-grid">${pay}</div>
    <h3 style="margin-top:10px">Action stacks — free &amp; blind</h3><div class="stack-grid">${action}</div>
    <div class="meta" style="margin-top:6px">Buys left this turn: <b>${v.you.buys}</b></div>`;
}

function renderLog(v: NetView): void {
  el('log').innerHTML = `<h3>Log</h3><div class="loglines">${v.log.map(esc).join('\n')}</div>`;
  const lg = el('log').querySelector('.loglines'); if (lg) lg.scrollTop = lg.scrollHeight;
}

function setOverlay(html: string): void { const o = el('overlay'); o.innerHTML = html; o.classList.remove('hidden'); }
function hideOverlay(): void { el('overlay').classList.add('hidden'); }

export function renderGame(v: NetView): void {
  view = v;
  // keep the opponent target valid
  if (!selectedOpponent || !v.opponents.some((o) => o.id === selectedOpponent)) selectedOpponent = v.opponents[0]?.id ?? null;
  renderTop(v); renderObjectives(v); renderMe(v); renderControls(v); renderHand(v);
  renderOpp(v); renderCombat(v); renderBoard(v); renderStacks(v); renderLog(v);
  if (v.status === 'finished') {
    const youWon = v.winner === v.viewerId;
    setOverlay(`<div class="card-box"><h1 class="win">${youWon ? 'You win! 🏆' : `${esc(v.winnerName ?? 'Someone')} wins`}</h1>
      <p>Round ${v.round} • ${v.you.scored.length} objectives scored</p>
      <button class="primary" data-act="leave">Back to lobby</button></div>`);
  } else {
    hideOverlay();
  }
}

// ---- input ------------------------------------------------------------------
function confirmAttack(): void {
  if (selectedAttackers.size === 0 || !selectedOpponent) return;
  const target = { player: selectedOpponent };
  const attacks = [...selectedAttackers].map((id) => ({ attackerId: id, target }));
  selectedAttackers.clear();
  void send({ type: 'declareAttack', attacks });
}
function confirmBlocks(): void {
  const blocks: { blockerId: string; attackerId: string }[] = [];
  document.querySelectorAll<HTMLSelectElement>('select[data-attacker]').forEach((sel) => {
    if (sel.value) blocks.push({ blockerId: sel.value, attackerId: sel.dataset.attacker! });
  });
  void send({ type: 'respondToAttack', blocks });
}

function onChange(e: Event): void {
  const t = e.target as HTMLElement;
  if (t instanceof HTMLSelectElement && t.dataset.act === 'pick-opp') {
    selectedOpponent = t.value;
  }
}

function onClick(e: MouseEvent): void {
  const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!t) return;
  switch (t.dataset.act) {
    case 'leave': onLeave(); break;
    case 'play': void send({ type: 'playCard', instId: t.dataset.id!, chosen: selectedOpponent ? [selectedOpponent] : undefined }); break;
    case 'buy': void send({ type: 'buyCard', stackKey: t.dataset.stack! }); break;
    case 'attacker': {
      const id = t.dataset.id!;
      if (selectedAttackers.has(id)) selectedAttackers.delete(id); else selectedAttackers.add(id);
      if (view) renderGame(view);
      break;
    }
    case 'confirm-attack': confirmAttack(); break;
    case 'confirm-blocks': confirmBlocks(); break;
    case 'take-hit': void send({ type: 'respondToAttack', blocks: [] }); break;
    case 'score': void send({ type: 'scoreObjective', flavor: t.dataset.flavor! }); break;
    case 'endphase': selectedAttackers.clear(); void send({ type: 'endPhase' }); break;
    case 'endturn': selectedAttackers.clear(); void send({ type: 'endTurn' }); break;
  }
}

export function resetGameSelection(): void { selectedAttackers.clear(); selectedOpponent = null; }
