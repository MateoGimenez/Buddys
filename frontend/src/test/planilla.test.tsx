import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hoy } from '../lib/format';
import { apiFalsa } from './apiFalsa';
import {
  permisosAdmin,
  permisosEmpleado,
  planillaAdmin,
  planillaEmpleado,
  serviciosAdmin,
  usuarioAdmin,
  usuarioEmpleado,
} from './fixtures';
import { renderApp } from './render';

function sesionAdmin() {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: usuarioAdmin } },
    'GET /api/admin/permisos': { status: 200, body: permisosAdmin() },
    'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
  };
}

describe('Planilla del día', () => {
  it('el encargado ve total, montos y lo que falta cargar; sin ranking', async () => {
    const api = apiFalsa({ ...sesionAdmin(), 'GET /api/admin/lavados': { status: 200, body: planillaAdmin(hoy()) } });
    renderApp('/planilla');

    // En el resumen y en el total de la caja.
    expect(await screen.findAllByText('$ 72.000')).toHaveLength(2);
    expect(api.de('GET', '/api/admin/lavados')[0]?.path).toBe(`/api/admin/lavados?fecha=${hoy()}`);
    // Contrato 05: ni "Quién lavó más" ni una lista que compare personas.
    expect(screen.queryByRole('heading', { name: 'Quién lavó más' })).toBeNull();
    expect(screen.getByRole('main')).not.toHaveTextContent(/Quién lavó|Lavó:|ranking/i);
    expect(api.de('GET', '/api/admin/trabajadores')).toHaveLength(0);
    expect(screen.getByText('N° 0001')).toBeInTheDocument();
    // En el resumen (cuántos faltan) y en la copia del lavado sin monto.
    expect(screen.getAllByText('Sin monto')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Borrar' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Corregir' })).toHaveLength(3);
  });

  it('corregir manda por PATCH solo lo que cambió', async () => {
    const original = planillaAdmin(hoy()).lavados[2];
    if (!original) throw new Error('sin lavado');
    const api = apiFalsa({
      ...sesionAdmin(),
      'GET /api/admin/lavados': { status: 200, body: planillaAdmin(hoy()) },
      'PATCH /api/admin/bookings/l3': { status: 200, body: { booking: { ...original, monto: 20000 } } },
    });
    const { user } = renderApp('/planilla');
    const botones = await screen.findAllByRole('button', { name: 'Corregir' });
    await user.click(botones[2] as HTMLElement);
    await user.type(screen.getByLabelText('Monto cobrado'), '20000');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findAllByRole('button', { name: 'Corregir' });
    const [patch] = api.de('PATCH', '/api/admin/bookings/l3');
    expect(patch?.body).toEqual({ monto: 20000 });
  });

  it('cambiar solo la nota no reenvía el monto ni quien lo hizo; la corrección ya no tiene "Quién lo lavó"', async () => {
    // l1: $ 12.000, lo hizo alguien que ya no figura entre los trabajadores activos.
    const dia = planillaAdmin(hoy());
    const ex = { id: '00000000-0000-4000-8000-0000000000e0', nombre: 'Ex empleado' };
    dia.lavados = dia.lavados.map((l) => (l.id === 'l1' ? { ...l, trabajador: ex } : l));
    const original = dia.lavados[0];
    if (!original) throw new Error('sin lavado');
    const api = apiFalsa({
      ...sesionAdmin(),
      'GET /api/admin/lavados': { status: 200, body: dia },
      'PATCH /api/admin/bookings/l1': { status: 200, body: { booking: { ...original, notasInternas: 'Pagó con transferencia' } } },
    });
    const { user } = renderApp('/planilla');
    const [corregir] = await screen.findAllByRole('button', { name: 'Corregir' });
    await user.click(corregir as HTMLElement);
    expect(screen.getByLabelText('Monto cobrado')).toHaveValue('12.000');
    expect(screen.queryByLabelText('Quién lo lavó')).toBeNull();
    await user.type(screen.getByLabelText('Nota'), 'Pagó con transferencia');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findAllByRole('button', { name: 'Corregir' });
    expect(api.de('PATCH', '/api/admin/bookings/l1').map((p) => p.body)).toEqual([{ notasInternas: 'Pagó con transferencia' }]);
  });

  it('cada lavado dice quién lo registró: registradoPor, si no quién lo hizo, si no "sin dato"', async () => {
    const dia = planillaAdmin(hoy());
    // l1 lo registró Beto; l2, Ana; l3 no tiene registradoPor (se usa trabajador: Beto). Se suma uno sin ninguno.
    const base = dia.lavados[0];
    if (!base) throw new Error('sin lavado');
    dia.lavados = [...dia.lavados, { ...base, id: 'l4', franja: 'tarde', trabajador: null, registradoPor: null }];
    apiFalsa({ ...sesionAdmin(), 'GET /api/admin/lavados': { status: 200, body: dia } });
    renderApp('/planilla');
    await screen.findByText('N° 0004');
    const lineas = screen.getAllByText(/^Registrado por:/).map((p) => p.textContent);
    expect(lineas).toEqual(['Registrado por: Beto', 'Registrado por: Ana', 'Registrado por: Beto', 'Registrado por: sin dato']);
    expect(screen.queryByText(/^Lavó:/)).toBeNull();
  });

  it('vaciar el monto avisa que se borra y manda monto null; sin cambios no manda nada', async () => {
    const original = planillaAdmin(hoy()).lavados[0];
    if (!original) throw new Error('sin lavado');
    const api = apiFalsa({
      ...sesionAdmin(),
      'GET /api/admin/lavados': { status: 200, body: planillaAdmin(hoy()) },
      'PATCH /api/admin/bookings/l1': { status: 200, body: { booking: { ...original, monto: null } } },
    });
    const { user } = renderApp('/planilla');

    // Abrir y guardar sin tocar nada: no hay PATCH (el backend respondería 400 a un cambio vacío).
    await user.click((await screen.findAllByRole('button', { name: 'Corregir' }))[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(api.de('PATCH', '/api/admin/bookings/l1')).toHaveLength(0);

    await user.click((await screen.findAllByRole('button', { name: 'Corregir' }))[0] as HTMLElement);
    const monto = screen.getByLabelText('Monto cobrado');
    await user.clear(monto);
    expect(monto).toHaveAccessibleDescription('Al guardar se borra el monto cargado ($ 12.000).');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findAllByRole('button', { name: 'Corregir' });
    expect(api.de('PATCH', '/api/admin/bookings/l1').map((p) => p.body)).toEqual([{ monto: null }]);
  });

  it('borrar pide confirmación y manda DELETE con Content-Type JSON', async () => {
    const api = apiFalsa({
      ...sesionAdmin(),
      'GET /api/admin/lavados': { status: 200, body: planillaAdmin(hoy()) },
      'DELETE /api/admin/bookings/l1': { status: 204 },
    });
    const { user } = renderApp('/planilla');
    const [borrar] = await screen.findAllByRole('button', { name: 'Borrar' });
    await user.click(borrar as HTMLElement);
    // Avisa que el stock que descontó vuelve (contrato 06).
    expect(screen.getByRole('dialog')).toHaveTextContent('Los productos que usó vuelven al stock. No se puede deshacer.');
    await user.click(screen.getByRole('button', { name: 'Sí, borrarlo' }));
    await screen.findAllByRole('button', { name: 'Borrar' });
    const [del] = api.de('DELETE', '/api/admin/bookings/l1');
    expect(del?.headers['Content-Type']).toBe('application/json');
    expect(del?.body).toBeUndefined();
  });

  it('el empleado no ve ningún monto ni botones de corregir o borrar', async () => {
    apiFalsa({
      'GET /api/auth/me': { status: 200, body: { usuario: usuarioEmpleado } },
      'GET /api/admin/permisos': { status: 200, body: permisosEmpleado() },
      'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
      'GET /api/admin/lavados': { status: 200, body: planillaEmpleado(hoy()) },
    });
    renderApp('/planilla');
    expect(await screen.findByText('N° 0003')).toBeInTheDocument();
    const contenido = screen.getByRole('main');
    expect(contenido.textContent).not.toMatch(/\$/);
    expect(within(contenido).queryByText('Sin monto')).toBeNull();
    expect(within(contenido).queryByText('Cobrado')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Borrar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Corregir' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /nota/ }).length).toBeGreaterThan(0);
    // También ve quién registró cada lavado (es un nombre, no un importe).
    expect(screen.getAllByText(/^Registrado por:/)).toHaveLength(3);
  });
});
