import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Perfil, Permisos } from '../api/types';
import { apiFalsa, type Pedido } from './apiFalsa';
import { type RespuestaFalsa, VERSION_FOTO_REAL, errores, perfilReal, permisosAdmin, real, usuarioAdmin } from './fixtures';
import { sesionAdmin, sesionEmpleado } from './sesiones';
import { renderApp } from './render';

// Respuestas REALES del backend (respuestas-reales.json, contrato reportes/2026-11-17_04_perfil-y-foto.md).
const VERSION = VERSION_FOTO_REAL;
const getPerfil = (fotosDisponibles = true, cambios: Partial<Perfil> = {}) => {
  const base = perfilReal(fotosDisponibles ? 'perfilAdmin' : 'perfilSinFotos');
  return { status: 200, body: { ...base, perfil: { ...base.perfil, ...cambios } } };
};
/** Una respuesta real tal cual (copia: cada test puede tocarla). */
function deVerdad(clave: string): RespuestaFalsa {
  const respuesta = real[clave];
  if (!respuesta) throw new Error(`Falta la respuesta real ${clave}`);
  return structuredClone(respuesta);
}

function sesionConPerfil(extra: Record<string, unknown> = {}, fotosDisponibles = true) {
  return { ...sesionAdmin(), 'GET /api/admin/perfil': getPerfil(fotosDisponibles), ...extra };
}

const botonCuenta = () => screen.findByRole('button', { name: /Ana/ });

function png(bytes: number, tipo = 'image/png', nombre = 'foto.png'): File {
  return new File([new Uint8Array(bytes)], nombre, { type: tipo });
}

describe('header: menú de la cuenta', () => {
  it('muestra avatar, nombre y rol; abre con teclado, se mueve con flechas y Escape vuelve al botón', async () => {
    apiFalsa(sesionAdmin());
    const { user } = renderApp('/registrar');
    const boton = await botonCuenta();
    expect(boton).toHaveAttribute('aria-haspopup', 'menu');
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    expect(boton).toHaveTextContent('Ana');
    expect(boton).toHaveTextContent('Dueño (superadmin)');
    expect(boton.querySelector('.avatar')).not.toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();

    boton.focus();
    await user.keyboard('{Enter}');
    const menu = screen.getByRole('menu', { name: /Ana/ });
    expect(boton).toHaveAttribute('aria-expanded', 'true');
    const perfil = within(menu).getByRole('menuitem', { name: 'Mi perfil' });
    const salir = within(menu).getByRole('menuitem', { name: 'Cerrar sesión' });
    expect(perfil).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(salir).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(perfil).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(salir).toHaveFocus();
    await user.keyboard('{Home}');
    expect(perfil).toHaveFocus();
    await user.keyboard('{End}');
    expect(salir).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(boton).toHaveFocus();
    expect(boton).toHaveAttribute('aria-expanded', 'false');

    // Flecha abajo sobre el botón también abre y entra.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Mi perfil' })).toHaveFocus();
    // Tab sale del menú y lo cierra (no atrapa el foco).
    await user.tab();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('con el dedo abre sin mover el foco, y un toque afuera lo cierra', async () => {
    apiFalsa(sesionAdmin());
    const { user } = renderApp('/registrar');
    const boton = await botonCuenta();
    await user.click(boton);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Mi perfil' })).not.toHaveFocus();
    await user.click(screen.getByRole('heading', { name: 'Registrar lavado' }));
    expect(screen.queryByRole('menu')).toBeNull();
    // Tocar el botón con el menú abierto también lo cierra.
    await user.click(boton);
    await user.click(boton);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Mi perfil lleva a la pantalla y Cerrar sesión sale (ya no hay otro botón suelto en la barra)', async () => {
    const api = apiFalsa(sesionConPerfil({ 'POST /api/auth/logout': { status: 204 } }));
    const { user } = renderApp('/registrar');
    await botonCuenta();
    expect(within(document.querySelector('.barra') as HTMLElement).queryByRole('button', { name: 'Cerrar sesión' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).toBeNull();

    await user.click(await botonCuenta());
    await user.click(screen.getByRole('menuitem', { name: 'Mi perfil' }));
    expect(await screen.findByRole('heading', { name: 'Mi perfil', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(await botonCuenta());
    await user.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Panel del lavadero' })).toBeInTheDocument();
    expect(api.de('POST', '/api/auth/logout')).toHaveLength(1);
  });

  it('si la tabla de permisos dice que el rol no edita su perfil, Mi perfil no aparece', async () => {
    const tabla: Permisos = permisosAdmin();
    tabla.capacidades = [
      ...tabla.capacidades.filter((c) => c.id !== 'perfil.editar'),
      { id: 'perfil.editar', texto: 'Cambiar su propio nombre, foto y contraseña', roles: { superadmin: 'no', admin: 'si', empleado: 'si' } },
    ] as Permisos['capacidades'];
    apiFalsa({ ...sesionAdmin(), 'GET /api/admin/permisos': { status: 200, body: tabla } });
    const { user } = renderApp('/perfil');
    // La ruta tampoco existe: vuelve al inicio del encargado (Hoy).
    expect(await screen.findByRole('heading', { name: 'Hoy', level: 1 })).toBeInTheDocument();
    await user.click(await botonCuenta());
    expect(screen.queryByRole('menuitem', { name: 'Mi perfil' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('el empleado también tiene su menú y su perfil', async () => {
    apiFalsa({ ...sesionEmpleado(), 'GET /api/admin/perfil': { status: 200, body: perfilReal('perfilEmpleado') } });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('button', { name: /Beto/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Mi perfil' }));
    expect(await screen.findByRole('heading', { name: 'Mi perfil', level: 1 })).toBeInTheDocument();
    expect(await screen.findByLabelText('Subir foto')).toBeInTheDocument();
  });
});

describe('Mi perfil: foto', () => {
  it('una foto de más de 2 MB da error sin mandar nada', async () => {
    const api = apiFalsa(sesionConPerfil());
    const { user } = renderApp('/perfil');
    const input = await screen.findByLabelText('Subir foto');
    await user.upload(input, png(3 * 1024 * 1024));
    expect(await screen.findByText('La foto pesa más de 2 MB. Elegí una más liviana.')).toBeInTheDocument();
    expect(api.de('PUT', '/api/admin/perfil/foto')).toHaveLength(0);
  });

  it('un archivo que no es JPG, PNG ni WebP da error sin mandar nada', async () => {
    const api = apiFalsa(sesionConPerfil());
    const { user } = renderApp('/perfil', { applyAccept: false });
    await user.upload(await screen.findByLabelText('Subir foto'), png(1000, 'image/svg+xml', 'logo.svg'));
    expect(await screen.findByText('Subí una foto JPG, PNG o WebP.')).toBeInTheDocument();
    expect(api.de('PUT', '/api/admin/perfil/foto')).toHaveLength(0);
  });

  it('sube el archivo tal cual con su Content-Type y la barra muestra la foto nueva sin recargar', async () => {
    let soltar: () => void = () => undefined;
    const espera = new Promise<void>((r) => {
      soltar = r;
    });
    const api = apiFalsa(
      sesionConPerfil({
        'PUT /api/admin/perfil/foto': deVerdad('perfilFotoSube'),
      }),
    );
    // El PUT tarda: se ve el estado ocupado.
    const fetchReal = api.fetchFalso.getMockImplementation();
    api.fetchFalso.mockImplementation(async (input, init) => {
      if (init?.method === 'PUT') await espera;
      return fetchReal?.(input, init) as Promise<Response>;
    });
    const { user } = renderApp('/perfil');
    const input = await screen.findByLabelText('Subir foto');
    const archivo = png(50_000);
    await user.upload(input, archivo);

    expect(await screen.findByLabelText('Subiendo foto…')).toBeDisabled();
    expect(input).toBeDisabled();
    soltar();

    expect(await screen.findByText('Listo, guardamos tu foto.')).toBeInTheDocument();
    const [put] = api.de('PUT', '/api/admin/perfil/foto') as [Pedido];
    expect(put.headers['Content-Type']).toBe('image/png');
    expect(put.crudo).toBe(archivo);
    const src = `/api/admin/usuarios/${usuarioAdmin.id}/foto?v=${encodeURIComponent(VERSION)}`;
    expect((await botonCuenta()).querySelector('img')?.getAttribute('src')).toBe(src);
    // Ahora se puede cambiar o quitar.
    expect(screen.getByLabelText('Cambiar foto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar foto' })).toBeInTheDocument();
  });

  it('si la sesión venció al subir, refresca y reenvía la misma foto', async () => {
    const api = apiFalsa(
      sesionConPerfil({
        'PUT /api/admin/perfil/foto': [errores.vencida, deVerdad('perfilFotoSube')],
        'POST /api/auth/refresh': { status: 200, body: { usuario: usuarioAdmin } },
      }),
    );
    const { user } = renderApp('/perfil');
    const archivo = png(2000, 'image/jpeg', 'foto.jpg');
    await user.upload(await screen.findByLabelText('Subir foto'), archivo);
    expect(await screen.findByText('Listo, guardamos tu foto.')).toBeInTheDocument();
    const puts = api.de('PUT', '/api/admin/perfil/foto');
    expect(puts).toHaveLength(2);
    for (const p of puts) {
      expect(p.crudo).toBe(archivo);
      expect(p.headers['Content-Type']).toBe('image/jpeg');
    }
  });

  it('el error de la API sobre la foto se muestra tal cual', async () => {
    apiFalsa(
      sesionConPerfil({
        'PUT /api/admin/perfil/foto': errores.fotoInvalida,
      }),
    );
    const { user } = renderApp('/perfil');
    await user.upload(await screen.findByLabelText('Subir foto'), png(2000));
    expect(await screen.findByText('Subí una foto JPG, PNG o WebP.')).toBeInTheDocument();
  });

  it('quitar la foto vuelve a las iniciales', async () => {
    const api = apiFalsa({
      ...sesionAdmin(),
      'GET /api/auth/me': { status: 200, body: { usuario: { ...usuarioAdmin, fotoVersion: VERSION } } },
      'GET /api/admin/perfil': getPerfil(true, { fotoVersion: VERSION }),
      'DELETE /api/admin/perfil/foto': deVerdad('perfilFotoQuita'),
    });
    const { user } = renderApp('/perfil');
    await user.click(await screen.findByRole('button', { name: 'Quitar foto' }));
    expect(await screen.findByText('Quitamos tu foto. Ahora se ven tus iniciales.')).toBeInTheDocument();
    expect(api.de('DELETE', '/api/admin/perfil/foto')[0]?.headers['Content-Type']).toBe('application/json');
    expect((await botonCuenta()).querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Subir foto')).toBeInTheDocument();
  });

  it('sin fotos disponibles (falta la clave en el servidor) no aparece ni subir ni quitar', async () => {
    apiFalsa(sesionConPerfil({}, false));
    renderApp('/perfil');
    expect(await screen.findByRole('heading', { name: 'Nombre' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/JPG, PNG o WebP/)).toBeNull();
    });
    expect(screen.queryByLabelText(/foto/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quitar foto' })).toBeNull();
  });
});

describe('Mi perfil: nombre', () => {
  it('guardar el nombre manda PATCH y la barra se actualiza sin recargar', async () => {
    const api = apiFalsa(
      sesionConPerfil({ 'PATCH /api/admin/perfil': deVerdad('perfilPatchNombre') }),
    );
    const { user } = renderApp('/perfil');
    const campo = await screen.findByLabelText('Tu nombre');
    expect(campo).toHaveValue('Ana');
    expect(screen.getByRole('button', { name: 'Guardar nombre' })).toBeDisabled();
    await user.clear(campo);
    await user.type(campo, '  Ana Pérez ');
    await user.click(screen.getByRole('button', { name: 'Guardar nombre' }));

    expect(await screen.findByText('Listo, guardamos tu nombre.')).toBeInTheDocument();
    expect(api.de('PATCH', '/api/admin/perfil')[0]?.body).toEqual({ nombre: 'Ana Pérez' });
    expect(await screen.findByRole('button', { name: /Ana Pérez/ })).toHaveAttribute('aria-haspopup', 'menu');
    expect(campo).toHaveValue('Ana Pérez');
  });

  it('vaciar el nombre lo borra (manda null)', async () => {
    const api = apiFalsa(
      sesionConPerfil({ 'PATCH /api/admin/perfil': deVerdad('perfilPatchNombreNull') }),
    );
    const { user } = renderApp('/perfil');
    await user.clear(await screen.findByLabelText('Tu nombre'));
    await user.click(screen.getByRole('button', { name: 'Guardar nombre' }));
    await screen.findByText('Listo, guardamos tu nombre.');
    expect(api.de('PATCH', '/api/admin/perfil')[0]?.body).toEqual({ nombre: null });
  });
});

describe('Mi perfil: contraseña', () => {
  it('los campos tienen el autocomplete correcto', async () => {
    apiFalsa(sesionConPerfil());
    renderApp('/perfil');
    expect(await screen.findByLabelText('Contraseña actual')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('Contraseña nueva')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Repetí la nueva')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('si no coinciden avisa sin mandar nada', async () => {
    const api = apiFalsa(sesionConPerfil());
    const { user } = renderApp('/perfil');
    await user.type(await screen.findByLabelText('Contraseña actual'), 'vieja-123');
    await user.type(screen.getByLabelText('Contraseña nueva'), 'nueva-segura-1');
    await user.type(screen.getByLabelText('Repetí la nueva'), 'nueva-segura-2');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(screen.getByLabelText('Repetí la nueva')).toHaveAccessibleDescription(/No coincide/);
    expect(api.de('PATCH', '/api/admin/perfil')).toHaveLength(0);
  });

  it('la actual incorrecta se marca en su campo', async () => {
    apiFalsa(
      sesionConPerfil({
        'PATCH /api/admin/perfil': errores.passwordActualMal,
      }),
    );
    const { user } = renderApp('/perfil');
    await user.type(await screen.findByLabelText('Contraseña actual'), 'mal-123456');
    await user.type(screen.getByLabelText('Contraseña nueva'), 'nueva-segura-1');
    await user.type(screen.getByLabelText('Repetí la nueva'), 'nueva-segura-1');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Contraseña actual')).toHaveAccessibleDescription('La contraseña actual no es correcta.');
    });
  });

  it('cambiarla bien manda las dos juntas, limpia los campos y avisa', async () => {
    const api = apiFalsa(sesionConPerfil({ 'PATCH /api/admin/perfil': deVerdad('perfilPatchPassword') }));
    const { user } = renderApp('/perfil');
    await user.type(await screen.findByLabelText('Contraseña actual'), 'vieja-123');
    await user.type(screen.getByLabelText('Contraseña nueva'), 'nueva-segura-1');
    await user.type(screen.getByLabelText('Repetí la nueva'), 'nueva-segura-1');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText('Listo, cambiaste tu contraseña. Esta sesión sigue abierta.')).toBeInTheDocument();
    expect(api.de('PATCH', '/api/admin/perfil')[0]?.body).toEqual({ passwordActual: 'vieja-123', passwordNueva: 'nueva-segura-1' });
    expect(screen.getByLabelText('Contraseña actual')).toHaveValue('');
    expect(screen.getByLabelText('Contraseña nueva')).toHaveValue('');
  });

  it('el límite de intentos (429) se muestra con el mensaje de la API', async () => {
    apiFalsa(
      sesionConPerfil({
        'PATCH /api/admin/perfil': errores.passwordLimite,
      }),
    );
    const { user } = renderApp('/perfil');
    await user.type(await screen.findByLabelText('Contraseña actual'), 'vieja-123');
    await user.type(screen.getByLabelText('Contraseña nueva'), 'nueva-segura-1');
    await user.type(screen.getByLabelText('Repetí la nueva'), 'nueva-segura-1');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Hiciste demasiados intentos de cambiar la contraseña.');
  });
});
