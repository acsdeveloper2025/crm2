import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
