import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The bridge (HouseBot API + photo recognition) runs as a separate Node
// process on 8789. Proxying /api and /uploads means the frontend can use
// relative URLs in both `dev` and `preview`, which matters because the
// production build has no VITE_* URL configured at all — it is served BY the
// bridge and resolves the API from window.location at runtime.
//
// The proxy also means no LAN IP has to be hardcoded in .env: a phone on the
// same WiFi hits this dev server, and the proxy forwards to localhost:8789
// on this machine.
const bridgeTarget = process.env.BRIDGE_TARGET || 'http://127.0.0.1:8789';

const proxy = {
  '/api': { target: bridgeTarget, changeOrigin: true },
  '/uploads': { target: bridgeTarget, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy,
  },
  preview: {
    port: 4173,
    host: true,
    proxy,
  },
});