import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeAllContexts, createTestContext } from './helpers.js';

afterEach(closeAllContexts);

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'buddys-panel-'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Buddys · Panel</title>');
  writeFileSync(path.join(dir, 'sw.js'), 'self.addEventListener("install", () => {});');
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1);');
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const API_CSP = "default-src 'none';frame-ancestors 'none'";

describe('el panel servido por el backend (PANEL_DIR)', () => {
  it('/ y las rutas del panel devuelven index.html con la CSP del panel y sin caché', async () => {
    const { app } = await createTestContext({ config: { panelDir: dir } });
    for (const ruta of ['/', '/hoy', '/caja/cierre']) {
      const r = await request(app).get(ruta).set('Accept', 'text/html');
      expect(r.status, ruta).toBe(200);
      expect(r.text, ruta).toContain('Buddys · Panel');
      expect(r.headers['cache-control'], ruta).toBe('no-cache');
      const csp = String(r.headers['content-security-policy']);
      expect(csp, ruta).toContain("script-src 'self'");
      expect(csp, ruta).toContain("frame-ancestors 'none'");
      expect(csp, ruta).not.toContain('unsafe-inline');
    }
  });

  it('los assets con hash son inmutables y el service worker no se cachea', async () => {
    const { app } = await createTestContext({ config: { panelDir: dir } });
    const asset = await request(app).get('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const sw = await request(app).get('/sw.js');
    expect(sw.status).toBe(200);
    expect(sw.headers['cache-control']).toBe('no-cache');
  });

  it('la API no cambia: /api desconocido y archivos inexistentes siguen siendo 404 JSON con la CSP de la API', async () => {
    const { app } = await createTestContext({ config: { panelDir: dir } });
    for (const ruta of ['/api/no-existe', '/no-existe.js', '/api']) {
      const r = await request(app).get(ruta).set('Accept', 'text/html');
      expect(r.status, ruta).toBe(404);
      expect(r.headers['content-type'], ruta).toMatch(/application\/json/);
      expect(r.headers['content-security-policy'], ruta).toBe(API_CSP);
    }
    const health = await request(app).get('/api/health');
    expect(health.headers['content-type']).toMatch(/application\/json/);
  });

  it('un POST fuera de /api no devuelve el panel', async () => {
    const { app } = await createTestContext({ config: { panelDir: dir } });
    const r = await request(app).post('/hoy').set('Accept', 'text/html');
    expect(r.status).not.toBe(200);
  });
});
