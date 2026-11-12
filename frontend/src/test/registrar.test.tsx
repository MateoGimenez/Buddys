import { act, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiFalsa } from './apiFalsa';
import {
  BETO_ID,
  errores,
  lavado,
  permisosAdmin,
  permisosEmpleado,
  serviciosAdmin,
  trabajadores,
  usuarioAdmin,
  usuarioEmpleado,
} from './fixtures';
import { renderApp } from './render';

function sesionAdmin() {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: usuarioAdmin } },
    'GET /api/admin/permisos': { status: 200, body: permisosAdmin() },
    'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
    'GET /api/admin/trabajadores': { status: 200, body: trabajadores() },
  };
}

function sesionEmpleado() {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: usuarioEmpleado } },
    'GET /api/admin/permisos': { status: 200, body: permisosEmpleado() },
    'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
  };
}

describe('Registrar lavado', () => {
  it('filtra los servicios por vehículo y sugiere el precio de lista', async () => {
    apiFalsa(sesionAdmin());
    const { user } = renderApp('/registrar');
    const servicios = await screen.findByRole('group', { name: 'Servicio' });
    // Activos: 4 (restauración de ópticas está inactivo). Pulido solo para auto.
    expect(within(servicios).getAllByRole('radio')).toHaveLength(4);
    expect(within(servicios).getByRole('radio', { name: /Pulido/ })).toBeInTheDocument();
    expect(within(servicios).queryByRole('radio', { name: /Restauración/ })).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Camioneta' }));
    expect(within(servicios).queryByRole('radio', { name: /Pulido/ })).toBeNull();
    expect(within(servicios).getAllByRole('radio')).toHaveLength(3);

    await user.click(within(servicios).getByRole('radio', { name: /Lavado Básico/ }));
    expect(screen.getByLabelText('Cuánto se cobró')).toHaveValue('15.000');
  });

  it('manda el lavado con servicio, vehículo, monto y trabajador, y muestra la confirmación', async () => {
    const api = apiFalsa({
      ...sesionAdmin(),
      'POST /api/admin/lavados': {
        status: 201,
        body: { lavado: lavado({ servicioId: 'lavado-basico', monto: 13500, trabajador: { id: BETO_ID, nombre: 'Beto' } }) },
      },
    });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('radio', { name: /Lavado Básico/ }));
    const monto = screen.getByLabelText('Cuánto se cobró');
    await user.clear(monto);
    await user.type(monto, '13500');
    expect(monto).toHaveValue('13.500');
    await user.selectOptions(screen.getByLabelText('Quién lo lavó'), BETO_ID);
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));

    expect(await screen.findByText('Lavado registrado')).toBeInTheDocument();
    const [pedido] = api.de('POST', '/api/admin/lavados');
    expect(pedido?.headers['Content-Type']).toBe('application/json');
    expect(pedido?.body).toEqual({ servicioId: 'lavado-basico', vehiculoTipo: 'auto', monto: 13500, trabajadorId: BETO_ID });
    // El formulario queda listo para el siguiente.
    expect(screen.getByLabelText('Cuánto se cobró')).toHaveValue('');
  });

  it('si la pantalla quedó abierta desde ayer, el lavado se anota hoy (no manda la fecha vieja)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-12T23:30:00-03:00'));
      const api = apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': { status: 201, body: { lavado: lavado({}) } } });
      const { user } = renderApp('/registrar');
      expect(await screen.findByText(/^Hoy, jueves,? 12 de noviembre$/)).toBeInTheDocument();

      vi.setSystemTime(new Date('2026-11-13T08:00:00-03:00'));
      await user.click(screen.getByRole('radio', { name: /Lavado Básico/ }));
      expect(screen.getByText(/^Hoy, viernes,? 13 de noviembre$/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
      await screen.findByText('Lavado registrado');
      const [pedido] = api.de('POST', '/api/admin/lavados');
      expect(pedido?.body).not.toHaveProperty('fecha');
    } finally {
      vi.useRealTimers();
    }
  });

  it('un doble toque en "Registrar lavado" manda un solo lavado', async () => {
    const api = apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': { status: 201, body: { lavado: lavado({}) } } });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('radio', { name: /Lavado Básico/ }));
    const boton = screen.getByRole('button', { name: 'Registrar lavado' });
    // Dos clics en el mismo instante, antes de que React vuelva a dibujar el botón deshabilitado.
    act(() => {
      boton.click();
      boton.click();
    });
    await screen.findByText('Lavado registrado');
    expect(api.de('POST', '/api/admin/lavados')).toHaveLength(1);
  });

  it('no deja registrar sin elegir servicio', async () => {
    const api = apiFalsa(sesionAdmin());
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('button', { name: 'Registrar lavado' }));
    expect(screen.getByText('Elegí qué servicio se hizo.')).toBeInTheDocument();
    expect(api.de('POST', '/api/admin/lavados')).toHaveLength(0);
  });

  it('muestra los errores de validación de la API en cada campo y abre "Más datos"', async () => {
    apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': errores.validacionLavado });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('radio', { name: /Encerado/ }));
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));

    expect(await screen.findByText('Solo se pueden registrar lavados de los últimos 31 días.')).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Teléfono')).toHaveAccessibleDescription(/Revisá el teléfono/);
    expect(screen.getByRole('alert')).toHaveTextContent('Revisá los datos ingresados.');
  });

  it('el error de servicio no ofrecido queda en el selector de servicio', async () => {
    apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': errores.servicioNoOfrecido });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('radio', { name: /Encerado/ }));
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    const grupo = screen.getByRole('group', { name: 'Servicio' });
    expect(await within(grupo).findByText('Ese servicio no se ofrece para camioneta. Elegí otro.')).toBeInTheDocument();
  });

  it('el empleado queda fijo como quien lavó y no manda trabajadorId', async () => {
    const api = apiFalsa({
      ...sesionEmpleado(),
      'POST /api/admin/lavados': { status: 201, body: { lavado: lavado({ monto: null, trabajador: { id: BETO_ID, nombre: 'Beto' } }) } },
    });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('radio', { name: /Lavado Premium/ }));
    expect(screen.queryByLabelText('Quién lo lavó')).toBeNull();
    expect(screen.getByText('Vos, Beto')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    await screen.findByText('Lavado registrado');
    const [pedido] = api.de('POST', '/api/admin/lavados');
    expect(pedido?.body).toEqual({ servicioId: 'lavado-premium', vehiculoTipo: 'auto', monto: null });
    expect(api.de('GET', '/api/admin/trabajadores')).toHaveLength(0);
  });

  it('el empleado no ve precios de lista, no se le precarga el monto y la confirmación no repite el monto', async () => {
    const api = apiFalsa({
      ...sesionEmpleado(),
      'POST /api/admin/lavados': { status: 201, body: { lavado: lavado({ monto: null, trabajador: { id: BETO_ID, nombre: 'Beto' } }) } },
    });
    const { user } = renderApp('/registrar');
    const servicios = await screen.findByRole('group', { name: 'Servicio' });
    expect(servicios).not.toHaveTextContent('$');
    expect(servicios).not.toHaveTextContent(/Lista|Precio a consultar/);

    await user.click(within(servicios).getByRole('radio', { name: /Lavado Básico/ }));
    const monto = screen.getByLabelText('Cuánto se cobró');
    expect(monto).toHaveValue('');
    await user.type(monto, '13500');
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));

    const talon = await screen.findByRole('status');
    expect(talon).toHaveTextContent('Lavado registrado');
    expect(talon).not.toHaveTextContent('$');
    const [pedido] = api.de('POST', '/api/admin/lavados');
    expect(pedido?.body).toEqual({ servicioId: 'lavado-basico', vehiculoTipo: 'auto', monto: 13500 });
  });

  it('un 403 muestra el mensaje y la sesión sigue', async () => {
    apiFalsa({ ...sesionEmpleado(), 'POST /api/admin/lavados': errores.prohibidoEmpleado });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('radio', { name: /Encerado/ }));
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Con tu rol, quien hizo el trabajo sos vos');
    expect(screen.getByRole('heading', { name: 'Registrar lavado' })).toBeInTheDocument();
  });
});
