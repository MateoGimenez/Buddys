import { expect, test, type Page, type Route } from '@playwright/test';
import type { Cierre } from '../src/api/finanzas';
import { fx } from '../src/test/fixtures';
import { cajaAbierta, cierreDe, permisosMejoras } from '../src/test/fixtures-finanzas';
import { apiFalsa } from './api-falsa';

// Caja con arqueo y exportar a CSV, con la API falsa de siempre (e2e/api-falsa.ts) y encima las rutas de las mejoras.
// Las rutas que se registran después tienen prioridad en Playwright; lo que no es de acá sigue a la API falsa.

const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });

async function mejoras(page: Page, rol: 'superadmin' | 'empleado') {
  const estado = { cierre: null as Cierre | null, puts: [] as unknown[], exportados: [] as string[] };
  await page.route('**/api/admin/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const ruta = url.pathname;
    const metodo = req.method();
    if (ruta === '/api/admin/permisos') return json(route, 200, permisosMejoras(rol));
    if (rol === 'empleado' && (ruta.startsWith('/api/admin/caja') || ruta.startsWith('/api/admin/exportar'))) {
      return json(route, 403, fx.error403CajaEmpleado?.body);
    }
    if (ruta === '/api/admin/caja' && metodo === 'GET') {
      const fecha = url.searchParams.get('fecha') ?? '';
      const abierta = cajaAbierta(fecha);
      return json(route, 200, { ...abierta, cierre: estado.cierre?.fecha === fecha ? estado.cierre : null });
    }
    if (ruta === '/api/admin/caja/cierres') return json(route, 200, { cierres: estado.cierre ? [estado.cierre] : [], total: estado.cierre ? 1 : 0 });
    const put = /^\/api\/admin\/caja\/(\d{4}-\d{2}-\d{2})$/.exec(ruta);
    if (put && metodo === 'PUT') {
      const cuerpo = req.postDataJSON() as { contado: { efectivo: number } };
      estado.puts.push(cuerpo);
      const base = cierreDe(put[1] ?? '');
      const efectivo = base.formas[0];
      const dif = cuerpo.contado.efectivo - (efectivo?.esperado ?? 0);
      estado.cierre = {
        ...base,
        formas: base.formas.map((f, i) => (i === 0 ? { ...f, contado: cuerpo.contado.efectivo, diferencia: dif } : { ...f, contado: null, diferencia: null })),
        contadoTotal: cuerpo.contado.efectivo,
        diferencia: dif,
        nota: null,
      };
      return json(route, 201, { cierre: estado.cierre });
    }
    if (ruta === '/api/admin/estadisticas') return json(route, 200, fx.estadisticasConFijos?.body);
    if (ruta === '/api/admin/estadisticas/mias') return json(route, 200, fx.misTrabajos?.body);
    if (ruta === '/api/admin/metas/actual') return json(route, 200, fx.metasActual?.body);
    if (ruta.startsWith('/api/admin/exportar/')) {
      estado.exportados.push(ruta + url.search);
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="planilla.csv"' },
        body: '﻿Fecha;Servicio;Monto\r\n16/10/2026;Lavado Básico;12000\r\n',
      });
    }
    return route.fallback();
  });
  return estado;
}

/** Entra con la pantalla de ingreso (sin depender de cuál sea la pantalla de inicio). */
async function ingresar(page: Page, email = 'ana@buddys.test') {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('una-clave-cualquiera');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.getByRole('navigation', { name: 'Secciones principales' }).waitFor();
}

async function irAMas(page: Page, seccion: string) {
  await page.getByRole('link', { name: 'Más', exact: true }).click();
  await page.getByRole('link', { name: new RegExp(seccion) }).click();
}

test('el dueño cuenta la caja, ve la diferencia y la cierra', async ({ page }) => {
  await apiFalsa(page);
  const estado = await mejoras(page, 'superadmin');
  await ingresar(page);
  await irAMas(page, 'Caja');
  await expect(page.getByRole('heading', { name: 'Cierre de caja' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tendría que haber' })).toContainText('$ 181.000');

  await page.getByLabel('Efectivo (en la caja)').fill('92500');
  await expect(page.locator('.diferencia')).toHaveText('Faltan $ 500');
  await page.getByLabel('Efectivo (en la caja)').fill('93000');
  await expect(page.locator('.diferencia')).toHaveText('Cierra justo');
  // Sin scroll horizontal a 360 px.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  await page.getByRole('button', { name: 'Cerrar la caja' }).click();
  await expect(page.getByRole('heading', { name: 'Caja cerrada' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reabrir' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Cierres anteriores' })).toContainText('Cierra justo');
  expect(estado.puts).toEqual([{ contado: { efectivo: 93000 } }]);
});

test('baja la planilla del período en CSV desde Números', async ({ page }) => {
  await apiFalsa(page);
  const estado = await mejoras(page, 'superadmin');
  await ingresar(page);
  await page.getByRole('link', { name: 'Números', exact: true }).click();
  const boton = page.getByRole('button', { name: 'Descargar la planilla en Excel (CSV)' });
  await boton.scrollIntoViewIfNeeded();
  const [descarga] = await Promise.all([page.waitForEvent('download'), boton.click()]);
  expect(descarga.suggestedFilename()).toMatch(/^buddys-planilla-\d{4}-\d{2}-01-a-\d{4}-\d{2}-\d{2}\.csv$/);
  await expect(page.getByText(/quedó en Descargas/)).toBeVisible();
  expect(estado.exportados[0]).toMatch(/^\/api\/admin\/exportar\/planilla\.csv\?desde=\d{4}-\d{2}-01&hasta=/);
});

test('el empleado no ve la caja ni puede exportar', async ({ page }) => {
  await apiFalsa(page);
  const estado = await mejoras(page, 'empleado');
  await ingresar(page, 'beto@buddys.test');
  await page.getByRole('link', { name: 'Más', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Otras secciones' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Caja/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Números', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tus lavados' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Excel/ })).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText('$');
  expect(estado.exportados).toEqual([]);
});
