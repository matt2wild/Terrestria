// =============================================================================
// server/config.ts — all runtime knobs, read once from the environment with
// sensible local-play defaults. Every value here maps to something you'd set as
// a Lambda env var / SSM parameter once this moves to AWS.
// =============================================================================
const num = (v: string | undefined, dflt: number): number => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : dflt;
};

// Inactivity TTL. A game with no player actions for this long is reaped.
// Set GAME_TTL_MINUTES (preferred) or GAME_TTL_MS. Default: 10 minutes.
// This same value becomes the DynamoDB item TTL attribute after migration.
const ttlMinutes = num(process.env.GAME_TTL_MINUTES, NaN);
const ttlMs = Number.isFinite(ttlMinutes) ? ttlMinutes * 60_000 : num(process.env.GAME_TTL_MS, 10 * 60_000);

export const CONFIG = {
  // 0.0.0.0 so other machines on the LAN can reach us by hostname or IP.
  host: process.env.HOST ?? '0.0.0.0',
  // The single-port server players actually connect to (build + `npm start`).
  // 8787 stays clear of Vite's dev port (5173), which proxies /api here in dev.
  port: num(process.env.PORT, 8787),

  gameTtlMs: ttlMs,
  sweepIntervalMs: num(process.env.SWEEP_INTERVAL_MS, 30_000), // how often we reap stale games

  minPlayers: num(process.env.MIN_PLAYERS, 2),
  maxPlayers: num(process.env.MAX_PLAYERS, 6),

  // Where built client assets live (served as the "HTML visuals" tier).
  distDir: process.env.DIST_DIR ?? 'dist',
} as const;

export type Config = typeof CONFIG;
