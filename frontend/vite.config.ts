/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// En desarrollo, /api va al backend (http://localhost:4000) por este proxy: así el panel y la API comparten origen
// (http://localhost:5173) y las cookies de sesión (HttpOnly, SameSite=Strict) funcionan sin CORS.
// El navegador manda Origin: http://localhost:5173, que tiene que estar en FRONTEND_ORIGIN del backend.
const API = process.env.BUDDYS_API ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [
    react(),
    // PWA instalable. El service worker solo guarda el "cascarón" del panel (HTML, JS, CSS, fuentes e íconos) para que
    // abra sin señal. NUNCA guarda /api/*: son datos de la sesión (cookies) y tienen que venir siempre del servidor.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['logo.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Buddys Wash Detail',
        short_name: 'Buddys',
        description: 'Panel del lavadero: registrar lavados, planilla del día y números.',
        lang: 'es-AR',
        dir: 'ltr',
        start_url: '/registrar',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#17204d',
        background_color: '#eceef5',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // Los cortes latin-ext y vietnamese de Archivo solo se bajan si una página usa esos caracteres (unicode-range):
        // el panel está en español, así que no se guardan por adelantado.
        globIgnores: ['**/*-latin-ext-*.woff2', '**/*-vietnamese-*.woff2'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api(\/|$)/],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        // Avisos push (turnos nuevos y stock bajo): public/push-sw.js agrega los manejadores de `push` y
        // `notificationclick` al service worker generado. Lo precachea el mismo globPatterns (es un .js de dist/).
        importScripts: ['push-sw.js'],
      },
    }),
  ],
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
    // En los tests no hay service worker: el aviso de versión nueva usa un registro falso.
    alias: { 'virtual:pwa-register/react': fileURLToPath(new URL('./src/test/pwaFalso.ts', import.meta.url)) },
    css: false,
    restoreMocks: true,
  },
});
