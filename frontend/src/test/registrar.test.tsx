import { act, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiFalsa } from './apiFalsa';
import {
  BETO_ID,
  catalogoBuddys,
  errores,
  registrado,
  permisosAdmin,
  permisosEmpleado,
  serviciosAdmin,
  trabajadores,
  usuarioAdmin,
  usuarioEmpleado,
} from './fixtures';
import { renderApp } from './render';
import { unUuid } from './sesiones';

function sesionAdmin(catalogo = serviciosAdmin()) {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: usuarioAdmin } },
    'GET /api/admin/permisos': { status: 200, body: permisosAdmin() },
    'GET /api/admin/servicios': { status: 200, body: catalogo },
    'GET /api/admin/trabajadores': { status: 200, body: trabajadores() },
  };
}

function sesionEmpleado(catalogo = serviciosAdmin()) {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: usuarioEmpleado } },
    'GET /api/admin/permisos': { status: 200, body: permisosEmpleado() },
    'GET /api/admin/servicios': { status: 200, body: catalogo },
  };
}

const monto = () => screen.getByLabelText('Cuánto se cobró');

describe('Registrar lavado', () => {
  it('ofrece los cuatro vehículos en el orden canónico', async () => {
    apiFalsa(sesionAdmin());
    renderApp('/registrar');
    const vehiculo = await screen.findByRole('group', { name: 'Vehículo' });
    expect(within(vehiculo).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['Auto', 'SUV', 'Pick-up', 'Moto']);
    expect(within(vehiculo).getByRole('radio', { name: 'Auto' })).toBeChecked();
  });

  it('filtra los servicios por vehículo y sugiere el precio de lista', async () => {
    apiFalsa(sesionAdmin());
    const { user } = renderApp('/registrar');
    const servicios = await screen.findByRole('group', { name: 'Servicios' });
    // Activos: 4 (restauración de ópticas está inactivo). Pulido solo para auto.
    expect(within(servicios).getAllByRole('checkbox')).toHaveLength(4);
    expect(within(servicios).getByRole('checkbox', { name: /Pulido/ })).toBeInTheDocument();
    expect(within(servicios).queryByRole('checkbox', { name: /Restauración/ })).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'SUV' }));
    expect(within(servicios).queryByRole('checkbox', { name: /Pulido/ })).toBeNull();
    expect(within(servicios).getAllByRole('checkbox')).toHaveLength(3);

    await user.click(within(servicios).getByRole('checkbox', { name: /Lavado Básico/ }));
    expect(monto()).toHaveValue('15.000');
    await user.click(screen.getByRole('radio', { name: 'Pick-up' }));
    expect(monto()).toHaveValue('16.000');
  });

  it('manda el lavado con servicios, vehículo, monto y trabajador, y muestra la confirmación', async () => {
    const api = apiFalsa({
      ...sesionAdmin(),
      'POST /api/admin/lavados': {
        status: 201,
        body: registrado({ servicioId: 'lavado-basico', monto: 13500, trabajador: { id: BETO_ID, nombre: 'Beto' } }),
      },
    });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Lavado Básico/ }));
    await user.clear(monto());
    await user.type(monto(), '13500');
    expect(monto()).toHaveValue('13.500');
    await user.selectOptions(screen.getByLabelText('Quién lo lavó'), BETO_ID);
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));

    expect(await screen.findByText('Lavado registrado')).toBeInTheDocument();
    const [pedido] = api.de('POST', '/api/admin/lavados');
    expect(pedido?.headers['Content-Type']).toBe('application/json');
    expect(pedido?.body).toEqual({ servicioIds: ['lavado-basico'], vehiculoTipo: 'auto', monto: 13500, trabajadorId: BETO_ID, idLocal: unUuid() });
    expect(pedido?.body).not.toHaveProperty('servicioId');
    // El formulario queda listo para el siguiente.
    expect(monto()).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: /Lavado Básico/ })).not.toBeChecked();
  });

  it('si la pantalla quedó abierta desde ayer, el lavado se anota hoy (no manda la fecha vieja)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-12T23:30:00-03:00'));
      const api = apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': { status: 201, body: registrado({}) } });
      const { user } = renderApp('/registrar');
      expect(await screen.findByText(/^Hoy, jueves,? 12 de noviembre$/)).toBeInTheDocument();

      vi.setSystemTime(new Date('2026-11-13T08:00:00-03:00'));
      await user.click(screen.getByRole('checkbox', { name: /Lavado Básico/ }));
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
    const api = apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': { status: 201, body: registrado({}) } });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Lavado Básico/ }));
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
    expect(screen.getByText('Elegí qué servicios se hicieron.')).toBeInTheDocument();
    expect(api.de('POST', '/api/admin/lavados')).toHaveLength(0);
  });

  it('muestra los errores de validación de la API en cada campo y abre "Más datos"', async () => {
    apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': errores.validacionLavado });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Encerado/ }));
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));

    expect(await screen.findByText('Solo se pueden registrar lavados de los últimos 31 días.')).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Teléfono')).toHaveAccessibleDescription(/Revisá el teléfono/);
    expect(screen.getByRole('alert')).toHaveTextContent('Revisá los datos ingresados.');
  });

  it('el error de servicio no ofrecido queda en el grupo de servicios (venga como servicioIds o servicioId)', async () => {
    const { fields } = (errores.servicioNoOfrecido.body as { error: { fields: Record<string, string> } }).error;
    const mensaje = fields.servicioIds ?? fields.servicioId ?? '';
    for (const campo of ['servicioIds', 'servicioId']) {
      apiFalsa({
        ...sesionAdmin(),
        'POST /api/admin/lavados': {
          status: 400,
          body: { error: { code: 'VALIDATION_ERROR', message: 'Revisá los datos ingresados.', fields: { [campo]: mensaje } } },
        },
      });
      const { user, unmount } = renderApp('/registrar');
      await user.click(await screen.findByRole('checkbox', { name: /Encerado/ }));
      await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
      const grupo = screen.getByRole('group', { name: 'Servicios' });
      expect(await within(grupo).findByText(mensaje)).toBeInTheDocument();
      unmount();
    }
  });

  it('el empleado queda fijo como quien lavó y no manda trabajadorId', async () => {
    const api = apiFalsa({
      ...sesionEmpleado(),
      'POST /api/admin/lavados': { status: 201, body: registrado({ monto: null, trabajador: { id: BETO_ID, nombre: 'Beto' } }) },
    });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Lavado Premium/ }));
    expect(screen.queryByLabelText('Quién lo lavó')).toBeNull();
    expect(screen.getByText('Vos, Beto')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    await screen.findByText('Lavado registrado');
    const [pedido] = api.de('POST', '/api/admin/lavados');
    expect(pedido?.body).toEqual({ servicioIds: ['lavado-premium'], vehiculoTipo: 'auto', monto: null, idLocal: unUuid() });
    expect(api.de('GET', '/api/admin/trabajadores')).toHaveLength(0);
  });

  it('el empleado no ve precios de lista, no se le precarga el monto y la confirmación no repite el monto', async () => {
    const api = apiFalsa({
      ...sesionEmpleado(),
      'POST /api/admin/lavados': { status: 201, body: registrado({ monto: null, trabajador: { id: BETO_ID, nombre: 'Beto' } }) },
    });
    const { user } = renderApp('/registrar');
    const servicios = await screen.findByRole('group', { name: 'Servicios' });
    expect(servicios).not.toHaveTextContent('$');
    expect(servicios).not.toHaveTextContent(/Lista|Consultá/);

    await user.click(within(servicios).getByRole('checkbox', { name: /Lavado Básico/ }));
    expect(monto()).toHaveValue('');
    await user.type(monto(), '13500');
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));

    const talon = await screen.findByRole('status');
    expect(talon).toHaveTextContent('Lavado registrado');
    expect(talon).not.toHaveTextContent('$');
    const [pedido] = api.de('POST', '/api/admin/lavados');
    expect(pedido?.body).toEqual({ servicioIds: ['lavado-basico'], vehiculoTipo: 'auto', monto: 13500, idLocal: unUuid() });
  });

  it('un 403 muestra el mensaje y la sesión sigue', async () => {
    apiFalsa({ ...sesionEmpleado(), 'POST /api/admin/lavados': errores.prohibidoEmpleado });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Encerado/ }));
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Con tu rol, quien hizo el trabajo sos vos');
    expect(screen.getByRole('heading', { name: 'Registrar lavado' })).toBeInTheDocument();
  });
});

describe('Registrar con varios servicios (catálogo de 14)', () => {
  it('agrupa por categoría con los frecuentes primero, y para el vehículo elegido', async () => {
    apiFalsa(sesionAdmin(catalogoBuddys()));
    const { user } = renderApp('/registrar');
    const servicios = await screen.findByRole('group', { name: 'Servicios' });
    const grupos = within(servicios).getAllByRole('group').map((g) => g.querySelector('.servicios-categoria')?.textContent);
    expect(grupos).toEqual(['Frecuentes', 'Lavado', 'Interior', 'Pulido', 'Protección', 'Pre venta']);
    const frecuentes = within(servicios).getByRole('group', { name: 'Frecuentes' });
    expect(within(frecuentes).getAllByRole('checkbox').map((c) => c.closest('label')?.querySelector('.ficha-texto')?.textContent)).toEqual(['Nivel I', 'Nivel II']);
    // Ningún servicio de moto para un auto.
    expect(within(servicios).queryByRole('checkbox', { name: /^Moto / })).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Moto' }));
    expect(within(servicios).getAllByRole('checkbox')).toHaveLength(4);
    expect(within(servicios).getByRole('group', { name: 'Frecuentes' })).toHaveTextContent('Moto básico');
  });

  it('el monto sugerido es la suma de lista de los elegidos, con el resumen al pie', async () => {
    const api = apiFalsa({
      ...sesionAdmin(catalogoBuddys()),
      'POST /api/admin/lavados': {
        status: 201,
        body: registrado({
          servicioId: 'nivel-2',
          servicios: [
            { id: 'nivel-2', nombre: 'Nivel II', precioLista: 45000 },
            { id: 'motor', nombre: 'Motor', precioLista: 50000 },
          ],
          monto: 95000,
        }),
      },
    });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Nivel II\b(?!I)/ }));
    expect(monto()).toHaveValue('45.000');
    await user.click(screen.getByRole('checkbox', { name: /Motor/ }));
    expect(monto()).toHaveValue('95.000');
    expect(screen.getByText('2 servicios')).toBeInTheDocument();
    expect(screen.getByText(/\$ 95\.000 de lista/)).toBeInTheDocument();

    // Sacar uno descuenta su precio.
    await user.click(screen.getByRole('checkbox', { name: /Motor/ }));
    expect(monto()).toHaveValue('45.000');
    await user.click(screen.getByRole('checkbox', { name: /Motor/ }));

    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    const talon = await screen.findByRole('status');
    expect(talon).toHaveTextContent('Nivel II + Motor');
    expect(api.de('POST', '/api/admin/lavados')[0]?.body).toMatchObject({ servicioIds: ['nivel-2', 'motor'], monto: 95000 });
  });

  it('un servicio "Consultá" no suma y se avisa', async () => {
    apiFalsa(sesionAdmin(catalogoBuddys()));
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('radio', { name: 'Pick-up' }));
    await user.click(screen.getByRole('checkbox', { name: /Nivel I\b(?!I)/ }));
    await user.click(screen.getByRole('checkbox', { name: /Motor/ }));
    expect(screen.getByRole('checkbox', { name: /Motor/ }).closest('label')).toHaveTextContent('Consultá');
    // Pick-up: Nivel I 32.000; Motor sin precio para pick-up (no usa el de auto).
    expect(monto()).toHaveValue('32.000');
    expect(screen.getByText('· 1 a consultar', { exact: false })).toBeInTheDocument();
    expect(monto()).toHaveAccessibleDescription(/Motor no tiene precio de lista: sumalo a mano/);
  });

  it('si el monto se escribió a mano, elegir otro servicio no lo pisa', async () => {
    apiFalsa(sesionAdmin(catalogoBuddys()));
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Nivel I\b(?!I)/ }));
    expect(monto()).toHaveValue('25.000');
    await user.clear(monto());
    await user.type(monto(), '20000');
    await user.click(screen.getByRole('checkbox', { name: /Motor/ }));
    expect(monto()).toHaveValue('20.000');
    expect(monto()).toHaveAccessibleDescription(/Lo cambiaste a mano: la lista da \$ 75\.000/);
    await user.click(screen.getByRole('radio', { name: 'SUV' }));
    expect(monto()).toHaveValue('20.000');
  });

  it('al cambiar de vehículo saca los servicios que no se ofrecen y lo avisa', async () => {
    const api = apiFalsa({ ...sesionAdmin(catalogoBuddys()), 'POST /api/admin/lavados': { status: 201, body: registrado({}) } });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Nivel II\b(?!I)/ }));
    await user.click(screen.getByRole('checkbox', { name: /Pulido de ópticas/ }));
    await user.click(screen.getByRole('checkbox', { name: /Sellador/ }));
    expect(monto()).toHaveValue('160.000');

    await user.click(screen.getByRole('radio', { name: 'Moto' }));
    expect(screen.getByText(/Se sacó Nivel II \+ Sellador acrílico: no se ofrecen para Moto/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Pulido de ópticas/ })).toBeChecked();
    // El monto sugerido sigue a la lista: Pulido de ópticas para moto.
    expect(monto()).toHaveValue('25.000');
    expect(screen.getByText('1 servicio')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    await screen.findByText('Lavado registrado');
    expect(api.de('POST', '/api/admin/lavados')[0]?.body).toMatchObject({ servicioIds: ['pulido-opticas'], vehiculoTipo: 'moto' });
  });

  it('el empleado elige varios sin ver precios, sumas ni monto sugerido', async () => {
    const api = apiFalsa({
      ...sesionEmpleado(catalogoBuddys()),
      'POST /api/admin/lavados': { status: 201, body: registrado({ monto: null, trabajador: { id: BETO_ID, nombre: 'Beto' } }) },
    });
    const { user, container } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Nivel II\b(?!I)/ }));
    await user.click(screen.getByRole('checkbox', { name: /Motor/ }));
    expect(monto()).toHaveValue('');
    expect(screen.getByText('2 servicios')).toBeInTheDocument();
    const form = container.querySelector('form');
    expect(form).not.toHaveTextContent(/\$\s?\d/);
    expect(form).not.toHaveTextContent(/de lista|Consultá|a consultar/);
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    await screen.findByText('Lavado registrado');
    expect(api.de('POST', '/api/admin/lavados')[0]?.body).toEqual({ servicioIds: ['nivel-2', 'motor'], vehiculoTipo: 'auto', monto: null, idLocal: unUuid() });
  });

  it('con 10 elegidos no deja sumar más', async () => {
    apiFalsa(sesionAdmin(catalogoBuddys()));
    const { user } = renderApp('/registrar');
    const servicios = await screen.findByRole('group', { name: 'Servicios' });
    const casillas = within(servicios).getAllByRole('checkbox');
    expect(casillas).toHaveLength(11);
    for (const c of casillas.slice(0, 10)) await user.click(c);
    expect(casillas[10]).toBeDisabled();
    expect(screen.getByText('10 servicios')).toBeInTheDocument();
  });
});
