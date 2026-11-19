/// <reference types="node" />
import { screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Perfil } from '../api/perfil';
import type { Usuario } from '../api/types';
import { NOMBRE_ROL, hoy, iniciales } from '../lib/format';
import { apiFalsa } from './apiFalsa';
import { BETO_ID, fx, permisosAdmin, planillaAdmin, serviciosAdmin, trabajadores, usuarioAdmin, usuarioEmpleado } from './fixtures';
import { renderApp } from './render';
import { sesionEmpleado } from './sesiones';

// La foto se achica con canvas (jsdom no lo tiene): acá se devuelve un archivo ya listo.
const achicar = vi.hoisted(() => vi.fn());
vi.mock('../lib/achicarFoto', () => ({ achicarFoto: achicar }));

// Contrato 2026-11-16 (reportes/2026-11-16_04_contrato-perfil.md). La subida y los errores salen de las respuestas
// reales del backend (respuestas-api.json); el perfil se arma con la forma de perfilGet sobre los usuarios de los tests.
const FOTO = 'https://storage.test/avatars/ana.webp?token=1';
const FOTO_NUEVA = 'https://storage.test/avatars/ana-2.webp?token=2';
const VENCE = '2026-11-16T15:00:00.000Z';

function perfilDe(u: Usuario, cambio: Partial<Perfil> = {}): Perfil {
  return {
    id: u.id,
    email: u.email,
    nombre: u.nombre,
    rol: u.rol,
    avatarUrl: null,
    avatarVenceEl: null,
    creadoEl: '2026-10-01T12:00:00.000Z',
    ...cambio,
  };
}

function sesion(usuario: Usuario = usuarioAdmin, perfil: Perfil = perfilDe(usuario)) {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario } },
    'GET /api/admin/permisos': { status: 200, body: permisosAdmin() },
    'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
    'GET /api/admin/trabajadores': { status: 200, body: trabajadores() },
    'GET /api/admin/perfil': { status: 200, body: { perfil } },
  };
}

const subida = (fx.avatarSubida?.body as { subida: { url: string } }).subida;
const RUTA_SUBIDA = new URL(subida.url).pathname;
const PUT_SUBIDA = `PUT ${RUTA_SUBIDA}`;

it('el perfil de prueba tiene la forma del real (perfilGet)', () => {
  const real = (fx.perfilGet?.body as { perfil: Perfil }).perfil;
  expect(Object.keys(perfilDe(usuarioAdmin)).sort()).toEqual(Object.keys(real).sort());
});

function botonPerfil() {
  return screen.getByRole('link', { name: 'Tu perfil' });
}

describe('Encabezado: botón Tu perfil', () => {
  it('sin foto muestra el ícono de persona y lleva a Perfil', async () => {
    apiFalsa(sesion());
    const { user } = renderApp('/registrar');
    await screen.findByRole('heading', { name: 'Registrar lavado' });
    const boton = botonPerfil();
    expect(boton.querySelector('img')).toBeNull();
    expect(boton.querySelector('svg')).not.toBeNull();
    await user.click(boton);
    expect(await screen.findByRole('heading', { level: 1, name: 'Tu perfil' })).toBeInTheDocument();
    const cuenta = within(screen.getByRole('region', { name: 'Tu cuenta' }));
    expect(cuenta.getByText(usuarioAdmin.email ?? '')).toBeInTheDocument();
    expect(cuenta.getByText(NOMBRE_ROL.superadmin)).toBeInTheDocument();
  });

  it('con foto muestra la foto en el círculo', async () => {
    apiFalsa(sesion({ ...usuarioAdmin, avatarUrl: FOTO, avatarVenceEl: VENCE }));
    renderApp('/registrar');
    await screen.findByRole('heading', { name: 'Registrar lavado' });
    expect(botonPerfil().querySelector('img')).toHaveAttribute('src', FOTO);
  });
});

describe('Pantalla Perfil', () => {
  it('cambia el nombre (2 a 60) y lo pone al día en el encabezado', async () => {
    const api = apiFalsa({
      ...sesion(),
      'PATCH /api/admin/perfil': (p) => ({ status: 200, body: { perfil: perfilDe(usuarioAdmin, p.body as Partial<Perfil>) } }),
    });
    const { user } = renderApp('/perfil');
    const campo = await screen.findByLabelText('Nombre');
    await user.clear(campo);
    await user.type(campo, 'A');
    await user.click(screen.getByRole('button', { name: 'Guardar nombre' }));
    expect(await screen.findByText('Escribí entre 2 y 60 letras.')).toBeInTheDocument();
    expect(api.de('PATCH', '/api/admin/perfil')).toHaveLength(0);

    await user.type(campo, 'na  María ');
    await user.click(screen.getByRole('button', { name: 'Guardar nombre' }));
    expect(await screen.findByText('Listo, guardamos tu nombre')).toBeInTheDocument();
    expect(api.de('PATCH', '/api/admin/perfil')[0]?.body).toEqual({ nombre: 'Ana María' });
    expect(document.querySelector('.barra-nombre')).toHaveTextContent('Ana María');
  });

  it('sube la foto en tres pasos y reintenta si falla la subida', async () => {
    achicar.mockResolvedValue({ blob: new Blob(['x'.repeat(2000)], { type: 'image/webp' }), tipo: 'image/webp' });
    const api = apiFalsa({
      ...sesion(),
      'POST /api/admin/perfil/avatar': { status: 201, body: { subida } },
      [PUT_SUBIDA]: [{ status: 500 }, { status: 200 }],
      'POST /api/admin/perfil/avatar/confirmar': {
        status: 200,
        body: { perfil: perfilDe(usuarioAdmin, { avatarUrl: FOTO_NUEVA, avatarVenceEl: VENCE }) },
      },
    });
    const { user } = renderApp('/perfil');
    const input = await screen.findByLabelText('Poner foto');
    await user.upload(input, new File(['foto'], 'yo.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByText('No pudimos cambiar la foto')).toBeInTheDocument();
    expect(achicar).toHaveBeenCalledWith(expect.any(File), { ladoMax: 400, bytesMax: 524_288, cuadrado: true });
    expect(api.de('POST', '/api/admin/perfil/avatar')[0]?.body).toEqual({ contentType: 'image/webp', tamano: 2000 });
    expect(api.de('POST', '/api/admin/perfil/avatar/confirmar')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Listo, ya tenés foto nueva.')).toBeInTheDocument();
    // El reintento pidió una URL nueva con la misma foto (no hubo que elegirla otra vez).
    expect(achicar).toHaveBeenCalledTimes(1);
    expect(api.de('PUT', RUTA_SUBIDA)).toHaveLength(2);
    expect(api.de('POST', '/api/admin/perfil/avatar/confirmar')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Tu foto de perfil' })).toHaveAttribute('src', FOTO_NUEVA);
    expect(botonPerfil().querySelector('img')).toHaveAttribute('src', FOTO_NUEVA);
  });

  it('si la confirmación da 409, Reintentar vuelve a pedir la subida', async () => {
    achicar.mockResolvedValue({ blob: new Blob(['abc'], { type: 'image/jpeg' }), tipo: 'image/jpeg' });
    const api = apiFalsa({
      ...sesion(),
      'POST /api/admin/perfil/avatar': { status: 201, body: { subida } },
      [PUT_SUBIDA]: { status: 200 },
      'POST /api/admin/perfil/avatar/confirmar': [
        { status: 409, body: { error: { code: 'CONFLICT', message: 'Todavía no subiste la foto: subila y volvé a confirmar.' } } },
        { status: 200, body: { perfil: perfilDe(usuarioAdmin, { avatarUrl: FOTO_NUEVA, avatarVenceEl: VENCE }) } },
      ],
    });
    const { user } = renderApp('/perfil');
    await user.upload(await screen.findByLabelText('Poner foto'), new File(['f'], 'yo.png', { type: 'image/png' }));
    expect(await screen.findByText('Todavía no subiste la foto: subila y volvé a confirmar.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Listo, ya tenés foto nueva.')).toBeInTheDocument();
    expect(api.de('POST', '/api/admin/perfil/avatar').filter((p) => p.path === '/api/admin/perfil/avatar')).toHaveLength(2);
  });

  it('avisa claro si se cambió muchas veces (429)', async () => {
    achicar.mockResolvedValue({ blob: new Blob(['abc'], { type: 'image/webp' }), tipo: 'image/webp' });
    apiFalsa({
      ...sesion(),
      'POST /api/admin/perfil/avatar': {
        status: 429,
        body: { error: { code: 'RATE_LIMITED', message: 'Cambiaste la foto muchas veces. Esperá unos minutos.' } },
      },
    });
    const { user } = renderApp('/perfil');
    await user.upload(await screen.findByLabelText('Poner foto'), new File(['f'], 'yo.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cambiaste la foto muchas veces. Esperá unos minutos.');
  });

  it('quita la foto con confirmación y vuelven el ícono y las iniciales', async () => {
    const conFoto = { ...usuarioAdmin, avatarUrl: FOTO, avatarVenceEl: VENCE };
    const api = apiFalsa({
      ...sesion(conFoto, perfilDe(usuarioAdmin, { avatarUrl: FOTO, avatarVenceEl: VENCE })),
      'DELETE /api/admin/perfil/avatar': { status: 204 },
    });
    const { user } = renderApp('/perfil');
    await user.click(await screen.findByRole('button', { name: 'Quitar foto' }));
    const dialogo = screen.getByRole('dialog', { name: '¿Quitar tu foto?' });
    await user.click(within(dialogo).getByRole('button', { name: 'Quitar foto' }));
    expect(await screen.findByText('Listo, quitamos tu foto.')).toBeInTheDocument();
    expect(api.de('DELETE', '/api/admin/perfil/avatar')).toHaveLength(1);
    expect(botonPerfil().querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: `Sin foto: ${usuarioAdmin.nombre ?? ''}` })).toHaveTextContent(iniciales(usuarioAdmin.nombre));
    expect(screen.queryByRole('button', { name: 'Quitar foto' })).toBeNull();
  });

  it('con las fotos apagadas en el servidor (503) deja de ofrecer cambiar la foto', async () => {
    achicar.mockResolvedValue({ blob: new Blob(['abc'], { type: 'image/webp' }), tipo: 'image/webp' });
    apiFalsa({
      ...sesion(),
      'POST /api/admin/perfil/avatar': {
        status: 503,
        body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Las fotos de perfil no están configuradas en el servidor.' } },
      },
    });
    const { user } = renderApp('/perfil');
    await user.upload(await screen.findByLabelText('Poner foto'), new File(['f'], 'yo.png', { type: 'image/png' }));
    expect(await screen.findByText(/Las fotos de perfil no están configuradas en el servidor\./)).toBeInTheDocument();
    expect(screen.queryByLabelText('Poner foto')).toBeNull();
  });

  it('si Storage falla un rato (503 sin "configuradas"), deja reintentar', async () => {
    achicar.mockResolvedValue({ blob: new Blob(['abc'], { type: 'image/webp' }), tipo: 'image/webp' });
    apiFalsa({
      ...sesion(),
      'POST /api/admin/perfil/avatar': [
        { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'No pudimos preparar la subida. Probá de nuevo.' } } },
        { status: 201, body: { subida } },
      ],
      [PUT_SUBIDA]: { status: 200 },
      'POST /api/admin/perfil/avatar/confirmar': {
        status: 200,
        body: { perfil: perfilDe(usuarioAdmin, { avatarUrl: FOTO_NUEVA, avatarVenceEl: VENCE }) },
      },
    });
    const { user } = renderApp('/perfil');
    await user.upload(await screen.findByLabelText('Poner foto'), new File(['f'], 'yo.png', { type: 'image/png' }));
    expect(await screen.findByText('No pudimos preparar la subida. Probá de nuevo.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Listo, ya tenés foto nueva.')).toBeInTheDocument();
  });

  it('cambia la contraseña: valida, muestra el error de la actual y confirma', async () => {
    const api = apiFalsa({
      ...sesion(),
      'POST /api/admin/perfil/clave': [
        {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'La contraseña actual no es correcta.',
              fields: { actual: 'La contraseña actual no es correcta.' },
            },
          },
        },
        { status: 204 },
      ],
    });
    const { user } = renderApp('/perfil');
    const actual = await screen.findByLabelText('Contraseña actual');
    const nueva = screen.getByLabelText('Contraseña nueva');
    const repetir = screen.getByLabelText('Repetí la nueva');
    expect(nueva).toHaveAttribute('type', 'password');

    await user.type(actual, 'vieja123');
    await user.type(nueva, 'corta');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText('La nueva tiene que tener 8 caracteres o más.')).toBeInTheDocument();

    await user.clear(nueva);
    await user.type(nueva, 'nueva-larga');
    await user.type(repetir, 'otra-cosa');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText('No coincide con la nueva. Escribila igual.')).toBeInTheDocument();
    expect(api.de('POST', '/api/admin/perfil/clave')).toHaveLength(0);

    // Mostrar: las tres se ven.
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseñas' }));
    expect(nueva).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Mostrar contraseñas' })).toHaveAttribute('aria-pressed', 'true');

    await user.clear(repetir);
    await user.type(repetir, 'nueva-larga');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText('La contraseña actual no es correcta.')).toBeInTheDocument();
    expect(actual).toHaveAttribute('aria-invalid', 'true');

    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText('Listo, cambiaste la contraseña')).toBeInTheDocument();
    expect(api.de('POST', '/api/admin/perfil/clave')[1]?.body).toEqual({ actual: 'vieja123', nueva: 'nueva-larga' });
    expect(actual).toHaveValue('');
  });

  it('el empleado también tiene su perfil', async () => {
    apiFalsa({ ...sesionEmpleado(), 'GET /api/admin/perfil': { status: 200, body: { perfil: perfilDe(usuarioEmpleado) } } });
    renderApp('/perfil');
    expect(await screen.findByRole('heading', { level: 1, name: 'Tu perfil' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Tu cuenta' })).getByText(NOMBRE_ROL.empleado)).toBeInTheDocument();
    const contenido = document.getElementById('contenido');
    if (!contenido) throw new Error('sin contenido');
    expect(within(contenido).getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });
});

describe('Fotos de la gente: avatar o iniciales', () => {
  it('iniciales de un nombre', () => {
    expect(iniciales('Ana López')).toBe('AL');
    expect(iniciales('beto')).toBe('B');
    expect(iniciales('  ñandú  pérez gómez')).toBe('ÑP');
    expect(iniciales('ana@buddys.test')).toBe('A');
    expect(iniciales(null)).toBe('?');
  });

  it('el ranking cruza las fotos por id con /trabajadores y al resto le pone iniciales', async () => {
    const equipo = trabajadores();
    const conFoto = {
      trabajadores: equipo.trabajadores.map((t) => (t.id === BETO_ID ? { ...t, avatarUrl: 'https://storage.test/beto.webp' } : t)),
    };
    apiFalsa({
      ...sesion(),
      'GET /api/admin/trabajadores': { status: 200, body: conFoto },
      'GET /api/admin/lavados': { status: 200, body: planillaAdmin(hoy()) },
    });
    renderApp('/planilla');
    const ranking = (await screen.findByRole('heading', { name: 'Quién lavó más' })).parentElement;
    if (!ranking) throw new Error('sin ranking');
    const [beto, ana] = within(ranking).getAllByRole('listitem');
    await waitFor(() => {
      expect(beto?.querySelector('.avatar img')).toHaveAttribute('src', 'https://storage.test/beto.webp');
    });
    expect(ana?.querySelector('.avatar img')).toBeNull();
    expect(ana?.querySelector('.avatar')).toHaveTextContent('A');
  });

  it('el empleado ve su foto al lado de "Vos" en Registrar', async () => {
    apiFalsa({ ...sesionEmpleado(), 'GET /api/auth/me': { status: 200, body: { usuario: { ...usuarioEmpleado, avatarUrl: 'https://storage.test/beto.webp' } } } });
    renderApp('/registrar');
    const vos = await screen.findByText(/^Vos, /);
    expect(vos.querySelector('.avatar img')).toHaveAttribute('src', 'https://storage.test/beto.webp');
  });
});

describe('Selects legibles en los tres temas', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/formularios.css'), 'utf8');
  const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
  const regla = (selector: string) => {
    // La regla que empieza la línea con ese selector (no ".entrada select" cuando se busca "select").
    const i = css.split('\n').findIndex((linea) => linea === `${selector} {`);
    if (i < 0) return '';
    return css.split('\n').slice(i).join('\n').split('}')[0] ?? '';
  };

  it('la lista desplegada tiene fondo y letra del tema (también lo elegido y lo deshabilitado)', () => {
    const opciones = css.slice(css.indexOf('select option,\nselect optgroup {'));
    expect(opciones).toMatch(/^select option,\nselect optgroup \{[^}]*background-color: var\(--papel\);[^}]*color: var\(--tinta\);/);
    expect(regla('select option:checked')).toMatch(/background-color: var\(--rosa-claro\);[\s\S]*color: var\(--tinta\);/);
    expect(regla('select option:disabled')).toMatch(/background-color: var\(--papel\);[\s\S]*color: var\(--tinta-3\);/);
    expect(regla('.entrada select')).toContain('background-color: var(--papel);');
    expect(regla('select')).toContain('color-scheme: inherit;');
  });

  it('cada tema declara su color-scheme (el sistema dibuja la lista acorde)', () => {
    expect(tokens.match(/color-scheme: dark;/g)).toHaveLength(2);
    expect(tokens.match(/color-scheme: light;/g)).toHaveLength(2);
  });
});
