// =============================================================================
// client/main.ts — the SPA shell. Owns screen routing (landing → lobby → game),
// session persistence (so a refresh rejoins), and the polling loops that keep
// each screen in sync with the authoritative server state.
//
// Polling (rather than websockets) is a deliberate choice: it maps cleanly onto
// the eventual API Gateway + Lambda + DynamoDB pipeline, where every poll is a
// stateless GET. Renders only happen when the server's version actually changes.
// =============================================================================
import type { CardDef, Action } from '../engine.js';
import type { PublicRoom, Auth } from '../server/lobby.js';
import * as api from './api.js';
import { ApiError } from './api.js';
import { setupGame, setGameCatalog, renderGame, resetGameSelection } from './game.js';

interface Session { code: string; auth: Auth; isHost: boolean; name: string; }

const SESSION_KEY = 'terrestria.session';
const LOBBY_POLL_MS = 1500;
const GAME_POLL_MS = 1000;

let catalog = new Map<string, CardDef>();
let session: Session | null = null;
let pollTimer: number | null = null;
let lastVersion = -1;

// ---- session persistence ----------------------------------------------------
function loadSession(): Session | null {
  try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) as Session : null; } catch { return null; }
}
function saveSession(s: Session): void { session = s; localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession(): void { session = null; localStorage.removeItem(SESSION_KEY); location.hash = ''; }

// ---- screen plumbing --------------------------------------------------------
const $ = (id: string) => document.getElementById(id)!;
function show(screen: 'landing' | 'lobby' | 'game'): void {
  for (const s of ['landing', 'lobby', 'game'] as const) $(`screen-${s}`).classList.toggle('hidden', s !== screen);
}
function stopPolling(): void { if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; } }
function setError(id: string, msg: string | null): void {
  const e = $(id);
  e.textContent = msg ?? ''; e.classList.toggle('hidden', !msg);
}

// ---- error handling ---------------------------------------------------------
// 404 (game reaped/closed) or 401 (stale session) drop us back to the landing.
function fatal(e: unknown): boolean {
  if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
    stopPolling();
    const msg = e.status === 404 ? 'That game ended (closed or inactive too long).' : 'Your session for that game is no longer valid.';
    clearSession();
    enterLanding(msg);
    return true;
  }
  return false;
}

// ---- LANDING ----------------------------------------------------------------
function enterLanding(message?: string): void {
  stopPolling();
  show('landing');
  setError('landing-error', message ?? null);
  const nameInput = $('name-input') as HTMLInputElement;
  if (!nameInput.value && session?.name) nameInput.value = session.name;
  const codeFromHash = location.hash.replace(/^#/, '').toUpperCase();
  if (codeFromHash) (($('code-input') as HTMLInputElement).value = codeFromHash);
}

async function doCreate(): Promise<void> {
  const name = ($('name-input') as HTMLInputElement).value;
  setError('landing-error', null);
  try {
    const { code, auth } = await api.createGame(name);
    saveSession({ code, auth, isHost: true, name });
    location.hash = code;
    enterLobby();
  } catch (e) { setError('landing-error', e instanceof Error ? e.message : 'Could not create game'); }
}

async function doJoin(ev: Event): Promise<void> {
  ev.preventDefault();
  const name = ($('name-input') as HTMLInputElement).value;
  const code = ($('code-input') as HTMLInputElement).value.trim().toUpperCase();
  setError('landing-error', null);
  if (!code) { setError('landing-error', 'Enter a game code to join.'); return; }
  try {
    const { auth } = await api.joinGame(code, name);
    saveSession({ code, auth, isHost: false, name });
    location.hash = code;
    enterLobby();
  } catch (e) { setError('landing-error', e instanceof Error ? e.message : 'Could not join game'); }
}

// ---- LOBBY (waiting room) ---------------------------------------------------
function enterLobby(): void {
  if (!session) return enterLanding();
  stopPolling();
  show('lobby');
  setError('lobby-error', null);
  $('room-code').textContent = session.code;
  void pollLobby();
  pollTimer = window.setInterval(() => void pollLobby(), LOBBY_POLL_MS);
}

function renderLobby(room: PublicRoom): void {
  $('player-count').textContent = `${room.players.length}/${room.maxPlayers}`;
  $('player-list').innerHTML = room.players.map((p) => {
    const tags = [p.isHost ? '<span class="pill host">host</span>' : '', p.id === session?.auth.playerId ? '<span class="pill you">you</span>' : ''].join(' ');
    return `<li><span class="pname">${escapeHtml(p.name)}</span> ${tags}</li>`;
  }).join('');

  const startBtn = $('start-btn') as HTMLButtonElement;
  const note = $('waiting-note');
  if (session?.isHost) {
    startBtn.classList.remove('hidden');
    startBtn.disabled = !room.canStart;
    note.textContent = room.canStart ? '' : `Need at least ${room.minPlayers} players to start.`;
  } else {
    startBtn.classList.add('hidden');
    note.textContent = 'Waiting for the host to start the game…';
  }
}

async function pollLobby(): Promise<void> {
  if (!session) return;
  try {
    const { room } = await api.getRoom(session.code);
    if (room.phase === 'active' || room.phase === 'finished') { enterGame(); return; }
    renderLobby(room);
  } catch (e) { if (!fatal(e)) setError('lobby-error', e instanceof Error ? e.message : 'Lost contact with the game'); }
}

async function doStart(): Promise<void> {
  if (!session) return;
  setError('lobby-error', null);
  try { await api.startGame(session.code, session.auth); enterGame(); }
  catch (e) { if (!fatal(e)) setError('lobby-error', e instanceof Error ? e.message : 'Could not start game'); }
}

// ---- GAME -------------------------------------------------------------------
function enterGame(): void {
  if (!session) return enterLanding();
  stopPolling();
  resetGameSelection();
  lastVersion = -1;
  show('game');
  void pollGame();
  pollTimer = window.setInterval(() => void pollGame(), GAME_POLL_MS);
}

async function pollGame(): Promise<void> {
  if (!session) return;
  try {
    const { view } = await api.getState(session.code, session.auth);
    if (view.version !== lastVersion) { lastVersion = view.version; renderGame(view); }
  } catch (e) { fatal(e); }
}

async function sendAction(action: Action): Promise<void> {
  if (!session) return;
  try {
    const { view } = await api.sendAction(session.code, session.auth, action);
    lastVersion = view.version; renderGame(view);
  } catch (e) { if (!fatal(e)) { /* illegal/stale move — next poll re-syncs */ } }
}

function leaveGame(): void { stopPolling(); clearSession(); enterLanding(); }

// ---- boot -------------------------------------------------------------------
function escapeHtml(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }

function wireLanding(): void {
  $('create-btn').addEventListener('click', () => void doCreate());
  $('join-form').addEventListener('submit', (e) => void doJoin(e));
  ($('code-input') as HTMLInputElement).addEventListener('input', (e) => {
    const i = e.target as HTMLInputElement; i.value = i.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
}
function wireLobby(): void {
  $('start-btn').addEventListener('click', () => void doStart());
  $('leave-btn').addEventListener('click', () => { clearSession(); enterLanding(); });
  $('copy-link').addEventListener('click', async () => {
    if (!session) return;
    const link = `${location.origin}/#${session.code}`;
    try { await navigator.clipboard.writeText(link); $('copy-link').textContent = 'Copied!'; setTimeout(() => ($('copy-link').textContent = 'Copy invite link'), 1500); }
    catch { setError('lobby-error', `Invite link: ${link}`); }
  });
}

async function resume(): Promise<void> {
  if (!session) { enterLanding(); return; }
  try {
    const { room } = await api.getRoom(session.code);
    if (room.phase === 'lobby') enterLobby(); else enterGame();
  } catch (e) { if (!fatal(e)) enterLanding(); }
}

async function boot(): Promise<void> {
  wireLanding(); wireLobby();
  setupGame({ send: sendAction, onLeave: leaveGame }); // bind handlers once
  try {
    const cat = await api.getCatalog();
    catalog = new Map(cat.cards.map((c) => [c.id, c]));
    setGameCatalog(catalog);
  } catch {
    setError('landing-error', 'Could not load the card catalog from the server.');
  }
  session = loadSession();
  await resume();
}

void boot();
