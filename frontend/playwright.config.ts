import { defineConfig, devices } from '@playwright/test';

// Pruebas de punta a punta contra el build de producción (vite preview), con la API MOCKEADA desde el navegador
// (page.route, ver e2e/api-falsa.ts): no hace falta el backend ni la base. Correr con `npm run e2e` (arma el build
// primero). Solo Chromium, con el tamaño y el táctil de un celular.
const PUERTO = 4317;

export default defineConfig({
  testDir: './e2e',
  // Workers por defecto (la mitad de los núcleos): cada test tiene su propia API falsa (page.route), no comparten
  // estado. Probado estable en paralelo (8 workers, 2026-11-16); si una máquina chica se queda corta, `--workers=1`.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${String(PUERTO)}`,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/La_Rioja',
    // El service worker de la PWA podría atender pedidos sin pasar por page.route.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'celular', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 760 } } }],
  webServer: {
    // Puerto propio: no choca con `npm run dev` (5173) si está corriendo.
    command: `npx vite preview --port ${String(PUERTO)} --strictPort`,
    url: `http://localhost:${String(PUERTO)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
