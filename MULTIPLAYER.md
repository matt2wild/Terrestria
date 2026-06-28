# Terrestria — Multiplayer

Multiple players connect to one locally-hosted server (by **hostname/IP + port**),
one player **hosts** a game and gets a **6-character code**, and everyone else
**joins with that code**. Idle games are reaped automatically after a
configurable inactivity window (default **10 minutes**).

The whole thing is intentionally shaped so it can later move to **DynamoDB
(game state)** + **Lambda (engine execution)** behind an **API Gateway pipeline**
serving the HTML visuals — see [Cloud migration plan](#cloud-migration-plan).

---

## Quick start

```bash
npm install
npm start          # builds the client, then serves API + client on one port (default 8787)
```

You'll see something like:

```
Terrestria multiplayer server
  inactive-game TTL: 10 min   (sweep every 30s)
  players per game:  2–6

  Reachable at:
    http://localhost:8787
    http://192.168.1.42:8787   (share this with other players on your network)
```

- **Host:** open the site, type a colony name, click **Host a new game**. Read out
  the 6-character code (or share the invite link with **Copy invite link**).
- **Everyone else:** open the same URL (the `http://192.168.x.x:PORT` one on the
  same network), type a name, enter the code, click **Join**.
- The host clicks **Start game** once at least 2 players are in. Each browser then
  shows only that player's own hand; the server is authoritative for every rule.

### Dev mode (hot reload)

Two processes: the Node API server and the Vite dev server (which proxies `/api`).

```bash
npm run server      # API on :8787  (use `npm run server:watch` to auto-restart)
npm run dev         # Vite client on :5173 with HMR, proxying /api -> :8787
```

Open `http://localhost:5173` (or the LAN address Vite prints).

---

## Configuration

All knobs are environment variables (`server/config.ts`). Each maps to something
you'd set as a Lambda env var / SSM parameter after migration.

| Variable             | Default     | Meaning |
|----------------------|-------------|---------|
| `PORT`               | `8787`      | Single-port server (API + client). |
| `HOST`               | `0.0.0.0`   | Bind address. `0.0.0.0` exposes it on the LAN. |
| `GAME_TTL_MINUTES`   | `10`        | Inactivity window before a game is reaped. |
| `GAME_TTL_MS`        | `600000`    | Same, in ms (used if `GAME_TTL_MINUTES` is unset). |
| `SWEEP_INTERVAL_MS`  | `30000`     | How often the reaper runs. |
| `MIN_PLAYERS`        | `2`         | Minimum players to start. |
| `MAX_PLAYERS`        | `6`         | Lobby capacity. |
| `DIST_DIR`           | `dist`      | Built client directory to serve. |

Example: a snappy 2-minute TTL on port 9000:

```bash
PORT=9000 GAME_TTL_MINUTES=2 npm start
```

**What counts as "activity"?** Creating, joining, starting, or taking a game
action refreshes the timer. Passive state polls do **not** — so an abandoned
browser tab still lets the game expire. This is exactly DynamoDB TTL semantics:
each write bumps an `expiresAt` attribute; expiry deletes the item.

---

## Architecture

```
 Browser (client/)                Node server (server/)                 Engine (engine/)
 ─────────────────                ─────────────────────                 ────────────────
  landing / lobby / game   HTTP    index.ts   ── routes ──>  lobby.ts ── reduce()/views ──> pure
  - fetch /api/catalog  <──JSON──>  (the "edge")             (lobby rules)                    rules
  - poll  /api/.../state                  │                       │
  - POST  /api/.../action                 ├── store.ts  (GameStore: in-memory now)
                                          └── engineHandler.ts  (engine execution boundary)
```

### Layers (and why they're split this way)

| File                     | Responsibility | Becomes, in AWS… |
|--------------------------|----------------|------------------|
| `client/`                | Renders the per-player view; turns clicks into Actions. Talks only to `/api`. | Static assets on **S3 + CloudFront**. |
| `server/index.ts`        | HTTP edge: `/api/*` routing + static file serving + the stale-game sweeper. | **API Gateway** routes + **S3/CloudFront**; sweeper → DynamoDB TTL. |
| `server/lobby.ts`        | Lobby rules (codes, join, host-only start) via read-modify-write with optimistic-lock retry. | The **Lambda** application layer. |
| `server/engineHandler.ts`| Pure engine execution: `newGame` / `applyAction` / `viewForPlayer`. No I/O. | A **Lambda** (or the engine bundled into the lobby Lambda). |
| `server/store.ts`        | `GameStore` interface + `MemoryGameStore`. Conditional writes on a `version`; `expiresAt` TTL attribute. | A `DynamoGameStore` (single table, PK = `code`). |
| `engine/`                | The game rules. Pure, serializable `GameState`; no environment dependencies. | Unchanged — runs in Lambda as-is. |
| `engine/netview.ts`      | Per-player, hidden-info-filtered, render-ready projection. | Unchanged. |

### Why polling, not WebSockets

Clients poll `GET /api/games/:code/state` (~1 s) and re-render only when the
engine `version` changes. Each poll is a **stateless GET** — a clean fit for
API Gateway + Lambda + DynamoDB, with no connection state to manage. (If push is
wanted later, API Gateway WebSockets can layer on without touching the engine or
the store.)

### Authority & secrets

- The **engine is authoritative**. The client computes eligibility (`playable`,
  `canAttack`, `canBuy`) only to grey out buttons; `reduce()` re-validates every
  action and silently rejects illegal ones (the `version` simply doesn't advance).
- Each player holds an opaque **token**; actions are authorized by
  `(playerId, token)`. Tokens are never sent to other players.
- Hidden information (opponents' hands, blind stacks) is filtered out **server
  side** in `netViewFor` — it never reaches a rival's browser.

---

## HTTP API

| Method & path                         | Auth | Purpose |
|---------------------------------------|------|---------|
| `GET  /api/health`                    | –    | Liveness + active game count. |
| `GET  /api/catalog`                   | –    | Static card catalog + setup + limits (client caches once). |
| `POST /api/games`                     | –    | Host creates a game → `{ code, auth }`. |
| `POST /api/games/:code/join`          | –    | Join a lobby → `{ auth }`. |
| `POST /api/games/:code/start`         | host | Start the game (needs ≥ `MIN_PLAYERS`). |
| `GET  /api/games/:code`               | –    | Public room (players, phase, `canStart`). |
| `GET  /api/games/:code/state`         | yes  | This player's filtered game view. |
| `POST /api/games/:code/action`        | yes  | Submit one engine `Action`. |

Auth is sent as headers `x-player-id` / `x-player-token` (the `state` endpoint
also accepts `?playerId=&token=`).

---

## Cloud migration plan

The seams are already in place; migration is mostly writing one new class and
wiring infrastructure:

1. **State → DynamoDB.** Implement `DynamoGameStore implements GameStore`
   (`server/store.ts`). One table, partition key `code`, a numeric `version`
   attribute for `ConditionExpression`-based optimistic writes (already how
   `MemoryGameStore` behaves), and `expiresAt` enabled as the **TTL attribute**
   — DynamoDB then reaps stale games for free, retiring the local sweeper.
2. **Engine → Lambda.** `server/engineHandler.ts` is already pure data-in/data-out.
   Deploy it (and `engine/` + `catalog.ts`) as a Lambda; `lobby.ts` calls it via
   `Invoke` instead of a function call, or simply bundles it in the same Lambda.
3. **API → API Gateway.** Each route in `server/index.ts` maps 1:1 to an API
   Gateway route backed by the lobby Lambda. The request/response shapes don't
   change.
4. **Visuals → S3 + CloudFront.** `npm run build` already emits a static client
   to `dist/` that talks only to `/api`. Host it on S3/CloudFront; point `/api/*`
   at API Gateway.

Nothing in `engine/` or `client/` needs to change for any of these steps.
