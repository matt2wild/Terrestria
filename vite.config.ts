// =============================================================================
// vite.config.ts — client build + dev server.
//
//  - dev (`npm run dev`): Vite serves the client with HMR on 5173 and PROXIES
//    /api → the Node game server (run it with `npm run server`, default :8787).
//    host:true exposes the dev server on the LAN too.
//  - build (`npm run build`): emits the static client into dist/, which the Node
//    server serves directly in production-like single-port mode (`npm start`).
// =============================================================================
import { defineConfig } from 'vite';

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:8787';

export default defineConfig({
  server: {
    host: true,        // listen on 0.0.0.0 so other machines can reach the dev server
    port: 5173,
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
