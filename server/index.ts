// =============================================================================
// server/index.ts — the HTTP edge. Two responsibilities, kept separate so they
// can split into different AWS services later:
//
//   1. /api/*   — the JSON game API. Today it calls LobbyService in-process;
//                 each route maps 1:1 to an API Gateway route → Lambda later.
//   2. /*       — the static "HTML visuals" tier (built client from dist/).
//                 Becomes S3 + CloudFront later; the client only ever talks /api.
//
// A background sweeper reaps inactive games (the local stand-in for DynamoDB TTL).
// =============================================================================
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { CONFIG } from './config.js';
import { MemoryGameStore } from './store.js';
import { LobbyService, AuthError, LobbyError } from './lobby.js';
import { NotFoundError, ConcurrencyError } from './store.js';
import { CODE_LENGTH } from './codes.js';
import { CARDS, CATALOG_VERSION, SETUP } from '../catalog.js';
import type { Action } from '../engine.js';

const store = new MemoryGameStore();
const lobby = new LobbyService(store);
const DIST = resolve(process.cwd(), CONFIG.distDir);

// --- tiny response helpers ---------------------------------------------------
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}
function httpStatusFor(err: unknown): number {
  if (err instanceof AuthError) return 401;
  if (err instanceof NotFoundError) return 404;
  if (err instanceof LobbyError) return 409;
  if (err instanceof ConcurrencyError) return 409;
  if (err instanceof SyntaxError) return 400;          // malformed JSON body
  return 500;
}
async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new SyntaxError('request body too large');
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function auth(req: IncomingMessage, url: URL): { playerId: string; token: string } {
  const playerId = (req.headers['x-player-id'] as string) ?? url.searchParams.get('playerId') ?? '';
  const token = (req.headers['x-player-token'] as string) ?? url.searchParams.get('token') ?? '';
  return { playerId, token };
}

// --- API routing -------------------------------------------------------------
// Returns true if the request was an /api route (handled here), false otherwise.
async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'games', ':code', 'action']
  if (parts[0] !== 'api') return false;

  // permissive CORS so players can reach the API directly during local play
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, x-player-id, x-player-token');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }

  try {
    const m = req.method ?? 'GET';

    // GET /api/health
    if (m === 'GET' && parts[1] === 'health' && parts.length === 2) {
      const rooms = await lobby.listRooms();
      return sendJson(res, 200, { ok: true, games: rooms.length, ttlMs: CONFIG.gameTtlMs }), true;
    }

    // GET /api/catalog — static reference data the client caches once
    if (m === 'GET' && parts[1] === 'catalog' && parts.length === 2) {
      res.setHeader('cache-control', 'public, max-age=300');
      return sendJson(res, 200, {
        version: CATALOG_VERSION, cards: CARDS, setup: SETUP,
        config: { minPlayers: CONFIG.minPlayers, maxPlayers: CONFIG.maxPlayers, codeLength: CODE_LENGTH },
      }), true;
    }

    // POST /api/games — host creates a game
    if (m === 'POST' && parts[1] === 'games' && parts.length === 2) {
      const body = await readJson(req);
      const { room, auth: a } = await lobby.createRoom(String(body.name ?? ''));
      return sendJson(res, 201, { code: room.code, room, auth: a }), true;
    }

    // routes under a specific game: /api/games/:code(/...)
    if (parts[1] === 'games' && parts[2]) {
      const code = decodeURIComponent(parts[2]);
      const sub = parts[3];

      if (m === 'GET' && !sub) {
        return sendJson(res, 200, { room: await lobby.getRoom(code) }), true;
      }
      if (m === 'POST' && sub === 'join' && parts.length === 4) {
        const body = await readJson(req);
        const { room, auth: a } = await lobby.joinRoom(code, String(body.name ?? ''));
        return sendJson(res, 200, { room, auth: a }), true;
      }
      if (m === 'POST' && sub === 'start' && parts.length === 4) {
        const { playerId, token } = auth(req, url);
        return sendJson(res, 200, { room: await lobby.startGame(code, playerId, token) }), true;
      }
      if (m === 'GET' && sub === 'state' && parts.length === 4) {
        const { playerId, token } = auth(req, url);
        const view = await lobby.getGameView(code, playerId, token);
        return sendJson(res, 200, { view, room: await lobby.getRoom(code) }), true;
      }
      if (m === 'POST' && sub === 'action' && parts.length === 4) {
        const { playerId, token } = auth(req, url);
        const body = await readJson(req);
        const action = body.action as Action;
        if (!action || typeof action.type !== 'string') return sendJson(res, 400, { error: 'missing action' }), true;
        const view = await lobby.submitAction(code, playerId, token, action);
        return sendJson(res, 200, { view }), true;
      }
    }

    return sendJson(res, 404, { error: 'unknown endpoint' }), true;
  } catch (err) {
    const status = httpStatusFor(err);
    const message = err instanceof Error ? err.message : 'internal error';
    if (status === 500) console.error('[api] 500', err);
    return sendJson(res, status, { error: message }), true;
  }
}

// --- static file serving (SPA) ----------------------------------------------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8',
};
async function tryFile(path: string): Promise<{ body: Buffer; type: string } | null> {
  try {
    const s = await stat(path);
    if (!s.isFile()) return null;
    return { body: await readFile(path), type: MIME[extname(path)] ?? 'application/octet-stream' };
  } catch { return null; }
}
async function handleStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  // resolve safely within DIST (no path traversal)
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidate = rel === '/' || rel === '' ? join(DIST, 'index.html') : join(DIST, rel);
  if (!resolve(candidate).startsWith(DIST)) { res.writeHead(403); res.end('forbidden'); return; }

  const file = await tryFile(candidate);
  if (file) {
    const immutable = candidate.includes(`${join(DIST, 'assets')}`); // hashed bundles
    res.writeHead(200, { 'content-type': file.type, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(file.body);
    return;
  }
  // SPA fallback: serve index.html for client-side routes
  const index = await tryFile(join(DIST, 'index.html'));
  if (index) { res.writeHead(200, { 'content-type': index.type, 'cache-control': 'no-cache' }); res.end(index.body); return; }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`Client not built. Run "npm run build" to generate ${CONFIG.distDir}/, then reload.`);
}

// --- server bootstrap --------------------------------------------------------
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  void (async () => {
    if (await handleApi(req, res, url)) return;
    await handleStatic(req, res, url);
  })().catch((err) => {
    console.error('[server] unhandled', err);
    if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"internal error"}'); }
  });
});

// stale-game sweeper — the local stand-in for DynamoDB TTL
const sweeper = setInterval(() => {
  lobby.sweep().then((reaped) => { if (reaped.length) console.log(`[sweeper] reaped ${reaped.length} stale game(s): ${reaped.join(', ')}`); })
    .catch((e) => console.error('[sweeper]', e));
}, CONFIG.sweepIntervalMs);
sweeper.unref?.();

server.listen(CONFIG.port, CONFIG.host, () => {
  const ttlMin = Math.round(CONFIG.gameTtlMs / 60000 * 10) / 10;
  console.log(`\nTerrestria multiplayer server`);
  console.log(`  inactive-game TTL: ${ttlMin} min   (sweep every ${Math.round(CONFIG.sweepIntervalMs / 1000)}s)`);
  console.log(`  players per game:  ${CONFIG.minPlayers}–${CONFIG.maxPlayers}\n`);
  console.log(`  Reachable at:`);
  console.log(`    http://localhost:${CONFIG.port}`);
  for (const [, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) console.log(`    http://${a.address}:${CONFIG.port}   (share this with other players on your network)`);
  }
  console.log('');
});

export { server, lobby, store };
