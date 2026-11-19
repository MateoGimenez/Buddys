import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hoy, primeroDelMes } from '../lib/format';
import { problemaDelRango } from '../lib/descarga';
import { apiFalsa } from './apiFalsa';
import { fx } from './fixtures';
import { gastosFijosLista, resp, sesionMejoras } from './fixtures-finanzas';
import { renderApp } from './render';

const HOY = hoy();
const DESDE = primeroDelMes(HOY);
let descargados: string[] = [];

beforeEach(() => {
  descargados = [];
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:falso'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    descargados.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const csv = { status: 200, body: '﻿Fecha;Monto\r\n' };
const estadisticas = () => ({
  'GET /api/admin/estadisticas': fx.estadisticasConFijos as { status: number; body: unknown },
  'GET /api/admin/metas/actual': fx.metasActual as { status: number; body: unknown },
});

// Formularios largos con user-event: con la máquina cargada pasan de los 5 s por defecto.
describe('Exportar a Excel (CSV)', { timeout: 20_000 }, () => {
  it('desde Números baja la planilla, los gastos y las estadísticas del período, con la sesión', async () => {
    const api = apiFalsa({
      ...sesionMejoras('admin'),
      ...estadisticas(),
      'GET /api/admin/exportar/planilla.csv': csv,
      'GET /api/admin/exportar/estadisticas.csv': csv,
    });
    const { user } = renderApp('/numeros');
    const bloque = (await screen.findByRole('heading', { name: 'Bajar el período para Excel' })).closest('section') as HTMLElement;
    expect(within(bloque).getByRole('button', { name: 'Descargar la planilla en Excel (CSV)' })).toBeInTheDocument();
    expect(within(bloque).getByRole('button', { name: 'Descargar los gastos en Excel (CSV)' })).toBeInTheDocument();
    await user.click(within(bloque).getByRole('button', { name: 'Descargar la planilla en Excel (CSV)' }));
    expect(await within(bloque).findByText(/quedó en Descargas/)).toBeInTheDocument();
    await user.click(within(bloque).getByRole('button', { name: 'Descargar las estadísticas en Excel (CSV)' }));
    await within(bloque).findByText(/estadisticas.*quedó en Descargas/);

    expect(api.de('GET', '/api/admin/exportar/planilla.csv')[0]?.path).toBe(`/api/admin/exportar/planilla.csv?desde=${DESDE}&hasta=${HOY}`);
    expect(api.de('GET', '/api/admin/exportar/estadisticas.csv')).toHaveLength(1);
    expect(descargados).toEqual([`buddys-planilla-${DESDE}-a-${HOY}.csv`, `buddys-estadisticas-${DESDE}-a-${HOY}.csv`]);
  });

  it('desde Gastos baja los gastos del mes', async () => {
    const api = apiFalsa({
      ...sesionMejoras('superadmin'),
      'GET /api/admin/gastos': { status: 200, body: { gastos: [], total: 0, suma: 0 } },
      'GET /api/admin/gastos-fijos': { status: 200, body: gastosFijosLista() },
      'GET /api/admin/exportar/gastos.csv': csv,
    });
    const { user } = renderApp('/gastos');
    await user.click(await screen.findByRole('button', { name: 'Descargar los gastos en Excel (CSV)' }));
    await screen.findByText(/quedó en Descargas/);
    expect(api.de('GET', '/api/admin/exportar/gastos.csv')[0]?.path).toBe(`/api/admin/exportar/gastos.csv?desde=${DESDE}&hasta=${HOY}`);
  });

  it('si el backend no deja (403), muestra el mensaje y no descarga', async () => {
    apiFalsa({ ...sesionMejoras('admin'), ...estadisticas(), 'GET /api/admin/exportar/planilla.csv': resp('error403ExportarEmpleado') });
    const { user } = renderApp('/numeros');
    await user.click(await screen.findByRole('button', { name: 'Descargar la planilla en Excel (CSV)' }));
    expect(await screen.findByText('Con tu rol no podés exportar: los archivos llevan importes.')).toBeInTheDocument();
    expect(descargados).toEqual([]);
  });

  it('el empleado no ve ningún botón de exportar ni importes en Números', async () => {
    const api = apiFalsa({
      ...sesionMejoras('empleado'),
      'GET /api/admin/estadisticas/mias': fx.misTrabajos as { status: number; body: unknown },
    });
    renderApp('/numeros');
    expect(await screen.findByRole('heading', { name: 'Tus lavados' })).toBeInTheDocument();
    await screen.findByText(/entre el/);
    expect(screen.queryByRole('button', { name: /Excel/ })).toBeNull();
    expect(screen.getByRole('main').textContent).not.toMatch(/\$/);
    expect(api.de('GET', '/api/admin/exportar')).toHaveLength(0);
  });

  it('valida el rango: hasta un año y en orden', () => {
    expect(problemaDelRango('2026-01-01', '2026-12-31')).toBeNull();
    expect(problemaDelRango('2025-01-01', '2026-01-02')).toMatch(/366 días/);
    expect(problemaDelRango('2026-02-01', '2026-01-01')).toMatch(/posterior/);
  });
});
