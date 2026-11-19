import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Presupuesto } from '../api/types';
import { apiFalsa } from './apiFalsa';
import { conStock, listaInsumos, permisosAdmin, usuarioAdmin } from './fixtures';
import { renderApp } from './render';

function sesion(extra: Record<string, unknown>) {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: usuarioAdmin } },
    'GET /api/admin/permisos': { status: 200, body: conStock(permisosAdmin()) },
    'GET /api/admin/insumos/alertas': { status: 200, body: { bajoStock: 0, insumos: [] } },
    ...extra,
  } as Parameters<typeof apiFalsa>[0];
}

function presupuesto(n: number): Presupuesto {
  return {
    id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
    numero: n,
    codigo: `P-${String(n).padStart(4, '0')}`,
    clienteNombre: `Cliente ${String(n)}`,
    clienteTelefono: null,
    vehiculo: null,
    items: [{ descripcion: 'Pulido', cantidad: 1, precioUnitario: 50000 }],
    descuento: 0,
    subtotal: 50000,
    total: 50000,
    validezDias: 15,
    venceEl: '2026-12-01',
    estado: 'borrador',
    vencido: false,
    notas: null,
    turnoId: null,
    creadoPor: null,
    createdAt: '2026-11-16T15:00:00.000Z',
    updatedAt: '2026-11-16T15:00:00.000Z',
  };
}

describe('Listas con tope: avisan cuando no entra todo', () => {
  it('Insumos: con total mayor que lo listado dice cuántos se muestran', async () => {
    apiFalsa(sesion({ 'GET /api/admin/insumos': { status: 200, body: { ...listaInsumos(), total: 130 } } }));
    renderApp('/insumos');
    expect(await screen.findByText('Se muestran 3 de 130 insumos.')).toBeInTheDocument();
  });

  it('Insumos: si entra todo, no dice nada', async () => {
    apiFalsa(sesion({ 'GET /api/admin/insumos': { status: 200, body: listaInsumos() } }));
    renderApp('/insumos');
    expect(await screen.findByText('Cera líquida')).toBeInTheDocument();
    expect(screen.queryByText(/Se muestran/)).toBeNull();
  });

  it('Presupuestos: con total mayor que lo listado dice cuántos se muestran', async () => {
    apiFalsa(sesion({ 'GET /api/admin/presupuestos': { status: 200, body: { presupuestos: [presupuesto(1), presupuesto(2)], total: 72 } } }));
    renderApp('/presupuestos');
    expect(await screen.findByText('Se muestran los 2 más recientes de 72.')).toBeInTheDocument();
  });

  it('Presupuestos: si entra todo, no dice nada', async () => {
    apiFalsa(sesion({ 'GET /api/admin/presupuestos': { status: 200, body: { presupuestos: [presupuesto(1)], total: 1 } } }));
    renderApp('/presupuestos');
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument();
    expect(screen.queryByText(/Se muestran/)).toBeNull();
  });
});
