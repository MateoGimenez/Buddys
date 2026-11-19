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
        // '/' lleva a Hoy (encargados) o a Registrar (empleados).
        start_url: '/',
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
  // Celulares viejos del lavadero: Android 8+ con Chrome 80 o más y iPhone con iOS 15+ (Safari 15). Por defecto Vite 8
  // apunta a navegadores de 2023 (Chrome 111, Safari 16.4) y dejaría afuera a los iPhone con iOS 15.
  //  - target: la sintaxis de JS se baja hasta ahí (??=, campos de clase, etc.). Las APIs no se agregan: el código
  //    evita las que no existen ahí (Array.at, structuredClone, randomUUID sin https...).
  //  - cssTarget: lightningcss reescribe lo moderno (inset, propiedades lógicas, anidado) para esos navegadores.
  // No hace falta @vitejs/plugin-legacy: todos estos navegadores cargan módulos ES. Medido: sumaba 57 kB gzip de
  // polyfills y un segundo bundle de 134 kB gzip sin ganar ningún navegador de la lista. Detalle en
  // .impeccable/surfaces/frontend-src.md ("Compatibilidad").
  build: {
    target: ['es2020', 'chrome80', 'safari15', 'firefox78', 'edge88'],
    cssTarget: ['chrome80', 'safari15', 'firefox78', 'edge88'],
  },
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
    // Solo los de unidad: e2e/ es de Playwright (npm run e2e).
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // En los tests no hay service worker: el aviso de versión nueva usa un registro falso.
    alias: { 'virtual:pwa-register/react': fileURLToPath(new URL('./src/test/pwaFalso.ts', import.meta.url)) },
    css: false,
    restoreMocks: true,
    // Los tests de pantallas (jsdom + user-event) con la suite entera en paralelo tardan varios segundos cada uno: con
    // los 5 s por defecto, los formularios largos (caja, multiservicio, registrar, recetas, agenda con seña) cortaban
    // por tiempo según la carga de la máquina. Margen fijo para todos y la mitad de los núcleos (jsdom es pesado:
    // más workers que eso solo se pisan entre ellos). La espera de findBy*/waitFor está en src/test/setup.ts.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    maxWorkers: '50%',
  },
});
