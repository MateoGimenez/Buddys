import { expect, test } from '@playwright/test';
import { apiFalsa, ingresar } from './api-falsa';

// Los servicios del contrato del backend (src/test/fixtures.ts → serviciosAdmin).
const BASICO = /Lavado Básico/;
const ENCERADO = /Encerado/;

test('ingresa con email y contraseña y llega a Registrar', async ({ page }) => {
  await apiFalsa(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
  await ingresar(page);
  await expect(page.getByRole('navigation', { name: 'Secciones principales' })).toBeVisible();
});

test('registra un lavado con varios servicios y aparece en la planilla y en la caja', async ({ page }) => {
  const api = await apiFalsa(page);
  await ingresar(page);
  await page.getByRole('checkbox', { name: BASICO }).check();
  await page.getByRole('checkbox', { name: ENCERADO }).check();
  await expect(page.getByText('2 servicios')).toBeVisible();
  await page.getByLabel('Cuánto se cobró').fill('20000');
  await page.getByRole('radio', { name: 'Efectivo' }).check();
  await page.getByRole('button', { name: 'Registrar lavado' }).click();
  await expect(page.getByText('Lavado registrado')).toBeVisible();
  await expect(page.locator('.talon')).toContainText('Lavado Básico + Encerado');
  expect(api.pedidos.find((p) => p.metodo === 'POST' && p.ruta === '/api/admin/lavados')?.cuerpo).toMatchObject({
    servicioIds: ['lavado-basico', 'encerado'],
    monto: 20000,
    formaPago: 'efectivo',
  });

  await page.getByRole('link', { name: 'Planilla', exact: true }).click();
  const caja = page.getByRole('region', { name: 'Caja del día' });
  await expect(caja.getByRole('row', { name: /Efectivo/ })).toContainText('$ 20.000');
  await expect(page.locator('.copia-servicio')).toHaveText('Lavado Básico + Encerado');
});

test('sin conexión queda por enviar y sale solo al volver la señal', async ({ page, context }) => {
  const api = await apiFalsa(page);
  await ingresar(page);
  await context.setOffline(true);
  await expect(page.getByText('Sin conexión')).toBeVisible();
  await page.getByRole('checkbox', { name: BASICO }).check();
  await page.getByLabel('Cuánto se cobró').fill('15000');
  await page.getByRole('button', { name: 'Registrar lavado' }).click();
  await expect(page.getByText('Guardado sin conexión')).toBeVisible();
  await expect(page.getByText('1 lavado por enviar')).toBeVisible();
  expect(api.lavados).toHaveLength(0);

  await context.setOffline(false);
  await expect(page.getByText('1 lavado por enviar')).toBeHidden();
  expect(api.lavados).toHaveLength(1);
  await page.getByRole('link', { name: 'Planilla', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Caja del día' })).toContainText('$ 15.000');
});

test('el empleado registra y no ve ningún monto', async ({ page }) => {
  await apiFalsa(page);
  await ingresar(page, 'beto@buddys.test');
  await page.getByRole('checkbox', { name: BASICO }).check();
  await expect(page.getByRole('main')).not.toContainText('$ 1');
  await page.getByRole('button', { name: 'Registrar lavado' }).click();
  await expect(page.getByText('Lavado registrado')).toBeVisible();
  await page.getByRole('link', { name: 'Planilla', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Cómo pagaron' })).toBeVisible();
  await expect(page.locator('.copia-servicio')).toHaveText('Lavado Básico');
  await expect(page.getByRole('main')).not.toContainText('$');
});

test('deshacer borra el lavado recién registrado', async ({ page }) => {
  const api = await apiFalsa(page);
  await ingresar(page);
  await page.getByRole('checkbox', { name: BASICO }).check();
  await page.getByRole('button', { name: 'Registrar lavado' }).click();
  await expect(page.getByText('Lavado registrado')).toBeVisible();
  expect(api.lavados).toHaveLength(1);
  await page.getByRole('button', { name: /Deshacer/ }).click();
  await expect(page.getByText('Lavado borrado')).toBeVisible();
  expect(api.lavados).toHaveLength(0);
  await page.getByRole('link', { name: 'Planilla', exact: true }).click();
  await expect(page.getByText('Todavía no hay lavados hoy')).toBeVisible();
});
