import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hoy, sumarDias } from '../lib/format';
import { apiFalsa } from './apiFalsa';
import { cajaAbierta, cajaCerrada, cierreDe, cierres, sesionMejoras } from './fixtures-finanzas';
import { planillaAdmin } from './fixtures';
import { renderApp } from './render';

const HOY = hoy();

// Formularios largos con user-event: con la máquina cargada pasan de los 5 s por defecto.
describe('Cierre de caja con arqueo', { timeout: 20_000 }, () => {
  it('muestra lo esperado, calcula la diferencia mientras se cuenta y cierra con PUT', async () => {
    const api = apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/caja': [{ status: 200, body: cajaAbierta(HOY) }, { status: 200, body: cajaCerrada(HOY) }],
      'GET /api/admin/caja/cierres': { status: 200, body: { cierres: [], total: 0 } },
      [`PUT /api/admin/caja/${HOY}`]: { status: 201, body: { cierre: cierreDe(HOY) } },
    });
    const { user } = renderApp('/caja');
    expect(await screen.findByRole('heading', { name: 'Cierre de caja' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Tendría que haber' })).toHaveTextContent('$ 181.000');
    // Lo cobrado sin forma de pago se avisa con el enlace a la planilla.
    expect(screen.getByRole('link', { name: 'Cargala en la planilla' })).toHaveAttribute('href', '/planilla');
    expect(screen.getByText('Todavía no contaste nada')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Efectivo (en la caja)'), '92500');
    expect(screen.getByLabelText('Efectivo (en la caja)')).toHaveValue('92.500');
    // Esperado 93.000 en efectivo: faltan 500 (en la casilla y en el total).
    expect(screen.getAllByText('Faltan $ 500')).toHaveLength(2);
    await user.type(screen.getByLabelText('Transferencia'), '16000');
    // -500 + 1.000 = sobran 500
    expect(screen.getByText('Sobran $ 500', { selector: '.diferencia-texto' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Transferencia'));
    await user.type(screen.getByLabelText('Transferencia'), '15500');
    expect(screen.getByText('Cierra justo', { selector: '.diferencia-texto' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Nota (opcional)'), 'Faltan 500 de cambio');
    await user.click(screen.getByRole('button', { name: 'Cerrar la caja' }));
    expect(await screen.findByRole('heading', { name: 'Caja cerrada' })).toBeInTheDocument();
    expect(api.de('PUT', `/api/admin/caja/${HOY}`).map((p) => p.body)).toEqual([
      { contado: { efectivo: 92500, transferencia: 15500 }, nota: 'Faltan 500 de cambio' },
    ]);
  });

  it('sin efectivo no manda nada', async () => {
    const api = apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/caja': { status: 200, body: cajaAbierta(HOY) },
      'GET /api/admin/caja/cierres': { status: 200, body: { cierres: [], total: 0 } },
    });
    const { user } = renderApp('/caja');
    await user.click(await screen.findByRole('button', { name: 'Cerrar la caja' }));
    expect(screen.getByText('Contá el efectivo de la caja (si no hay, poné 0).')).toBeInTheDocument();
    expect(api.de('PUT', '/api/admin/caja')).toHaveLength(0);
  });

  it('una caja cerrada se ve con la diferencia; el admin no la puede corregir ni reabrir', async () => {
    apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/caja': { status: 200, body: cajaCerrada(HOY, { cambiosDespues: true }) },
      'GET /api/admin/caja/cierres': { status: 200, body: cierres(HOY) },
    });
    renderApp('/caja');
    const cierre = (await screen.findByRole('heading', { name: 'Caja cerrada' })).closest('section') as HTMLElement;
    expect(within(cierre).getByText('Faltan $ 63.000', { selector: '.diferencia-texto' })).toBeInTheDocument();
    expect(within(cierre).getByText('Faltan 500 de cambio')).toBeInTheDocument();
    expect(within(cierre).getByText(/La cerró Ana/)).toBeInTheDocument();
    expect(within(cierre).getByText('Después de cerrar se cambió un lavado de este día')).toBeInTheDocument();
    expect(within(cierre).queryByRole('button', { name: 'Reabrir' })).toBeNull();
    expect(within(cierre).queryByRole('button', { name: 'Corregir el cierre' })).toBeNull();
    // Historial
    const historial = screen.getByRole('region', { name: 'Cierres anteriores' });
    expect(within(historial).getByRole('button', { name: /Faltan \$\s63\.000/ })).toBeInTheDocument();
  });

  it('el superadmin corrige el cierre (con lo contado de antes) y lo reabre', async () => {
    const api = apiFalsa({
      ...sesionMejoras('superadmin'),
      'GET /api/admin/caja': [
        { status: 200, body: cajaCerrada(HOY) },
        { status: 200, body: cajaCerrada(HOY) },
        { status: 200, body: cajaAbierta(HOY) },
      ],
      'GET /api/admin/caja/cierres': { status: 200, body: cierres(HOY) },
      [`PUT /api/admin/caja/${HOY}`]: { status: 200, body: { cierre: cierreDe(HOY) } },
      [`DELETE /api/admin/caja/${HOY}`]: { status: 204 },
    });
    const { user } = renderApp('/caja');
    await user.click(await screen.findByRole('button', { name: 'Corregir el cierre' }));
    expect(screen.getByLabelText('Efectivo (en la caja)')).toHaveValue('30.000');
    expect(screen.getByLabelText('Nota (opcional)')).toHaveValue('Faltan 500 de cambio');
    await user.click(screen.getByRole('button', { name: 'Guardar corrección' }));
    expect(await screen.findByText('Cierre corregido.')).toBeInTheDocument();
    expect(api.de('PUT', `/api/admin/caja/${HOY}`)[0]?.body).toEqual({
      contado: { efectivo: 30000, transferencia: 15000 },
      nota: 'Faltan 500 de cambio',
    });

    await user.click(await screen.findByRole('button', { name: 'Reabrir' }));
    await user.click(screen.getByRole('button', { name: 'Sí, reabrirla' }));
    expect(await screen.findByText('Caja reabierta: la podés volver a contar.')).toBeInTheDocument();
    expect(api.de('DELETE', `/api/admin/caja/${HOY}`)).toHaveLength(1);
    expect(await screen.findByRole('button', { name: 'Cerrar la caja' })).toBeInTheDocument();
  });

  it('si otra persona cerró primero (409), lo avisa y muestra el cierre que quedó', async () => {
    const api = apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/caja': [{ status: 200, body: cajaAbierta(HOY) }, { status: 200, body: cajaCerrada(HOY) }],
      'GET /api/admin/caja/cierres': { status: 200, body: { cierres: [], total: 0 } },
      [`PUT /api/admin/caja/${HOY}`]: { status: 409, body: { error: { code: 'CONFLICT', message: 'Esta caja ya está cerrada: solo el superadmin la puede corregir o reabrir.' } } },
    });
    const { user } = renderApp('/caja');
    await user.type(await screen.findByLabelText('Efectivo (en la caja)'), '1000');
    await user.click(screen.getByRole('button', { name: 'Cerrar la caja' }));
    expect(await screen.findByText('La caja ya estaba cerrada')).toBeInTheDocument();
    expect(screen.getByText(/otra persona cerró la caja de este día/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Caja cerrada' })).toBeInTheDocument();
    expect(api.de('GET', '/api/admin/caja?')).toHaveLength(2);
  });

  it('la planilla lleva a cerrar la caja de ese día', async () => {
    apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/lavados': { status: 200, body: planillaAdmin(HOY) },
    });
    renderApp('/planilla');
    expect(await screen.findByRole('link', { name: 'Contar y cerrar la caja' })).toHaveAttribute('href', `/caja?fecha=${HOY}`);
  });

  it('abre el día que viene en ?fecha= (el enlace de la planilla de un día pasado)', async () => {
    const ayer = sumarDias(HOY, -1);
    const api = apiFalsa({
      ...sesionMejoras('admin'),
      'GET /api/admin/caja': (p) => ({ status: 200, body: cajaAbierta(new URL(p.path, 'http://x').searchParams.get('fecha') ?? '') }),
      'GET /api/admin/caja/cierres': { status: 200, body: { cierres: [], total: 0 } },
    });
    renderApp(`/caja?fecha=${ayer}`);
    expect(await screen.findByLabelText('Fecha de la caja')).toHaveValue(ayer);
    expect(api.de('GET', '/api/admin/caja?')[0]?.path).toBe(`/api/admin/caja?fecha=${ayer}`);
  });

  it('el empleado no ve la caja ni puede entrar', async () => {
    const api = apiFalsa({ ...sesionMejoras('empleado') });
    renderApp('/caja');
    expect(await screen.findByRole('heading', { name: 'Registrar lavado' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Secciones' })).queryByRole('link', { name: 'Caja' })).toBeNull();
    expect(api.de('GET', '/api/admin/caja')).toHaveLength(0);
  });
});
