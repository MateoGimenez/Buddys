/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En desarrollo, /api va al backend (http://localhost:4000) por este proxy: así el panel y la API comparten origen
// (http://localhost:5173) y las cookies de sesión (HttpOnly, SameSite=Strict) funcionan sin CORS.
// El navegador manda Origin: http://localhost:5173, que tiene que estar en FRONTEND_ORIGIN del backend.
const API = process.env.BUDDYS_API ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
});
