// =============================================================================
// client/api.ts — thin typed wrapper over the /api JSON endpoints. The client
// is otherwise dumb: the server is authoritative for every rule.
// =============================================================================
import type { NetView, Action, CardDef } from '../engine.js';
import type { PublicRoom, Auth } from '../server/lobby.js';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface CatalogPayload {
  version: number;
  cards: CardDef[];
  setup: unknown;
  config: { minPlayers: number; maxPlayers: number; codeLength: number };
}

const BASE = '/api';

async function call<T>(path: string, opts: RequestInit & { auth?: Auth } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (opts.body) headers['content-type'] = 'application/json';
  if (opts.auth) { headers['x-player-id'] = opts.auth.playerId; headers['x-player-token'] = opts.auth.token; }
  const res = await fetch(BASE + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as any).error || res.statusText);
  return data as T;
}

export const getCatalog = () => call<CatalogPayload>('/catalog');

export const createGame = (name: string) =>
  call<{ code: string; room: PublicRoom; auth: Auth }>('/games', { method: 'POST', body: JSON.stringify({ name }) });

export const joinGame = (code: string, name: string) =>
  call<{ room: PublicRoom; auth: Auth }>(`/games/${encodeURIComponent(code)}/join`, { method: 'POST', body: JSON.stringify({ name }) });

export const getRoom = (code: string) =>
  call<{ room: PublicRoom }>(`/games/${encodeURIComponent(code)}`);

export const startGame = (code: string, auth: Auth) =>
  call<{ room: PublicRoom }>(`/games/${encodeURIComponent(code)}/start`, { method: 'POST', auth });

export const getState = (code: string, auth: Auth) =>
  call<{ view: NetView; room: PublicRoom }>(`/games/${encodeURIComponent(code)}/state`, { auth });

export const sendAction = (code: string, auth: Auth, action: Action) =>
  call<{ view: NetView }>(`/games/${encodeURIComponent(code)}/action`, { method: 'POST', auth, body: JSON.stringify({ action }) });
