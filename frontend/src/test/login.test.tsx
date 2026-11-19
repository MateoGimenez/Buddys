import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiFalsa } from './apiFalsa';
import { errores, permisosAdmin, permisosEmpleado, serviciosAdmin, trabajadores, usuarioAdmin, usuarioEmpleado } from './fixtures';
import { renderApp } from './render';

describe('Login y sesión', () => {
  it('sin sesión muestra el ingreso y, con credenciales correctas, entra al panel', async () => {
    const api = apiFalsa({
      'GET /api/auth/me': errores.sinSesion,
      'POST /api/auth/login': { status: 200, body: { usuario: usuarioAdmin } },
      'GET /api/admin/permisos': { status: 200, body: permisosAdmin() },
      'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
      'GET /api/admin/trabajadores': { status: 200, body: trabajadores() },
    });
    const { user } = renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Panel del lavadero' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'buddy@email.com');
    await user.type(screen.getByLabelText('Contraseña'), 'clave-de-prueba');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(await screen.findByRole('heading', { name: 'Registrar lavado' })).toBeInTheDocument();
    const [login] = api.de('POST', '/api/auth/login');
    expect(login?.body).toEqual({ email: 'buddy@email.com', password: 'clave-de-prueba' });
    expect(login?.headers['Content-Type']).toBe('application/json');

    // El superadmin ve todas las secciones, Equipo incluido.
    const riel = screen.getByRole('navigation', { name: 'Secciones' });
    for (const s of ['Registrar', 'Planilla', 'Números', 'Servicios', 'Insumos', 'Gastos', 'Presupuestos', 'Equipo']) {
      expect(within(riel).getByRole('link', { name: s })).toBeInTheDocument();
    }
  });

  it('con credenciales incorrectas muestra el mensaje de la API y vacía la contraseña', async () => {
    apiFalsa({
      'GET /api/auth/me': errores.sinSesion,
      'POST /api/auth/login': errores.credenciales,
    });
    const { user } = renderApp('/');
    await user.type(await screen.findByLabelText('Email'), 'buddy@email.com');
    await user.type(screen.getByLabelText('Contraseña'), 'mal');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El email o la contraseña no son correctos');
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
  });

  it('el botón muestra y oculta la contraseña, y al enviar vuelve a ocultarla', async () => {
    apiFalsa({
      'GET /api/auth/me': errores.sinSesion,
      'POST /api/auth/login': errores.credenciales,
    });
    const { user } = renderApp('/');
    const campo = await screen.findByLabelText('Contraseña');
    // Mismo input para el gestor de contraseñas: name y autocomplete no cambian.
    expect(campo).toHaveAttribute('type', 'password');
    expect(campo).toHaveAttribute('name', 'password');
    expect(campo).toHaveAttribute('autocomplete', 'current-password');

    const ojo = screen.getByRole('button', { name: 'Mostrar contraseña' });
    expect(ojo).toHaveAttribute('aria-pressed', 'false');
    await user.click(ojo);
    expect(campo).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Mostrar contraseña' })).toHaveAttribute('aria-pressed', 'true');

    await user.type(screen.getByLabelText('Email'), 'buddy@email.com');
    await user.type(campo, 'clave');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(campo).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Mostrar contraseña' })).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('pide email y contraseña antes de mandar nada', async () => {
    const api = apiFalsa({ 'GET /api/auth/me': errores.sinSesion });
    const { user } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Ingresar' }));
    expect(screen.getByText('Escribí tu email.')).toBeInTheDocument();
    expect(screen.getByText('Escribí tu contraseña.')).toBeInTheDocument();
    expect(api.de('POST', '/api/auth/login')).toHaveLength(0);
  });

  it('el empleado no ve las secciones de encargados', async () => {
    apiFalsa({
      'GET /api/auth/me': { status: 200, body: { usuario: usuarioEmpleado } },
      'GET /api/admin/permisos': { status: 200, body: permisosEmpleado() },
      'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
    });
    renderApp('/gastos');
    expect(await screen.findByRole('heading', { name: 'Registrar lavado' })).toBeInTheDocument();
    const riel = screen.getByRole('navigation', { name: 'Secciones' });
    for (const s of ['Gastos', 'Presupuestos', 'Equipo']) expect(within(riel).queryByRole('link', { name: s })).toBeNull();
    for (const s of ['Registrar', 'Planilla', 'Números', 'Servicios', 'Insumos']) expect(within(riel).getByRole('link', { name: s })).toBeInTheDocument();
  });

  it('cerrar sesión llama a logout con Content-Type JSON y vuelve al ingreso', async () => {
    const api = apiFalsa({
      'GET /api/auth/me': { status: 200, body: { usuario: usuarioEmpleado } },
      'GET /api/admin/permisos': { status: 200, body: permisosEmpleado() },
      'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
      'POST /api/auth/logout': { status: 204 },
    });
    const { user } = renderApp('/mas');
    const [boton] = await screen.findAllByRole('button', { name: 'Cerrar sesión' });
    if (!boton) throw new Error('falta el botón');
    await user.click(boton);
    expect(await screen.findByRole('heading', { name: 'Panel del lavadero' })).toBeInTheDocument();
    const [logout] = api.de('POST', '/api/auth/logout');
    expect(logout?.headers['Content-Type']).toBe('application/json');
  });
});
