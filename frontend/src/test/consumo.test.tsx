import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFalsa } from './apiFalsa';
import { conStock, consumoNoviembre, consumoVacio, listaInsumos, listaInsumosEmpleado, permisosAdmin, permisosEmpleado, usuarioAdmin, usuarioEmpleado } from './fixtures';
import { renderApp } from './render';

function sesion(quien: 'admin' | 'empleado', extra: Record<string, unknown> = {}) {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: quien === 'admin' ? usuarioAdmin : usuarioEmpleado } },
    'GET /api/admin/permisos': { status: 200, body: conStock(quien === 'admin' ? permisosAdmin() : permisosEmpleado()) },
    'GET /api/admin/insumos': { status: 200, body: quien === 'admin' ? listaInsumos() : listaInsumosEmpleado() },
    'GET /api/admin/consumo': { status: 200, body: consumoNoviembre() },
    'GET /api/admin/insumos/alertas': { status: 200, body: { bajoStock: 0, insumos: [] } },
    ...extra,
  } as Parameters<typeof apiFalsa>[0];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Consumo', () => {
  it('muestra los lavados del mes con su serie, el consumo por insumo y el costo por lavado', async () => {
    const api = apiFalsa(sesion('admin'));
    renderApp('/insumos?ver=consumo');
    const tabla = (await screen.findByRole('columnheader', { name: 'Consumido' })).closest('table') as HTMLElement;
    // El mes en curso va hasta hoy.
    expect(api.de('GET', '/api/admin/consumo')[0]?.path).toBe('/api/admin/consumo?desde=2026-11-01&hasta=2026-11-17');
    expect(screen.getByRole('link', { name: 'Consumo' })).toHaveAttribute('aria-current', 'page');

    const c = consumoNoviembre();
    const cifras = screen.getByRole('heading', { name: 'Lavados y costo de noviembre de 2026' }).closest('section') as HTMLElement;
    expect(cifras).toHaveTextContent(`Lavados${String(c.lavados.total)}`);
    expect(cifras).toHaveTextContent('Costo de insumos$ 22.050');
    expect(cifras).toHaveTextContent(`Costo por lavado$ ${new Intl.NumberFormat('es-AR').format(c.costoPorLavado ?? 0)}`);
    expect(cifras).toHaveTextContent('con el precio actual');
    // La serie, con los valores para el lector de pantalla.
    const serie = screen.getByRole('table', { name: 'Lavados por día' });
    expect(within(serie).getAllByRole('row')).toHaveLength(30);

    const filas = within(tabla).getAllByRole('row').map((f) => f.textContent.replaceAll(String.fromCharCode(160), ' '));
    expect(filas).toEqual([
      'InsumoConsumidoCosto',
      'Cera líquida900 ml$ 10.800',
      'Paños de microfibra4 unidadesSin costo',
      'Shampoo1,25 litros$ 11.250',
    ]);
  });

  it('cambia de mes con las flechas (el mes que viene no existe todavía)', async () => {
    const api = apiFalsa(sesion('admin'));
    const { user } = renderApp('/insumos?ver=consumo');
    await screen.findByRole('columnheader', { name: 'Consumido' });
    expect(screen.getByRole('button', { name: 'Mes siguiente' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Mes anterior' }));
    await waitFor(() => { expect(api.de('GET', '/api/admin/consumo')).toHaveLength(2); });
    expect(api.de('GET', '/api/admin/consumo')[1]?.path).toBe('/api/admin/consumo?desde=2026-10-01&hasta=2026-10-31');
    expect(screen.getByText('octubre de 2026')).toBeInTheDocument();
  });

  it('sin lavados ni consumo lo dice, y el costo por lavado queda en raya', async () => {
    // La respuesta real de un mes vacío: la serie viene con ceros (no vacía) y costoPorLavado en null.
    const vacio = consumoVacio();
    expect(vacio.lavados.serie.every((p) => p.cantidad === 0)).toBe(true);
    apiFalsa(sesion('admin', { 'GET /api/admin/consumo': { status: 200, body: vacio } }));
    renderApp('/insumos?ver=consumo');
    expect(await screen.findByText('No hubo lavados en este mes')).toBeInTheDocument();
    expect(screen.getByText('No se descontó nada este mes')).toBeInTheDocument();
    expect(screen.getByText('Costo por lavado').nextElementSibling).toHaveTextContent('—');
  });

  it('el empleado ni llega a Consumo: ve el stock, sin montos, y no se pide nada de consumo', async () => {
    const api = apiFalsa(sesion('empleado'));
    renderApp('/insumos?ver=consumo');
    expect(await screen.findByRole('heading', { name: 'Shampoo' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Consumo' })).toBeNull();
    expect(screen.queryByText('Costo por lavado')).toBeNull();
    expect(api.de('GET', '/api/admin/consumo')).toHaveLength(0);
    expect(document.body.innerHTML).not.toContain('$');
  });
});
