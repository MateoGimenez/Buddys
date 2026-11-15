import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlanillaDelDia, Servicio } from '../api/types';
import type { LavadoEnCola } from '../lib/cola';
import { hoy } from '../lib/format';
import { apiFalsa } from './apiFalsa';
import { ANA_ID, catalogoBuddys, lavado, permisosAdmin, permisosEmpleado, planillaAdmin, registrado, trabajadores, usuarioAdmin, usuarioEmpleado } from './fixtures';
import { renderApp } from './render';

const CLAVE = 'buddys.cola-lavados.v1';

function sesionAdmin() {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: usuarioAdmin } },
    'GET /api/admin/permisos': { status: 200, body: permisosAdmin() },
    'GET /api/admin/servicios': { status: 200, body: catalogoBuddys() },
    'GET /api/admin/trabajadores': { status: 200, body: trabajadores() },
  };
}

/** Un día con un lavado de dos servicios en una pick-up. */
function diaConVarios(): PlanillaDelDia {
  const p = planillaAdmin(hoy());
  const doble = lavado({
    id: 'l9',
    vehiculoTipo: 'pickup',
    servicioId: 'nivel-2',
    servicios: [
      { id: 'nivel-2', nombre: 'Nivel II', precioLista: 55000 },
      { id: 'motor', nombre: 'Motor', precioLista: null },
    ],
    monto: 60000,
    franja: 'manana',
  });
  return { ...p, lavados: [doble] };
}

describe('Varios servicios en la planilla', () => {
  it('la copia lista todos los servicios y el vehículo nuevo', async () => {
    apiFalsa({ ...sesionAdmin(), 'GET /api/admin/lavados': { status: 200, body: diaConVarios() } });
    renderApp('/planilla');
    expect(await screen.findByText('Nivel II + Motor')).toBeInTheDocument();
    expect(screen.getByText(/^Pick-up/)).toBeInTheDocument();
  });

  it('corregir permite cambiar los servicios y manda solo servicioIds', async () => {
    const dia = diaConVarios();
    const original = dia.lavados[0];
    if (!original) throw new Error('sin lavado');
    const api = apiFalsa({
      ...sesionAdmin(),
      'GET /api/admin/lavados': { status: 200, body: dia },
      'PATCH /api/admin/bookings/l9': {
        status: 200,
        body: {
          booking: {
            ...original,
            servicios: [
              { id: 'nivel-2', nombre: 'Nivel II', precioLista: 55000 },
              { id: 'interior-completo', nombre: 'Interior completo', precioLista: 110000 },
            ],
          },
        },
      },
    });
    const { user } = renderApp('/planilla');
    await user.click(await screen.findByRole('button', { name: 'Corregir' }));
    const grupo = screen.getByRole('group', { name: 'Servicios' });
    expect(within(grupo).getByRole('checkbox', { name: /Nivel II\b(?!I)/ })).toBeChecked();
    expect(within(grupo).getByRole('checkbox', { name: /Motor/ })).toBeChecked();
    // Lo que no se ofrece para pick-up no aparece.
    expect(within(grupo).queryByRole('checkbox', { name: /^Moto / })).toBeNull();

    await user.click(within(grupo).getByRole('checkbox', { name: /Motor/ }));
    await user.click(within(grupo).getByRole('checkbox', { name: /Interior completo/ }));
    expect(screen.getByText('Con estos servicios la lista da $ 165.000. El monto no cambia solo.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByRole('button', { name: 'Corregir' });
    expect(api.de('PATCH', '/api/admin/bookings/l9').map((p) => p.body)).toEqual([{ servicioIds: ['nivel-2', 'interior-completo'] }]);
  });

  it('no deja guardar un lavado sin servicios', async () => {
    const api = apiFalsa({ ...sesionAdmin(), 'GET /api/admin/lavados': { status: 200, body: diaConVarios() } });
    const { user } = renderApp('/planilla');
    await user.click(await screen.findByRole('button', { name: 'Corregir' }));
    await user.click(screen.getByRole('checkbox', { name: /Nivel II\b(?!I)/ }));
    await user.click(screen.getByRole('checkbox', { name: /Motor/ }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(screen.getByText('Tiene que quedar al menos un servicio.')).toBeInTheDocument();
    expect(api.de('PATCH', '/api/admin/bookings/l9')).toHaveLength(0);
  });
});

describe('Cola sin conexión con lavados de antes (un solo servicioId)', () => {
  it('lo guardado con servicioId se manda tal cual, sin servicioIds', async () => {
    const id = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    const viejo: LavadoEnCola = {
      idLocal: id,
      usuarioId: ANA_ID,
      datos: { servicioId: 'nivel-1', vehiculoTipo: 'auto', monto: 25000, fecha: hoy(), franja: 'manana', idLocal: id },
      servicio: 'Nivel I',
      guardadoEn: new Date().toISOString(),
    };
    localStorage.setItem(CLAVE, JSON.stringify([viejo]));
    const api = apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': { status: 201, body: registrado({ servicioId: 'nivel-1' }) } });
    renderApp('/registrar');
    await vi.waitFor(() => {
      expect(api.de('POST', '/api/admin/lavados')).toHaveLength(1);
    });
    const body = api.de('POST', '/api/admin/lavados')[0]?.body;
    expect(body).toEqual({ servicioId: 'nivel-1', vehiculoTipo: 'auto', monto: 25000, fecha: hoy(), franja: 'manana', idLocal: id });
    expect(body).not.toHaveProperty('servicioIds');
    await vi.waitFor(() => {
      expect(localStorage.getItem(CLAVE)).toBeNull();
    });
  });

  it('si un guardado tuviera los dos campos, viaja solo servicioIds (los dos juntos son 400)', async () => {
    const id = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
    localStorage.setItem(
      CLAVE,
      JSON.stringify([
        {
          idLocal: id,
          usuarioId: ANA_ID,
          datos: { servicioIds: ['nivel-1', 'motor'], servicioId: 'nivel-1', vehiculoTipo: 'auto', monto: null, fecha: hoy(), idLocal: id },
          servicio: 'Nivel I + Motor',
          guardadoEn: new Date().toISOString(),
        },
      ]),
    );
    const api = apiFalsa({ ...sesionAdmin(), 'POST /api/admin/lavados': { status: 201, body: registrado({}) } });
    renderApp('/registrar');
    await vi.waitFor(() => {
      expect(api.de('POST', '/api/admin/lavados')).toHaveLength(1);
    });
    const body = api.de('POST', '/api/admin/lavados')[0]?.body;
    expect(body).toMatchObject({ servicioIds: ['nivel-1', 'motor'] });
    expect(body).not.toHaveProperty('servicioId');
  });

  it('sin señal, un lavado de varios servicios queda en la cola con servicioIds y los nombres unidos', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const api = apiFalsa(sesionAdmin());
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Nivel II\b(?!I)/ }));
    await user.click(screen.getByRole('checkbox', { name: /Motor/ }));
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    expect(await screen.findByText('Guardado sin conexión')).toBeInTheDocument();
    const [guardado] = JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as LavadoEnCola[];
    expect(guardado?.servicio).toBe('Nivel II + Motor');
    expect(guardado?.datos).toMatchObject({ servicioIds: ['nivel-2', 'motor'], monto: 95000 });
    expect(guardado?.datos).not.toHaveProperty('servicioId');
    expect(api.de('POST', '/api/admin/lavados')).toHaveLength(0);
    vi.restoreAllMocks();
  });
});

describe('Servicios con SUV, pick-up y categoría', () => {
  it('muestra los cuatro vehículos con precio y duración, agrupados por categoría', async () => {
    const catalogo = catalogoBuddys();
    const nivel2 = catalogo.servicios.find((s) => s.id === 'nivel-2') as Servicio;
    nivel2.duracion = '1 h';
    nivel2.duracionPickup = '1 h 30 min';
    apiFalsa({ ...sesionAdmin(), 'GET /api/admin/servicios': { status: 200, body: catalogo } });
    renderApp('/servicios');
    const fila = (await screen.findByRole('heading', { name: 'Nivel II' })).closest('li') as HTMLElement;
    expect(within(fila).getAllByRole('term').map((t) => t.textContent)).toEqual(['Auto', 'SUV', 'Pick-up', 'Moto']);
    expect(fila).toHaveTextContent('$ 52.000');
    expect(fila).toHaveTextContent('1 h 30 min');
    expect(fila).toHaveTextContent('No se ofrece');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.firstChild?.textContent)).toEqual([
      'Lavado',
      'Interior',
      'Pulido',
      'Protección',
      'Pre venta',
      'Motos',
    ]);
  });

  it('editar manda los precios de SUV y pick-up y la categoría', async () => {
    const catalogo = catalogoBuddys();
    const motor = catalogo.servicios.find((s) => s.id === 'motor') as Servicio;
    const api = apiFalsa({
      ...sesionAdmin(),
      'GET /api/admin/servicios': { status: 200, body: catalogo },
      'PATCH /api/admin/servicios/motor': { status: 200, body: { servicio: { ...motor, categoria: 'Interior', precioDesdePickup: 60000 } } },
    });
    const { user } = renderApp('/servicios');
    const fila = (await screen.findByRole('heading', { name: 'Motor' })).closest('li') as HTMLElement;
    await user.click(within(fila).getByRole('button', { name: 'Editar' }));
    expect(within(fila).getByLabelText('Precio SUV')).toHaveValue('50.000');
    expect(within(fila).getByLabelText('Precio Pick-up')).toHaveValue('');
    await user.type(within(fila).getByLabelText('Precio Pick-up'), '60000');
    const categoria = within(fila).getByLabelText('Categoría');
    await user.clear(categoria);
    await user.type(categoria, 'Interior');
    await user.click(within(fila).getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => {
      expect(api.de('PATCH', '/api/admin/servicios/motor')).toHaveLength(1);
    });
    // Pasa a la categoría nueva.
    await vi.waitFor(() => {
      const seccion = screen.getByRole('heading', { name: 'Motor' }).closest('section');
      expect(seccion?.querySelector('h2')?.firstChild?.textContent).toBe('Interior');
    });
    expect(api.de('PATCH', '/api/admin/servicios/motor')[0]?.body).toEqual({
      precioDesde: 50000,
      precioDesdeSuv: 50000,
      precioDesdePickup: 60000,
      precioDesdeMoto: null,
      categoria: 'Interior',
      vehiculos: ['auto', 'suv', 'pickup'],
      activo: true,
    });
  });

  it('el empleado ve los vehículos y las duraciones, nunca un precio', async () => {
    apiFalsa({
      'GET /api/auth/me': { status: 200, body: { usuario: usuarioEmpleado } },
      'GET /api/admin/permisos': { status: 200, body: permisosEmpleado() },
      'GET /api/admin/servicios': { status: 200, body: catalogoBuddys() },
    });
    renderApp('/servicios');
    await screen.findByRole('heading', { name: 'Nivel II' });
    expect(screen.getByRole('main')).not.toHaveTextContent(/\$|Consultá/);
  });
});
