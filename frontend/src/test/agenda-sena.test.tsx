import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Turno } from '../api/types';
import { hoy } from '../lib/format';
import { apiFalsa } from './apiFalsa';
import { resp, sesionMejoras, turnoCompletado, turnoConSena, turnoConSenaEmpleado } from './fixtures-finanzas';
import { renderApp } from './render';

const HOY = hoy();
const ID = '00000000-0000-4000-8000-000000000031';
/** El turno del contrato, puesto hoy para que aparezca en la semana. */
const enHoy = (t: Turno): Turno => ({ ...t, fechaPreferida: HOY });

// Formularios largos con user-event: con la máquina cargada pasan de los 5 s por defecto.
describe('Agenda y turnos con seña', { timeout: 20_000 }, () => {
  it('crea un turno con seña y lo manda con POST /api/admin/turnos', async () => {
    const api = apiFalsa({
      ...sesionMejoras('superadmin'),
      'GET /api/admin/agenda': [{ status: 200, body: { turnos: [], cupos: [] } }, { status: 200, body: { turnos: [enHoy(turnoConSena())], cupos: [] } }],
      'POST /api/admin/turnos': { status: 201, body: { turno: enHoy(turnoConSena()) } },
    });
    const { user } = renderApp('/agenda');
    await user.click(await screen.findByRole('button', { name: 'Nuevo turno' }));
    const form = await screen.findByRole('form', { name: 'Nuevo turno' });
    await user.type(within(form).getByLabelText('Cliente'), 'Juan Pérez');
    await user.type(within(form).getByLabelText('Teléfono'), '+54 9 380 412-3456');
    await user.type(within(form).getByLabelText('Modelo y patente (opcional)'), 'Gol AB123CD');
    await user.click(within(form).getByRole('checkbox', { name: /Pulido/ }));
    await user.click(within(form).getByRole('checkbox', { name: 'Dejó seña' }));
    await user.type(within(form).getByLabelText('Cuánto dejó de seña'), '20000');
    await user.click(within(within(form).getByRole('group', { name: 'Cómo pagó la seña' })).getByRole('radio', { name: 'Transferencia' }));
    await user.click(within(form).getByRole('button', { name: 'Guardar turno' }));

    expect(await screen.findByText(/Turno de Juan Pérez guardado/)).toBeInTheDocument();
    expect(api.de('POST', '/api/admin/turnos')[0]?.body).toEqual({
      nombre: 'Juan Pérez',
      telefono: '+54 9 380 412-3456',
      vehiculoTipo: 'auto',
      vehiculoModelo: 'Gol AB123CD',
      servicioIds: ['pulido'],
      fecha: HOY,
      franja: 'manana',
      notasInternas: null,
      sena: { monto: 20000, formaPago: 'transferencia', fecha: HOY },
    });
    const tarjeta = (await screen.findByRole('heading', { name: 'Juan Pérez' })).closest('li') as HTMLElement;
    expect(tarjeta).toHaveTextContent('Seña $ 20.000 · Transferencia');
  });

  it('pide lo obligatorio antes de mandar', async () => {
    const api = apiFalsa({ ...sesionMejoras('admin'), 'GET /api/admin/agenda': { status: 200, body: { turnos: [], cupos: [] } } });
    const { user } = renderApp('/agenda');
    await user.click(await screen.findByRole('button', { name: 'Nuevo turno' }));
    await user.click(await screen.findByRole('button', { name: 'Guardar turno' }));
    expect(screen.getByText('Escribí el nombre del cliente.')).toBeInTheDocument();
    expect(screen.getByText('Elegí al menos un servicio.')).toBeInTheDocument();
    expect(api.de('POST', '/api/admin/turnos')).toHaveLength(0);
  });

  it('completar muestra el saldo = total - seña y manda el total', async () => {
    const api = apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/agenda': [
        { status: 200, body: { turnos: [enHoy({ ...turnoConSena(), sena: { monto: 25000, formaPago: 'efectivo', fecha: HOY } })], cupos: [] } },
        { status: 200, body: { turnos: [enHoy(turnoCompletado())], cupos: [] } },
      ],
      [`PATCH /api/admin/bookings/${ID}`]: { status: 200, body: { booking: enHoy(turnoCompletado()) } },
    });
    const { user } = renderApp('/agenda');
    await user.click(await screen.findByRole('button', { name: 'Completar' }));
    const total = screen.getByLabelText('Total del trabajo');
    await user.clear(total);
    await user.type(total, '20000');
    await user.click(screen.getByRole('button', { name: 'Completar turno' }));
    expect(screen.getByText('El total no puede ser menor que la seña que ya se cobró.')).toBeInTheDocument();

    await user.clear(total);
    await user.type(total, '60000');
    expect(screen.getByText('Saldo a cobrar').nextElementSibling).toHaveTextContent('$ 35.000');
    await user.click(screen.getByRole('button', { name: 'Completar turno' }));
    expect(await screen.findByText('Turno completado. Saldo a cobrar: $ 35.000.')).toBeInTheDocument();
    expect(api.de('PATCH', `/api/admin/bookings/${ID}`).map((p) => p.body)).toEqual([{ estado: 'completado', monto: 60000 }]);
  });

  it('el 400 del backend (total menor que la seña) se muestra en el campo', async () => {
    apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/agenda': { status: 200, body: { turnos: [enHoy(turnoConSena())], cupos: [] } },
      [`PATCH /api/admin/bookings/${ID}`]: resp('error400MontoMenorSena'),
    });
    const { user } = renderApp('/agenda');
    await user.click(await screen.findByRole('button', { name: 'Completar' }));
    await user.type(screen.getByLabelText('Total del trabajo'), '1');
    // Sin seña local que lo frene (la del fixture es 20.000 y el total arranca con la lista): el backend contesta.
    await user.clear(screen.getByLabelText('Total del trabajo'));
    await user.type(screen.getByLabelText('Total del trabajo'), '25000');
    await user.click(screen.getByRole('button', { name: 'Completar turno' }));
    expect(await screen.findByText('El total no puede ser menor que la seña que ya se cobró.')).toBeInTheDocument();
  });

  it('cancelar pide confirmación y manda estado cancelado', async () => {
    const api = apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/agenda': { status: 200, body: { turnos: [enHoy(turnoConSena())], cupos: [] } },
      [`PATCH /api/admin/bookings/${ID}`]: { status: 200, body: { booking: { ...enHoy(turnoConSena()), estado: 'cancelado' } } },
    });
    const { user } = renderApp('/agenda');
    await user.click(await screen.findByRole('button', { name: 'Cancelar turno' }));
    expect(screen.getByText(/La seña queda registrada/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sí, cancelarlo' }));
    expect(await screen.findByText('Turno de Juan Pérez cancelado.')).toBeInTheDocument();
    expect(api.de('PATCH', `/api/admin/bookings/${ID}`)[0]?.body).toEqual({ estado: 'cancelado' });
  });

  it('el empleado ve que dejó seña sin ningún monto, no crea ni cancela, y lo marca terminado', async () => {
    const api = apiFalsa({
      ...sesionMejoras('empleado'),
      'GET /api/admin/agenda': { status: 200, body: { turnos: [enHoy(turnoConSenaEmpleado())], cupos: [] } },
      [`PATCH /api/admin/bookings/${ID}`]: { status: 200, body: { booking: { ...enHoy(turnoConSenaEmpleado()), estado: 'completado' } } },
    });
    const { user } = renderApp('/agenda');
    const tarjeta = (await screen.findByRole('heading', { name: 'Juan Pérez' })).closest('li') as HTMLElement;
    expect(tarjeta).toHaveTextContent('Dejó seña · Transferencia');
    expect(screen.getByRole('main').textContent).not.toMatch(/\$/);
    expect(screen.queryByRole('button', { name: 'Nuevo turno' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar turno' })).toBeNull();
    expect(screen.queryByRole('button', { name: /seña/i })).toBeNull();
    await user.click(within(tarjeta).getByRole('button', { name: 'Marcar terminado' }));
    await user.click(screen.getByRole('button', { name: 'Sí, terminado' }));
    expect(await screen.findByText('Turno de Juan Pérez terminado.')).toBeInTheDocument();
    expect(api.de('PATCH', `/api/admin/bookings/${ID}`)[0]?.body).toEqual({ estado: 'completado' });
  });

  it('cambia entre día y semana y pide el rango correcto', async () => {
    const api = apiFalsa({ ...sesionMejoras('admin'), 'GET /api/admin/agenda': { status: 200, body: { turnos: [], cupos: [] } } });
    const { user } = renderApp('/agenda');
    expect(await screen.findByText('No hay turnos esta semana')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Día' }));
    expect(await screen.findByText('No hay turnos este día')).toBeInTheDocument();
    const ultimo = api.de('GET', '/api/admin/agenda').pop();
    expect(ultimo?.path).toBe(`/api/admin/agenda?desde=${HOY}&hasta=${HOY}`);
  });
});
