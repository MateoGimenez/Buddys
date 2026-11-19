import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { STORAGE, apiFalsa, ingresar } from './api-falsa';

// Una foto real (PNG de 6 x 4): el panel la recorta al cuadrado y la achica con canvas antes de subirla.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAIAAAAiZtkUAAAAOUlEQVR4nAXBQQEAMAwCMeRUzinhXREVsTdKkLVEokOhSx8tlcgQyJJHSiRuOLjlHldOwoPBix8u/sbMH2nhpiy1AAAAAElFTkSuQmCC',
  'base64',
);

type Tema = 'claro' | 'oscuro' | 'contraste';
const TEMAS: Tema[] = ['claro', 'oscuro', 'contraste'];

async function ponerTema(page: Page, tema: Tema) {
  await page.evaluate((t) => {
    localStorage.setItem('buddys.tema.v1', t);
    document.documentElement.setAttribute('data-tema', t);
  }, tema);
}

/** Capturas para mirar a ojo: solo si se pide con CAPTURAS=<carpeta>. */
async function capturar(page: Page, nombre: string) {
  const carpeta = process.env.CAPTURAS;
  if (!carpeta) return;
  mkdirSync(carpeta, { recursive: true });
  await page.screenshot({ path: join(carpeta, `${nombre}.png`), fullPage: true });
}

/** Ni scroll de costado ni nada que se salga de la pantalla. */
async function sinDesborde(page: Page) {
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sobra).toBeLessThanOrEqual(0);
}

test('perfil: desde el encabezado cambia nombre, foto (con reintento) y contraseña', async ({ page }) => {
  const api = await apiFalsa(page);
  await ingresar(page);

  const boton = page.getByRole('link', { name: 'Tu perfil' });
  await expect(boton).toBeVisible();
  const caja = await boton.boundingBox();
  expect(caja?.width).toBeGreaterThanOrEqual(44);
  expect(caja?.height).toBeGreaterThanOrEqual(44);
  // Sin foto: el ícono de persona.
  await expect(boton.locator('svg')).toBeVisible();
  await boton.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tu perfil' })).toBeVisible();
  await sinDesborde(page);

  // Nombre.
  await page.getByLabel('Nombre', { exact: true }).fill('Ana María');
  await page.getByRole('button', { name: 'Guardar nombre' }).click();
  await expect(page.getByText('Listo, guardamos tu nombre')).toBeVisible();
  expect(api.perfil.nombre).toBe('Ana María');

  // Foto: la primera subida a Storage falla; Reintentar la termina sin volver a elegirla.
  api.fallasDeSubida = 1;
  await page.getByLabel('Poner foto').setInputFiles({ name: 'yo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('No pudimos cambiar la foto')).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByText('Listo, ya tenés foto nueva.')).toBeVisible();
  const pedida = api.pedidos.filter((p) => p.metodo === 'POST' && p.ruta === '/api/admin/perfil/avatar');
  expect(pedida.length).toBe(2);
  const { contentType, tamano } = pedida[0]?.cuerpo as { contentType: string; tamano: number };
  expect(['image/webp', 'image/jpeg']).toContain(contentType);
  expect(tamano).toBeGreaterThan(0);
  expect(tamano).toBeLessThanOrEqual(524_288);
  await expect(page.getByRole('img', { name: 'Tu foto de perfil' })).toHaveAttribute('src', new RegExp(`^${STORAGE}/avatars/`));
  await expect(boton.locator('img')).toHaveAttribute('src', new RegExp(`^${STORAGE}/avatars/`));

  // Contraseña.
  await page.getByLabel('Contraseña actual').fill('mal');
  await page.getByLabel('Contraseña nueva').fill('clave-nueva-1');
  await page.getByLabel('Repetí la nueva').fill('clave-nueva-1');
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(page.getByText('La contraseña actual no es correcta.')).toBeVisible();
  await page.getByLabel('Contraseña actual').fill('una-clave-cualquiera');
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(page.getByText('Listo, cambiaste la contraseña')).toBeVisible();
  expect(api.perfil.clave).toBe('clave-nueva-1');

  // Quitar la foto.
  await page.getByRole('button', { name: 'Quitar foto' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Quitar foto' }).click();
  await expect(page.getByText('Listo, quitamos tu foto.')).toBeVisible();
  await expect(boton.locator('img')).toHaveCount(0);
});

test('el empleado ve su foto en el encabezado y al lado de "Vos"', async ({ page }) => {
  const api = await apiFalsa(page);
  api.perfil.avatarUrl = `${STORAGE}/avatars/beto.svg`;
  await ingresar(page, 'beto@buddys.test');
  await expect(page.getByRole('link', { name: 'Tu perfil' }).locator('img')).toBeVisible();
  await expect(page.locator('.dato-fijo-quien img')).toBeVisible();
});

for (const ancho of [360, 412]) {
  test(`perfil y encabezado a ${String(ancho)} px en los tres temas`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 820 });
    const api = await apiFalsa(page);
    api.perfil.avatarUrl = `${STORAGE}/avatars/ana.svg`;
    await ingresar(page);
    for (const tema of TEMAS) {
      await ponerTema(page, tema);
      await page.getByRole('link', { name: 'Tu perfil' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Tu perfil' })).toBeVisible();
      await expect(page.getByRole('img', { name: 'Tu foto de perfil' })).toBeVisible();
      await sinDesborde(page);
      await capturar(page, `perfil-${String(ancho)}-${tema}`);
      await page.getByRole('link', { name: 'Registrar', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Registrar lavado' })).toBeVisible();
      await sinDesborde(page);
      await capturar(page, `registrar-${String(ancho)}-${tema}`);
    }
  });
}

test('los select se leen en tema oscuro (lista desplegada con fondo y letra del tema)', async ({ page }) => {
  await apiFalsa(page);
  await ingresar(page);
  for (const tema of TEMAS) {
    await ponerTema(page, tema);
    const select = page.getByLabel('Quién lo lavó');
    await expect(select).toBeVisible();
    const colores = await select.evaluate((el) => {
      const raiz = getComputedStyle(document.documentElement);
      const op = el.querySelector('option:not(:checked)') ?? el.querySelector('option');
      const elegida = el.querySelector('option:checked');
      if (!op || !elegida) throw new Error('sin opciones');
      const s = getComputedStyle(el);
      const o = getComputedStyle(op);
      const e = getComputedStyle(elegida);
      // El color de un token, como lo resuelve el navegador.
      const token = (n: string) => {
        const p = document.createElement('span');
        p.style.color = raiz.getPropertyValue(n);
        document.body.append(p);
        const c = getComputedStyle(p).color;
        p.remove();
        return c;
      };
      return {
        esquema: s.colorScheme,
        selectFondo: s.backgroundColor,
        opcionFondo: o.backgroundColor,
        opcionLetra: o.color,
        elegidaFondo: e.backgroundColor,
        papel: token('--papel'),
        tinta: token('--tinta'),
        rosaClaro: token('--rosa-claro'),
      };
    });
    expect(colores.esquema).toBe(tema === 'oscuro' ? 'dark' : 'light');
    expect(colores.selectFondo).toBe(colores.papel);
    expect(colores.opcionFondo).toBe(colores.papel);
    expect(colores.opcionLetra).toBe(colores.tinta);
    expect(colores.elegidaFondo).toBe(colores.rosaClaro);

    // La lista desplegada nativa no sale en las capturas: se muestra abierta como lista (size) con los mismos estilos.
    await select.evaluate((el) => {
      (el as HTMLSelectElement).size = 4;
    });
    await select.scrollIntoViewIfNeeded();
    const carpeta = process.env.CAPTURAS;
    if (carpeta) {
      mkdirSync(carpeta, { recursive: true });
      await page.locator('.entrada-select').filter({ has: select }).screenshot({ path: join(carpeta, `select-${tema}.png`) });
    }
    await select.evaluate((el) => {
      (el as HTMLSelectElement).size = 0;
    });
  }
});
