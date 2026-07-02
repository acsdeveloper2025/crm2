import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Surface the app version in the UI (login footer) from the one source of truth.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: 5273,
    proxy: {
      '/api': { target: process.env['API_URL'] ?? 'http://localhost:4000', changeOrigin: true },
      // socket.io (ADR-0027): the realtime channel lives at the default `/socket.io` path (the same
      // one the mobile app uses) — proxy its websocket upgrade to the API in dev.
      '/socket.io': {
        target: process.env['API_URL'] ?? 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
