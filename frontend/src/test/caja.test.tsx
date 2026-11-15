import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hoy } from '../lib/format';
import { apiFalsa } from './apiFalsa';
import { planillaAdmin, planillaEmpleado, permisosEmpleado, serviciosAdmin, usuarioEmpleado } from './fixtures';
import { renderApp } from './render';
import { sesionAdmin } from './sesiones';

function fila(caja: HTMLElement, forma: string): HTMLElement {
  const celda = within(caja).getByRole('rowheader', { name: forma });
  const tr = celda.closest('tr');
  if (!tr) throw new Error(`sin fila ${forma}`);
  return tr;
}

describe('Caja del día y forma de pago en la planilla', () => {
  it('el encargado ve el total por forma de pago, "Sin indicar" y el total cobrado', async () => {
    apiFalsa({ ...sesionAdmin(), 'GET /api/admin/lavados': { status: 200, body: planillaAdmin(hoy()) } });
    renderApp('/planilla');
    const caja = (await screen.findByRole('heading', { name: 'Caja del día' })).closest('section');
    if (!caja) throw new Error('sin caja');

    expect(fila(caja, 'Efectivo')).toHaveTextContent('1 lavado$ 12.000');
    expect(fila(caja, 'Transferencia')).toHaveTextContent('$ 60.000');
    expect(fila(caja, 'Sin indicar')).toHaveTextContent('1 lavado');
    expect(fila(caja, 'Total cobrado')).toHaveTextContent('3 lavados$ 72.000');
    expect(caja).toHaveTextContent('1 lavado no tiene monto cargado y no suma.');

    // Cada copia dice cómo se pagó; la que no tiene, lo avisa para completarla al cerrar.
    const copias = screen.getAllByRole('listitem').filter((li) => li.classList.contains('copia'));
    expect(copias[0]).toHaveTextContent('Efectivo');
    expect(copias[1]).toHaveTextContent('Transferencia');
    expect(copias[2]).toHaveTextContent('Pago sin indicar');
  });

  it('el empleado ve cuántos lavados por forma de pago, sin ningún importe', async () => {
    apiFalsa({
      'GET /api/auth/me': { status: 200, body: { usuario: usuarioEmpleado } },
      'GET /api/admin/permisos': { status: 200, body: permisosEmpleado() },
      'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
      'GET /api/admin/lavados': { status: 200, body: planillaEmpleado(hoy()) },
    });
    renderApp('/planilla');
    const caja = (await screen.findByRole('heading', { name: 'Cómo pagaron' })).closest('section');
    if (!caja) throw new Error('sin bloque');
    expect(screen.queryByRole('heading', { name: 'Caja del día' })).toBeNull();
    expect(fila(caja, 'Efectivo')).toHaveTextContent('1 lavado');
    expect(fila(caja, 'Sin indicar')).toHaveTextContent('1 lavado');
    // Solo dos columnas: forma y cantidad (sin una vacía donde iría el importe).
    expect(within(fila(caja, 'Efectivo')).getAllByRole('cell')).toHaveLength(1);
    expect(within(caja).queryByText('Total cobrado')).toBeNull();
    expect(screen.getByRole('main').textContent).not.toMatch(/\$/);
    expect(screen.queryByText('Pago sin indicar')).toBeNull();
  });

  it('corregir carga o saca la forma de pago y manda solo eso por PATCH', async () => {
    const dia = planillaAdmin(hoy());
    const [l1, , l3] = dia.lavados;
    if (!l1 || !l3) throw new Error('sin lavados');
    const api = apiFalsa({
      ...sesionAdmin(),
      'GET /api/admin/lavados': { status: 200, body: dia },
      'PATCH /api/admin/bookings/l3': { status: 200, body: { booking: { ...l3, formaPago: 'debito' } } },
      'PATCH /api/admin/bookings/l1': { status: 200, body: { booking: { ...l1, formaPago: null } } },
    });
    const { user } = renderApp('/planilla');

    await user.click((await screen.findAllByRole('button', { name: 'Corregir' }))[2] as HTMLElement);
    const pago = screen.getByRole('group', { name: 'Forma de pago' });
    await user.click(within(pago).getByRole('radio', { name: 'Débito' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findAllByRole('button', { name: 'Corregir' });
    expect(api.de('PATCH', '/api/admin/bookings/l3').map((p) => p.body)).toEqual([{ formaPago: 'debito' }]);

    // Tocar la elegida la saca: queda "sin indicar".
    await user.click((await screen.findAllByRole('button', { name: 'Corregir' }))[0] as HTMLElement);
    const efectivo = within(screen.getByRole('group', { name: 'Forma de pago' })).getByRole('radio', { name: 'Efectivo' });
    expect(efectivo).toBeChecked();
    await user.click(efectivo);
    expect(efectivo).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findAllByRole('button', { name: 'Corregir' });
    expect(api.de('PATCH', '/api/admin/bookings/l1').map((p) => p.body)).toEqual([{ formaPago: null }]);
  });

  it('el comprobante arranca con la forma de pago del lavado', async () => {
    apiFalsa({ ...sesionAdmin(), 'GET /api/admin/lavados': { status: 200, body: planillaAdmin(hoy()) } });
    const { user } = renderApp('/planilla');
    // l2 se pagó por transferencia.
    await user.click((await screen.findAllByRole('button', { name: 'Comprobante' }))[1] as HTMLElement);
    expect(screen.getByLabelText('Forma de pago')).toHaveValue('transferencia');
  });
});
