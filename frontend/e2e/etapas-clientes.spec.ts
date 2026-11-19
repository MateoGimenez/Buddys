import { expect, test, type Page, type Route } from '@playwright/test';
import type { Etapa } from '../src/api/types';
import { busquedaPatente, enCurso, historialAdmin, insumosConPocoStock, metaActual } from '../src/test/fixtures-mejoras';
import { apiFalsa, ingresar, type ApiFalsa } from './api-falsa';

// Etapas del auto, Hoy y clientes, con la API falsa de siempre (e2e/api-falsa.ts) y encima las rutas nuevas. Las
// rutas que se registran después tienen prioridad en Playwright; lo que no es de acá sigue a la API falsa.

const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });

const WHATSAPP = 'https://wa.me/5493804123456?text=Hola!%20Tu%20auto%20ya%20est%C3%A1%20listo';

/** Las rutas nuevas. Guarda la etapa de cada lavado (la API falsa base no la conoce). */
async function mejoras(page: Page, api: ApiFalsa) {
  const etapas = new Map<string, Etapa>();
  const cambios: Etapa[] = [];
  const sincronizar = () => {
    for (const p of api.pedidos) {
      if (p.metodo !== 'POST' || p.ruta !== '/api/admin/lavados') continue;
      const { idLocal, etapa } = p.cuerpo as { idLocal: string; etapa?: Etapa };
      if (!etapas.has(idLocal)) etapas.set(idLocal, etapa ?? 'entregado');
    }
    for (const l of api.lavados) {
      const etapa = etapas.get(l.id) ?? 'entregado';
      l.etapa = etapa;
      l.whatsappListo = WHATSAPP;
    }
  };
  await page.route('**/api/admin/**', async (route) => {
    sincronizar();
    const req = route.request();
    const url = new URL(req.url());
    const ruta = url.pathname;
    const metodo = req.method();
    if (ruta === '/api/admin/lavados/en-curso') {
      const vivos = api.lavados.filter((l) => l.etapa !== 'entregado');
      const cuenta = (e: Etapa) => vivos.filter((l) => l.etapa === e).length;
      return json(route, 200, { ...enCurso(''), lavados: vivos, resumen: { espera: cuenta('espera'), lavando: cuenta('lavando'), listo: cuenta('listo') } });
    }
    const etapa = /^\/api\/admin\/lavados\/([^/]+)\/etapa$/.exec(ruta);
    if (etapa && metodo === 'PATCH') {
      const id = decodeURIComponent(etapa[1] ?? '');
      const nueva = (req.postDataJSON() as { etapa: Etapa }).etapa;
      etapas.set(id, nueva);
      cambios.push(nueva);
      sincronizar();
      const l = api.lavados.find((x) => x.id === id);
      if (!l) return json(route, 404, { error: { code: 'NOT_FOUND', message: 'No encontramos ese lavado.' } });
      return json(route, 200, { lavado: { ...l, etapaDesde: new Date().toISOString() } });
    }
    if (ruta.endsWith("/fotos")) return json(route, 200, { disponible: false, fotos: [] });
    if (ruta === '/api/admin/push/estado') return json(route, 200, { disponible: false, clavePublica: null });
    if (ruta === '/api/admin/metas/actual') return json(route, 200, metaActual());
    if (ruta === '/api/admin/insumos') return json(route, 200, insumosConPocoStock());
    if (ruta === '/api/admin/bookings') return json(route, 200, busquedaPatente());
    if (ruta === '/api/admin/clientes/historial') return json(route, 200, historialAdmin());
    return route.fallback();
  });
  return { cambios };
}

test('un auto que llega pasa por las etapas desde Hoy hasta Entregado, con WhatsApp cuando está listo', async ({ page }) => {
  const api = await apiFalsa(page);
  const { cambios } = await mejoras(page, api);
  await ingresar(page);
  await page.getByRole('checkbox', { name: /Lavado Básico/ }).check();
  await page.getByRole('radio', { name: 'Recién llega' }).check();
  await page.getByRole('button', { name: 'Anotar auto que llega' }).click();
  await expect(page.getByText('Auto anotado: queda En espera')).toBeVisible();

  await page.getByRole('link', { name: 'Hoy', exact: true }).click();
  const curso = page.getByRole('region', { name: 'En el lavadero ahora' });
  await curso.getByRole('button', { name: 'Empezar a lavar' }).click();
  await curso.getByRole('button', { name: 'Marcar listo' }).click();
  await expect(curso.getByRole('link', { name: 'Avisar por WhatsApp' })).toHaveAttribute('href', WHATSAPP);
  // Deshacer vuelve un paso.
  await curso.getByRole('button', { name: 'Deshacer: volver a Lavando' }).click();
  await curso.getByRole('button', { name: 'Marcar listo' }).click();
  await curso.getByRole('button', { name: 'Entregar' }).click();
  await expect(curso.getByRole('status').filter({ hasText: 'Entregado' })).toBeVisible();
  await expect.poll(() => cambios).toEqual(['lavando', 'listo', 'lavando', 'listo', 'entregado']);

  // En la planilla, el auto entregado ya no muestra los botones de etapa.
  await page.getByRole('link', { name: 'Planilla', exact: true }).click();
  await expect(page.locator('.copia-servicio')).toHaveText('Lavado Básico');
  await expect(page.getByRole('button', { name: 'Empezar a lavar' })).toHaveCount(0);
});

test('busca un cliente por patente y ve su historial y su tarjeta de sellos', async ({ page }) => {
  const api = await apiFalsa(page);
  await mejoras(page, api);
  await ingresar(page);
  await page.goto('/clientes');
  await page.getByLabel('Buscar cliente').fill('ab123cd');
  await page.getByRole('list', { name: 'Clientes encontrados' }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Juan Pérez', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tarjeta de sellos' })).toContainText('Faltan 7');
  await expect(page.getByText('$ 77.000')).toBeVisible();
});

test('en Registrar, la patente de un cliente conocido completa nombre y teléfono', async ({ page }) => {
  const api = await apiFalsa(page);
  await mejoras(page, api);
  await ingresar(page);
  await page.getByText('Más datos').click();
  await page.getByLabel('Patente').fill('AB123CD');
  await expect(page.getByText('Ya vino: Juan Pérez')).toBeVisible();
  await expect(page.getByLabel('Nombre del cliente')).toHaveValue('Juan Pérez');
  await expect(page.getByLabel('Teléfono')).toHaveValue('5493804123456');
});
