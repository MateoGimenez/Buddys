import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { alTerminarLaSesion, api } from '../api/client';
import { apiFalsa } from './apiFalsa';
import type { Permisos } from '../api/types';
import { errores, perfilReal, permisosAdmin, usuarioAdmin } from './fixtures';
import { renderApp } from './render';
import { sesionAdmin } from './sesiones';

/*
 * Casos límite de Mi perfil en el panel (contrato reportes/2026-11-17_04_perfil-y-foto.md), revisión de pruebas
 * 2026-11-18: el reintento de la foto (Blob) después del 401 y el foco del menú de la cuenta con el teclado.
 */

const foto = (tipo = 'image/png') => new File([new Uint8Array([1, 2, 3, 4])], 'foto', { type: tipo });
const perfilOk = () => ({ status: 200, body: { perfil: perfilReal('perfilAdmin').perfil } });

describe('cliente: la foto (Blob) después de un 401 SESSION_EXPIRED', () => {
  it('dos subidas que vencen juntas: un solo refresco y cada una reenvía SU archivo con SU Content-Type', async () => {
    const falsa = apiFalsa({
      'PUT /api/admin/perfil/foto': [errores.vencida, errores.vencida, perfilOk()],
      'POST /api/auth/refresh': { status: 200, body: { usuario: usuarioAdmin } },
    });
    const png = foto('image/png');
    const webp = foto('image/webp');
    await Promise.all([
      api('/api/admin/perfil/foto', { method: 'PUT', archivo: png }),
      api('/api/admin/perfil/foto', { method: 'PUT', archivo: webp }),
    ]);
    expect(falsa.de('POST', '/api/auth/refresh')).toHaveLength(1);
    const puts = falsa.de('PUT', '/api/admin/perfil/foto');
    expect(puts).toHaveLength(4);
    expect(puts.filter((p) => p.crudo === png).map((p) => p.headers['Content-Type'])).toEqual(['image/png', 'image/png']);
    expect(puts.filter((p) => p.crudo === webp).map((p) => p.headers['Content-Type'])).toEqual(['image/webp', 'image/webp']);
    // Nunca se le pone JSON a la foto.
    expect(puts.every((p) => p.headers['Content-Type'] !== 'application/json')).toBe(true);
  });

  it('si el refresco falla, no se reenvía la foto y se avisa que terminó la sesión', async () => {
    const falsa = apiFalsa({
      'PUT /api/admin/perfil/foto': errores.vencida,
      'POST /api/auth/refresh': errores.refrescoFallido,
    });
    const fin = vi.fn();
    const quitar = alTerminarLaSesion(fin);
    await expect(api('/api/admin/perfil/foto', { method: 'PUT', archivo: foto() })).rejects.toMatchObject({ status: 401 });
    expect(falsa.de('PUT', '/api/admin/perfil/foto')).toHaveLength(1);
    expect(fin).toHaveBeenCalledTimes(1);
    quitar();
  });
});

describe('menú de la cuenta: el foco con el teclado', () => {
  const botonCuenta = () => screen.findByRole('button', { name: /Ana/ });

  it('Espacio abre y entra; Shift+Tab sale y lo cierra; el foco nunca queda en el body', async () => {
    apiFalsa(sesionAdmin());
    const { user } = renderApp('/registrar');
    const boton = await botonCuenta();
    boton.focus();
    await user.keyboard(' ');
    expect(screen.getByRole('menuitem', { name: 'Mi perfil' })).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).not.toBe(document.body);

    boton.focus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Cerrar sesión' })).toHaveFocus();
    await user.tab();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(boton).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape sobre el botón con el menú abierto lo cierra y el foco sigue en el botón', async () => {
    apiFalsa(sesionAdmin());
    const { user } = renderApp('/registrar');
    const boton = await botonCuenta();
    await user.click(boton);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(boton).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(boton).toHaveFocus();
  });

  it('sin Mi perfil (el rol no edita su perfil), el menú arranca en el tema y las flechas dan la vuelta', async () => {
    const tabla: Permisos = permisosAdmin();
    tabla.capacidades = tabla.capacidades.map<Permisos['capacidades'][number]>((c) =>
      c.id === 'perfil.editar' ? { ...c, roles: { ...c.roles, superadmin: 'no' } } : c,
    );
    apiFalsa({ ...sesionAdmin(), 'GET /api/admin/permisos': { status: 200, body: tabla } });
    const { user } = renderApp('/registrar');
    const boton = await botonCuenta();
    boton.focus();
    await user.keyboard('{ArrowDown}');
    const salir = screen.getByRole('menuitem', { name: 'Cerrar sesión' });
    const automatico = screen.getByRole('menuitemradio', { name: /Automático/ });
    expect(screen.queryByRole('menuitem', { name: 'Mi perfil' })).toBeNull();
    expect(automatico).toHaveFocus();
    await user.keyboard('{End}');
    expect(salir).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(automatico).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(salir).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(boton).toHaveFocus();
  });
});
