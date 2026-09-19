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

// ---- glyph vocabulary (basic shapes per card type) --------------------------
// No art — just distinct geometric marks so a colony's formation is readable at
// a glance: triangle=unit, shield=fortification, square=structure/enhancement,
// bolt=battery, diamond=resource, circle=action, dashed hex=scheme, star=core.
type GlyphKind = 'core' | 'unit' | 'fort' | 'structure' | 'battery' | 'resource' | 'operation' | 'scheme';
const GLYPH_SVG: Record<GlyphKind, string> = {
  unit: '<polygon points="12,3 22,21 2,21"/>',
  fort: '<path d="M12 2 21 6 21 12 C21 17 17 21 12 22 C7 21 3 17 3 12 L3 6 Z"/>',
  structure: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  battery: '<polygon points="13,2 4,14 11,14 9,22 20,10 13,10"/>',
  resource: '<polygon points="12,2 22,12 12,22 2,12"/>',
  operation: '<circle cx="12" cy="12" r="9"/>',
  scheme: '<polygon class="hollow" points="12,2 21,7 21,17 12,22 3,17 3,7"/>',
  core: '<polygon points="12,1.6 14.9,8.6 22.4,9.2 16.7,14 18.5,21.4 12,17.3 5.5,21.4 7.3,14 1.6,9.2 9.1,8.6"/>',
};
const GLYPH_LABEL: Record<GlyphKind, string> = {
  core: 'Core', unit: 'Unit', fort: 'Fort', structure: 'Structure',
  battery: 'Battery', resource: 'Resource', operation: 'Action', scheme: 'Scheme',
};
function glyphKind(d: CardDef): GlyphKind {
  if (d.kind === 'core') return 'core';
  if (d.kind === 'resource') return 'resource';
  if (d.kind === 'operation') return 'operation';
  if (d.incubation) return 'scheme';
  const t = (d.type || '').toLowerCase();
  if (/(unit|mercenary|soldier|squadron|mech|marksmen|riflemen|footsoldier|grunt|transport|artillery|tank|operative)/.test(t)) return 'unit';
  if (t.includes('fortification')) return 'fort';
  if (d.category === 'battery' || (d.produces ?? 0) > 0) return 'battery';
  return 'structure';
}
function glyphSvg(d: CardDef, size = 20): string {
  const k = glyphKind(d);
  return `<svg class="glyph gl-${k}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${GLYPH_SVG[k]}</svg>`;
}
function glyphLegend(): string {
  const ks: GlyphKind[] = ['unit', 'fort', 'structure', 'battery', 'resource', 'operation', 'scheme', 'core'];
  return `<span class="legend">${ks.map((k) =>
    `<span class="lg"><svg class="glyph gl-${k}" viewBox="0 0 24 24" width="12" height="12">${GLYPH_SVG[k]}</svg>${GLYPH_LABEL[k]}</span>`).join('')}</span>`;
}

// ---- deployment grid (Vanguard / Support / Core lanes) ----------------------
function chip(c: NetCard & { canAttack?: boolean }, mine: boolean): string {
  const d = defOf(c.defId); if (!d) return '';
  const k = glyphKind(d);
  const canAtk = mine && canAct() && view!.phase === 'attack' && !!c.canAttack;
  const selected = selectedAttackers.has(c.instId);
  const cls = ['chip', `chip-${k}`];
  if (c.tapped) cls.push('tapped');
  if (!c.active) cls.push('inactive');
  if (canAtk) cls.push('clickable');
  if (selected) cls.push('selected');
  const actAttr = canAtk ? ` data-act="attacker" data-id="${c.instId}"` : '';
  const stat = d.stats ? `<span class="chip-stat">${c.attack}/${c.health}</span>` : `<span class="chip-sub">${GLYPH_LABEL[k]}</span>`;
  let move = '';
  if (mine && canAct() && c.lane) {
    const to = c.lane === 'vanguard' ? 'support' : 'vanguard';
    move = `<button class="chip-move" data-act="reposition" data-id="${c.instId}" data-lane="${to}" title="Redeploy to ${to}">${to === 'support' ? '▽' : '△'}</button>`;
  }
  return `<div class="${cls.join(' ')}"${actAttr} title="${esc(d.name)}">
    <span class="chip-g">${glyphSvg(d, 22)}</span>
    <span class="chip-main"><span class="chip-name">${esc(d.name)}</span>${stat}</span>
    ${move}
  </div>`;
}
function deployGrid(cards: (NetCard & { canAttack?: boolean })[], mine: boolean): string {
  const lane = (key: string, label: string, list: typeof cards) =>
    `<div class="lane lane-${key}"><span class="lane-tag">${label}</span>
      <div class="cells">${list.map((c) => chip(c, mine)).join('') || '<span class="cell-empty">— clear —</span>'}</div></div>`;
  return `<div class="deploy">
    ${lane('van', '▲ VANGUARD', cards.filter((c) => c.lane === 'vanguard'))}
    ${lane('sup', '■ SUPPORT', cards.filter((c) => c.lane === 'support'))}
    ${lane('core', '★ CORE', cards.filter((c) => c.lane === null))}
  </div>`;
}

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
    <div class="cn"><span class="glyph-badge">${glyphSvg(d, 16)}</span>${esc(d.name)}</div>
    <div class="meta">${meta}</div>
    ${statLine}
    <div class="txt">${esc(d.text ?? '')}</div>
  </div>`;
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
  const g = (cls: string, label: string, val: number | string): string =>
    `<span class="gauge ${cls}"><span class="gv">${val}</span><span class="gl">${label}</span></span>`;
  el('me').innerHTML = `
    <h3>${esc(p.name)} — colony command</h3>
    <div class="hud">
      ${g('g-int', 'Integrity', p.integrity)}
      ${g('g-loy', 'Loyalty', p.loyalty)}
      ${g('g-min', 'Minerals', p.minerals)}
      ${g('g-inf', 'Influence', p.influence)}
      ${g('g-pow', 'Energy', p.energy)}
      ${g('', 'Buys', p.buys)}
      ${g('', 'Storage', p.storage)}
      ${g('', 'Hand', p.handSize)}
      ${g('', 'Scored', p.scored.length)}
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
  const byId: Record<string, NetCard[]> = {};
  for (const c of v.board.theirs) (byId[c.controller] ??= []).push(c);
  const rows = v.opponents.map((o) => `
    <div class="opp-console">
      <div class="opp-h">
        <span class="opp-name">${esc(o.name)}</span>
        <span class="hud-mini">
          <span class="g-int">◆ ${o.integrity}</span>
          <span class="g-loy">✦ ${o.loyalty}</span>
          <span>✋ ${o.handCount}</span>
          <span class="${o.hasCore ? '' : 'lost'}">★ ${o.hasCore ? 'Core' : 'no Core'}</span>
          <span>◈ ${o.scored}</span>
        </span>
      </div>
      ${deployGrid(byId[o.id] ?? [], false)}
    </div>`).join('');
  el('opp').innerHTML = `<h3>Rival colonies</h3>${rows || '<div class="meta">No opponents.</div>'}`;
}

function renderBoard(v: NetView): void {
  el('board').innerHTML = `
    <h3>Your formation ${glyphLegend()}</h3>
    ${deployGrid(v.board.mine, true)}
    ${canAct() && v.phase === 'attack' ? '<div class="meta hint-line">Front-line (Vanguard) units attack &amp; defend. Use △▽ to redeploy between lines.</div>' : ''}`;
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
    case 'reposition': void send({ type: 'reposition', instId: t.dataset.id!, lane: t.dataset.lane as 'vanguard' | 'support' }); break;
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
