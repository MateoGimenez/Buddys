import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { UsuarioEquipo } from '../api/types';
import { filtrarEquipo } from '../lib/equipo';
import { apiFalsa } from './apiFalsa';
import { equipo, permisosDueno, permisosEmpleado, permisosEncargado, usuarioAdmin, usuarioEmpleado, usuarioEncargado } from './fixtures';
import { renderApp } from './render';

const LUCIA_ID = '00000000-0000-4000-8000-0000000011c1';
const DANI_ID = '00000000-0000-4000-8000-0000000011d1';

function sesionDe(quien: 'ana' | 'carla') {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: quien === 'ana' ? usuarioAdmin : usuarioEncargado } },
    'GET /api/admin/permisos': { status: 200, body: quien === 'ana' ? permisosDueno() : permisosEncargado() },
    'GET /api/admin/usuarios': { status: 200, body: equipo(quien) },
  };
}

/** La hoja (li) de una persona, por su nombre. */
async function hojaDe(nombre: string): Promise<HTMLElement> {
  return (await screen.findByRole('heading', { name: new RegExp(`^${nombre}`) })).closest('li') as HTMLElement;
}

const nombresVisibles = () =>
  within(document.querySelector('.lista-hojas') as HTMLElement)
    .getAllByRole('heading')
    .map((h) => h.firstChild?.textContent);

describe('Equipo: buscador y filtros', () => {
  it('por defecto muestra activos e inactivos, sin los dados de baja', async () => {
    apiFalsa(sesionDe('ana'));
    renderApp('/equipo');
    await hojaDe('Beto');
    expect(nombresVisibles()).toEqual(['Ana', 'Carla', 'Beto', 'Lucía Gómez', 'Dani']);
    expect(screen.getByText('5 de 6 personas')).toBeDefined();
  });

  it('busca por nombre o email sin distinguir mayúsculas ni acentos', async () => {
    apiFalsa(sesionDe('ana'));
    const { user } = renderApp('/equipo');
    await hojaDe('Beto');
    const buscar = screen.getByRole('searchbox', { name: 'Buscar' });

    await user.type(buscar, 'LUCIA');
    expect(nombresVisibles()).toEqual(['Lucía Gómez']);

    await user.clear(buscar);
    await user.type(buscar, 'gomez');
    expect(nombresVisibles()).toEqual(['Lucía Gómez']);

    await user.clear(buscar);
    await user.type(buscar, 'beto@buddys');
    expect(nombresVisibles()).toEqual(['Beto']);

    await user.clear(buscar);
    await user.type(buscar, 'nadie');
    expect(screen.getByText('Nadie coincide')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Limpiar búsqueda y filtros' }));
    expect(buscar).toHaveValue('');
    expect(nombresVisibles()).toHaveLength(5);
  });

  it('filtra por rol y por estado', async () => {
    apiFalsa(sesionDe('ana'));
    const { user } = renderApp('/equipo');
    await hojaDe('Beto');
    const rol = screen.getByRole('combobox', { name: 'Rol' });
    const estado = screen.getByRole('combobox', { name: 'Estado' });

    await user.selectOptions(rol, 'Empleados');
    expect(nombresVisibles()).toEqual(['Beto', 'Lucía Gómez', 'Dani']);

    await user.selectOptions(estado, 'Inactivos');
    expect(nombresVisibles()).toEqual(['Dani']);

    await user.selectOptions(estado, 'Dados de baja');
    expect(nombresVisibles()).toEqual(['Ezequiel']);
    expect(within(await hojaDe('Ezequiel')).getByText('Dado de baja el 17/11')).toBeDefined();

    await user.selectOptions(rol, 'Admins');
    expect(screen.getByText('Nadie coincide')).toBeDefined();

    await user.selectOptions(rol, 'Todos');
    await user.selectOptions(estado, 'Todos');
    expect(nombresVisibles()).toHaveLength(6);
    await user.selectOptions(estado, 'Activos');
    expect(nombresVisibles()).toEqual(['Ana', 'Carla', 'Beto', 'Lucía Gómez']);
  });

  it('filtrarEquipo no rompe con nombres o emails nulos', () => {
    const sinNada = { ...equipo('ana').usuarios[2], nombre: null, email: null } as UsuarioEquipo;
    expect(filtrarEquipo([sinNada], 'beto', 'todos', 'vigentes')).toEqual([]);
    expect(filtrarEquipo([sinNada], '', 'todos', 'vigentes')).toEqual([sinNada]);
  });
});

describe('Equipo: lo que ve cada rol', () => {
  it('el empleado no ve la sección Equipo', async () => {
    apiFalsa({
      'GET /api/auth/me': { status: 200, body: { usuario: usuarioEmpleado } },
      'GET /api/admin/permisos': { status: 200, body: permisosEmpleado() },
      'GET /api/admin/servicios': { status: 200, body: { servicios: [] } },
    });
    renderApp('/equipo');
    await screen.findByRole('navigation', { name: 'Secciones' });
    expect(screen.queryByRole('link', { name: /Equipo/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Equipo', level: 1 })).toBeNull();
  });

  it('el admin ve Equipo, sin acciones sobre admins ni superadmins ni sobre sí mismo', async () => {
    apiFalsa(sesionDe('carla'));
    renderApp('/equipo');
    expect(await screen.findByRole('heading', { name: 'Equipo', level: 1 })).toBeDefined();
    expect(screen.getAllByRole('link', { name: /Equipo/ }).length).toBeGreaterThan(0);

    for (const nombre of ['Ana', 'Carla']) {
      const hoja = await hojaDe(nombre);
      expect(within(hoja).queryByRole('button')).toBeNull();
      expect(within(hoja).queryByRole('combobox')).toBeNull();
      // Sin hueco: no queda la fila de acciones vacía.
      expect(hoja.querySelector('.fila-botones, .fila-campos')).toBeNull();
    }
    // No ve el email de admins ni superadmins (le llega null).
    expect(screen.queryByText('ana@buddys.test')).toBeNull();
    expect(within(await hojaDe('Ana')).getByText('Dueño (superadmin)')).toBeDefined();

    // Sobre empleados: quitar acceso y eliminar, pero sin elegir rol.
    const beto = await hojaDe('Beto');
    expect(within(beto).getByRole('button', { name: 'Quitar acceso' })).toBeDefined();
    expect(within(beto).getByRole('button', { name: 'Eliminar' })).toBeDefined();
    expect(within(beto).queryByRole('combobox')).toBeNull();
  });

  it('el admin crea empleados sin selector de rol (siempre empleado)', async () => {
    const api = apiFalsa({
      ...sesionDe('carla'),
      'POST /api/admin/usuarios': { status: 201, body: { usuario: equipo('carla').usuarios[2] } },
    });
    const { user } = renderApp('/equipo');
    await user.click(await screen.findByRole('button', { name: 'Nuevo empleado' }));
    const form = screen.getByRole('heading', { name: 'Nuevo empleado' }).closest('form') as HTMLElement;
    expect(within(form).queryByRole('combobox', { name: 'Rol' })).toBeNull();
    await user.type(within(form).getByLabelText('Email'), 'nuevo@ejemplo.com');
    await user.type(within(form).getByLabelText('Contraseña'), 'clave-segura');
    await user.click(within(form).getByRole('button', { name: 'Crear empleado' }));
    await waitFor(() => {
      expect(api.de('POST', '/api/admin/usuarios')).toHaveLength(1);
    });
    expect(api.de('POST', '/api/admin/usuarios')[0]?.body).toMatchObject({ email: 'nuevo@ejemplo.com', rol: 'empleado' });
  });

  it('el superadmin elige el rol al crear y en cada fila gestionable', async () => {
    apiFalsa(sesionDe('ana'));
    const { user } = renderApp('/equipo');
    const carla = await hojaDe('Carla');
    expect(within(carla).getByRole('combobox', { name: 'Rol de Carla' })).toHaveValue('admin');
    // Él mismo y los dados de baja no son gestionables.
    expect(within(await hojaDe('Ana')).queryByRole('button')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Nuevo usuario' }));
    const form = screen.getByRole('heading', { name: 'Nuevo usuario' }).closest('form') as HTMLElement;
    expect(within(form).getByRole('combobox', { name: 'Rol' })).toBeDefined();
  });
});

describe('Equipo: eliminar', () => {
  it('con historial avisa que se da de baja; el foco arranca en Cancelar y "baja" actualiza la fila', async () => {
    const lucia = equipo('ana').usuarios.find((u) => u.id === LUCIA_ID) as UsuarioEquipo;
    const api = apiFalsa({
      ...sesionDe('ana'),
      [`DELETE /api/admin/usuarios/${LUCIA_ID}`]: {
        status: 200,
        body: {
          resultado: 'baja',
          usuario: { ...lucia, email: null, activo: false, eliminadoAt: '2026-11-17T15:00:00.000Z', gestionable: false },
        },
      },
    });
    const { user } = renderApp('/equipo');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Estado' }), 'Todos');
    await user.click(within(await hojaDe('Lucía Gómez')).getByRole('button', { name: 'Eliminar' }));

    const dialogo = await screen.findByRole('dialog', { name: '¿Dar de baja a Lucía Gómez?' });
    expect(dialogo).toHaveTextContent(
      'Lucía Gómez tiene lavados registrados, así que no se borra: se da de baja. No va a poder entrar y su nombre sigue en los lavados viejos.',
    );
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    const confirmar = within(dialogo).getByRole('button', { name: 'Dar de baja a Lucía Gómez' });
    expect(confirmar).toHaveClass('btn-peligro');
    await user.click(confirmar);

    await waitFor(() => {
      expect(api.de('DELETE', `/api/admin/usuarios/${LUCIA_ID}`)).toHaveLength(1);
    });
    const hoja = await hojaDe('Lucía Gómez');
    expect(within(hoja).getByText('Dado de baja el 17/11')).toBeDefined();
    expect(hoja).toHaveAttribute('data-baja');
    expect(within(hoja).queryByRole('button')).toBeNull();
    expect(screen.queryByText('lucia@ejemplo.com')).toBeNull();
  });

  it('sin historial avisa que se borra; "eliminado" saca la fila', async () => {
    const api = apiFalsa({
      ...sesionDe('ana'),
      [`DELETE /api/admin/usuarios/${DANI_ID}`]: { status: 200, body: { resultado: 'eliminado' } },
    });
    const { user } = renderApp('/equipo');
    await user.click(within(await hojaDe('Dani')).getByRole('button', { name: 'Eliminar' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Eliminar a Dani?' });
    expect(dialogo).toHaveTextContent('Se va a borrar a Dani. No se puede deshacer.');
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await user.click(within(dialogo).getByRole('button', { name: 'Eliminar a Dani' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /^Dani/ })).toBeNull();
    });
    expect(api.de('DELETE', `/api/admin/usuarios/${DANI_ID}`)).toHaveLength(1);
    expect(screen.getByText('Se eliminó a Dani.')).toBeDefined();
  });

  it('con el filtro por defecto, el dado de baja sale de la lista y se avisa dónde encontrarlo', async () => {
    const lucia = equipo('ana').usuarios.find((u) => u.id === LUCIA_ID) as UsuarioEquipo;
    apiFalsa({
      ...sesionDe('ana'),
      [`DELETE /api/admin/usuarios/${LUCIA_ID}`]: {
        status: 200,
        body: { resultado: 'baja', usuario: { ...lucia, email: null, activo: false, eliminadoAt: '2026-11-17T15:00:00.000Z', gestionable: false } },
      },
    });
    const { user } = renderApp('/equipo');
    await user.click(within(await hojaDe('Lucía Gómez')).getByRole('button', { name: 'Eliminar' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Dar de baja a Lucía Gómez' }));
    expect(await screen.findByText('Lucía Gómez quedó dado de baja. Lo ves en el estado “Dados de baja”.')).toBeDefined();
    expect(nombresVisibles()).not.toContain('Lucía Gómez');
  });

  it('sin la clave de Supabase no aparece Eliminar (la API no podría hacerlo)', async () => {
    apiFalsa({ ...sesionDe('ana'), 'GET /api/admin/usuarios': { status: 200, body: { ...equipo('ana'), gestionCuentas: false } } });
    renderApp('/equipo');
    const beto = await hojaDe('Beto');
    expect(within(beto).getByRole('button', { name: 'Quitar acceso' })).toBeDefined();
    expect(within(beto).queryByRole('button', { name: 'Eliminar' })).toBeNull();
  });

  it('Cancelar cierra el diálogo sin pedir nada', async () => {
    const api = apiFalsa(sesionDe('ana'));
    const { user } = renderApp('/equipo');
    await user.click(within(await hojaDe('Dani')).getByRole('button', { name: 'Eliminar' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Eliminar a Dani?' });
    await user.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.de('DELETE', '/api/admin/usuarios')).toHaveLength(0);
  });

  it('si la API rechaza la baja, se ve el mensaje en la fila', async () => {
    apiFalsa({
      ...sesionDe('ana'),
      [`DELETE /api/admin/usuarios/${LUCIA_ID}`]: {
        status: 503,
        body: {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'No pudimos terminar la baja en el servicio de usuarios. Quedó desactivado; probá eliminarlo de nuevo en unos minutos.',
          },
        },
      },
    });
    const { user } = renderApp('/equipo');
    await user.click(within(await hojaDe('Lucía Gómez')).getByRole('button', { name: 'Eliminar' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Dar de baja a Lucía Gómez' }));
    expect(await within(await hojaDe('Lucía Gómez')).findByRole('alert')).toHaveTextContent('probá eliminarlo de nuevo');
  });
});
