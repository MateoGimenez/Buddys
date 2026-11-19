import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFalsa } from './apiFalsa';
import { alertas, conStock, listaInsumos, listaInsumosEmpleado, paraComprar, permisosAdmin, permisosEmpleado, usuarioAdmin, usuarioEmpleado } from './fixtures';
import { renderApp } from './render';

function sesion(quien: 'admin' | 'empleado', extra: Record<string, unknown> = {}) {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: quien === 'admin' ? usuarioAdmin : usuarioEmpleado } },
    'GET /api/admin/permisos': { status: 200, body: conStock(quien === 'admin' ? permisosAdmin() : permisosEmpleado()) },
    'GET /api/admin/insumos': { status: 200, body: quien === 'admin' ? listaInsumos() : listaInsumosEmpleado() },
    'GET /api/admin/insumos/para-comprar': { status: 200, body: paraComprar() },
    'GET /api/admin/insumos/alertas': { status: 200, body: alertas(3) },
    ...extra,
  } as Parameters<typeof apiFalsa>[0];
}

function ponerVisibilidad(estado: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: estado, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('Campanita de stock bajo', () => {
  it('con insumos bajos muestra el número y lleva a Para comprar', async () => {
    apiFalsa(sesion('admin'));
    const { user } = renderApp('/insumos');
    const campanita = await screen.findByRole('link', { name: '3 insumos con stock bajo' });
    expect(campanita).toHaveAttribute('href', '/insumos?ver=comprar');
    expect(campanita).toHaveTextContent('3');
    expect(campanita).toHaveAttribute('data-alerta');

    await user.click(campanita);
    expect(await screen.findByRole('link', { name: 'Para comprar' })).toHaveAttribute('aria-current', 'page');
  });

  it('con 1 usa el singular', async () => {
    apiFalsa(sesion('admin', { 'GET /api/admin/insumos/alertas': { status: 200, body: alertas(1) } }));
    renderApp('/insumos');
    expect(await screen.findByRole('link', { name: '1 insumo con stock bajo' })).toBeInTheDocument();
  });

  it('con 0 queda sin número y sin color de alerta', async () => {
    apiFalsa(sesion('admin', { 'GET /api/admin/insumos/alertas': { status: 200, body: alertas(0) } }));
    renderApp('/insumos');
    const campanita = await screen.findByRole('link', { name: 'Ningún insumo con stock bajo' });
    expect(campanita).toHaveTextContent('');
    expect(campanita).not.toHaveAttribute('data-alerta');
    expect(campanita.querySelector('.campanita-numero')).toBeNull();
  });

  it('el empleado no la ve y no se pide nada', async () => {
    const api = apiFalsa(sesion('empleado'));
    renderApp('/insumos');
    await screen.findByRole('heading', { name: 'Shampoo' });
    expect(screen.queryByRole('link', { name: /stock bajo|para comprar/i })).toBeNull();
    expect(api.de('GET', '/api/admin/insumos/alertas')).toHaveLength(0);
  });

  it('vuelve a contar cada minuto con la pestaña a la vista, nunca oculta, y al volver a ella', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const api = apiFalsa(
      sesion('admin', {
        'GET /api/admin/insumos/alertas': [
          { status: 200, body: alertas(1) },
          { status: 200, body: alertas(2) },
          { status: 200, body: alertas(3) },
        ],
      }),
    );
    renderApp('/insumos');
    await screen.findByRole('link', { name: '1 insumo con stock bajo' });
    const pedidos = () => api.de('GET', '/api/admin/insumos/alertas').length;
    expect(pedidos()).toBe(1);

    act(() => { vi.advanceTimersByTime(60_000); });
    expect(await screen.findByRole('link', { name: '2 insumos con stock bajo' })).toBeInTheDocument();
    expect(pedidos()).toBe(2);

    act(() => { ponerVisibilidad('hidden'); });
    act(() => { vi.advanceTimersByTime(5 * 60_000); });
    expect(pedidos()).toBe(2);

    act(() => { ponerVisibilidad('visible'); });
    expect(await screen.findByRole('link', { name: '3 insumos con stock bajo' })).toBeInTheDocument();
    expect(pedidos()).toBe(3);

    act(() => { vi.advanceTimersByTime(60_000); });
    await waitFor(() => { expect(pedidos()).toBe(4); });
  });

  it('si el pedido falla se queda con lo último, sin avisos en pantalla', async () => {
    apiFalsa(sesion('admin', { 'GET /api/admin/insumos/alertas': { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'No responde.' } } } }));
    renderApp('/insumos');
    const campanita = await screen.findByRole('link', { name: 'Insumos para comprar' });
    expect(campanita).not.toHaveAttribute('data-alerta');
    expect(screen.queryByText('No responde.')).toBeNull();
  });
});
