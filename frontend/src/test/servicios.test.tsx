import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiFalsa } from './apiFalsa';
import { permisosAdmin, permisosEmpleado, serviciosAdmin, usuarioAdmin, usuarioEmpleado } from './fixtures';
import { renderApp } from './render';

describe('Servicios', () => {
  it('el empleado ve qué se ofrece para cada vehículo, pero ningún precio', async () => {
    apiFalsa({
      'GET /api/auth/me': { status: 200, body: { usuario: usuarioEmpleado } },
      'GET /api/admin/permisos': { status: 200, body: permisosEmpleado() },
      'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
    });
    renderApp('/servicios');
    const lista = (await screen.findByRole('heading', { name: 'Lavado Básico' })).closest('ul') as HTMLElement;
    expect(lista).not.toHaveTextContent('$');
    expect(lista).not.toHaveTextContent('A consultar');
    expect(screen.getAllByText('Se ofrece').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Editar precios' })).toBeNull();
  });

  it('el encargado sigue viendo los precios', async () => {
    apiFalsa({
      'GET /api/auth/me': { status: 200, body: { usuario: usuarioAdmin } },
      'GET /api/admin/permisos': { status: 200, body: permisosAdmin() },
      'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
    });
    renderApp('/servicios');
    const lista = (await screen.findByRole('heading', { name: 'Lavado Básico' })).closest('ul') as HTMLElement;
    expect(lista).toHaveTextContent('$');
  });
});
