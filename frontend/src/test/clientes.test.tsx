import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiFalsa } from './apiFalsa';
import { registrado } from './fixtures';
import {
  busquedaPatente,
  fidelizacionConfig,
  fidelizacionGuardada,
  historialAdmin,
  historialEmpleado,
  inactivos,
  respuesta,
  sesion,
} from './fixtures-mejoras';
import { renderApp } from './render';


describe('Clientes', () => {
  it('busca por patente y abre el historial del cliente', async () => {
    const api = apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/bookings': { status: 200, body: busquedaPatente() },
      'GET /api/admin/clientes/historial': { status: 200, body: historialAdmin() },
    });
    const { user } = renderApp('/clientes');
    await user.type(await screen.findByLabelText('Buscar cliente'), 'ab 123 cd');
    const resultados = await screen.findByRole('list', { name: 'Clientes encontrados' });
    // Dos turnos del mismo teléfono: un solo cliente.
    const filas = within(resultados).getAllByRole('link');
    expect(filas).toHaveLength(1);
    expect(api.de('GET', '/api/admin/bookings')[0]?.path).toContain('q=ab+123+cd');
    await user.click(filas[0] as HTMLElement);
    expect(await screen.findByRole('heading', { name: 'Juan Pérez', level: 1 })).toBeInTheDocument();
    expect(api.de('GET', '/api/admin/clientes/historial')[0]?.path).toBe('/api/admin/clientes/historial?telefono=5493804123456');
  });

  it('el encargado ve visitas, lo que más se hace, el total gastado y la tarjeta de sellos', async () => {
    apiFalsa({ ...sesion('superadmin'), 'GET /api/admin/clientes/historial': { status: 200, body: historialAdmin() } });
    renderApp('/clientes?telefono=5493804123456');
    expect(await screen.findByText('Gastó en total')).toBeInTheDocument();
    expect(screen.getByText('$ 77.000')).toBeInTheDocument();
    expect(screen.getByText(/Lavado Básico/, { selector: 'li' })).toBeInTheDocument();
    const sellos = screen.getByRole('region', { name: 'Tarjeta de sellos' });
    expect(within(sellos).getByRole('list', { name: '3 de 10 sellos' })).toBeInTheDocument();
    expect(sellos).toHaveTextContent('Faltan 7 para un lavado gratis');
    expect(screen.getByRole('link', { name: 'Escribirle por WhatsApp' })).toHaveAttribute('href', 'https://wa.me/5493804123456');
  });

  it('el empleado ve el historial sin ningún importe', async () => {
    apiFalsa({ ...sesion('empleado'), 'GET /api/admin/clientes/historial': { status: 200, body: historialEmpleado() } });
    renderApp('/clientes?patente=AB123CD');
    await screen.findByRole('region', { name: 'Tarjeta de sellos' });
    expect(screen.queryByText('Gastó en total')).toBeNull();
    expect(screen.getByRole('main')).not.toHaveTextContent('$');
    // El empleado no tiene la lista de inactivos.
    expect(screen.queryByRole('radio', { name: 'Inactivos' })).toBeNull();
  });

  it('una patente sin visitas lo dice sin asustar', async () => {
    apiFalsa({ ...sesion('superadmin'), 'GET /api/admin/clientes/historial': respuesta('error404Cliente') });
    renderApp('/clientes?patente=ZZ999ZZ');
    expect(await screen.findByText('Sin visitas registradas')).toBeInTheDocument();
  });

  it('inactivos: cada uno con su botón de WhatsApp (el link de la API)', async () => {
    const lista = inactivos();
    apiFalsa({ ...sesion('admin'), 'GET /api/admin/clientes/inactivos': { status: 200, body: lista } });
    renderApp('/clientes?ver=inactivos');
    const link = await screen.findByRole('link', { name: 'Mandar WhatsApp' });
    expect(link).toHaveAttribute('href', lista.clientes[0]?.whatsapp);
    expect(screen.getByText('hace 31 días')).toBeInTheDocument();
  });

  it('la tarjeta la cambia solo el superadmin (con PUT); el admin la ve', async () => {
    const api = apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/fidelizacion': { status: 200, body: fidelizacionConfig() },
      'PUT /api/admin/fidelizacion': { status: 200, body: fidelizacionGuardada() },
    });
    const { user, unmount } = renderApp('/clientes?ver=tarjeta');
    await user.click(await screen.findByRole('button', { name: 'Cambiar la tarjeta' }));
    const cada = screen.getByLabelText('Cada cuántos lavados hay premio');
    await user.clear(cada);
    await user.type(cada, '8');
    await user.click(screen.getByRole('radio', { name: 'Descuento' }));
    await user.type(screen.getByLabelText('Porcentaje de descuento'), '50');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/50% de descuento/)).toBeInTheDocument();
    expect(api.de('PUT', '/api/admin/fidelizacion')[0]?.body).toEqual({
      sellosCada: 8,
      premio: 'descuento',
      premioPorcentaje: 50,
      inactivosDias: 30,
    });
    unmount();

    apiFalsa({ ...sesion('admin'), 'GET /api/admin/fidelizacion': { status: 200, body: fidelizacionConfig() } });
    renderApp('/clientes?ver=tarjeta');
    expect(await screen.findByText(/un lavado gratis/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cambiar la tarjeta' })).toBeNull();
  });

  it('en Registrar, una patente conocida completa nombre y teléfono y muestra la tarjeta', async () => {
    const h = historialEmpleado();
    h.cliente.sellos = { ...h.cliente.sellos, sellos: 10, faltan: 0, proximoEsPremio: true };
    const api = apiFalsa({
      ...sesion('empleado'),
      'GET /api/admin/clientes/historial': { status: 200, body: h },
      'GET /api/admin/bookings': { status: 200, body: busquedaPatente() },
      'POST /api/admin/lavados': { status: 201, body: registrado({}) },
    });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByText('Más datos'));
    await user.type(screen.getByLabelText('Patente'), 'AB123CD');
    expect(await screen.findByText('Ya vino: Juan Pérez')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre del cliente')).toHaveValue('Juan Pérez');
    expect(screen.getByLabelText('Teléfono')).toHaveValue('5493804123456');
    expect(screen.getByText(/Este lavado es el premio de la tarjeta: un lavado gratis/)).toBeInTheDocument();
    expect(api.de('GET', '/api/admin/clientes/historial')[0]?.path).toBe('/api/admin/clientes/historial?patente=AB123CD');
  });

  it('en Registrar no pisa un nombre que ya se escribió', async () => {
    apiFalsa({ ...sesion('superadmin'), 'GET /api/admin/clientes/historial': { status: 200, body: historialAdmin() } });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByText('Más datos'));
    await user.type(screen.getByLabelText('Nombre del cliente'), 'Juancito');
    await user.type(screen.getByLabelText('Patente'), 'AB123CD');
    await screen.findByText('Ya vino: Juan Pérez');
    expect(screen.getByLabelText('Nombre del cliente')).toHaveValue('Juancito');
  });
});
