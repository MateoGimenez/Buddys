import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Turno } from '../api/types';
import { hoy } from '../lib/format';
import { apiFalsa } from './apiFalsa';
import { BETO_ID, planillaAdmin, registrado } from './fixtures';
import { lavadoEnEspera, lavadoListo, sesion } from './fixtures-mejoras';
import { renderApp } from './render';


/** La planilla de hoy con un solo lavado: el del contrato que quedó En espera. */
function diaCon(l: Turno) {
  const p = planillaAdmin(hoy());
  return { ...p, lavados: [{ ...l, fechaPreferida: hoy() }] };
}

describe('Etapas del auto', () => {
  it('en la planilla se avanza de En espera a Lavando con un toque y se puede deshacer', async () => {
    const espera = lavadoEnEspera().lavado;
    const lavando = { ...espera, etapa: 'lavando' as const };
    const api = apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/lavados': { status: 200, body: diaCon(espera) },
      [`PATCH /api/admin/lavados/${espera.id}/etapa`]: [
        { status: 200, body: { lavado: lavando } },
        { status: 200, body: { lavado: espera } },
      ],
    });
    const { user } = renderApp('/planilla');
    const avanzar = await screen.findByRole('button', { name: 'Empezar a lavar' });
    expect(screen.getByRole('list', { name: 'Etapas del auto' })).toBeInTheDocument();
    await user.click(avanzar);
    expect(await screen.findByRole('button', { name: 'Marcar listo' })).toBeInTheDocument();
    expect(api.de('PATCH', `/api/admin/lavados/${espera.id}/etapa`)[0]?.body).toEqual({ etapa: 'lavando' });

    await user.click(screen.getByRole('button', { name: 'Deshacer: volver a En espera' }));
    expect(await screen.findByRole('button', { name: 'Empezar a lavar' })).toBeInTheDocument();
    expect(api.de('PATCH', `/api/admin/lavados/${espera.id}/etapa`)[1]?.body).toEqual({ etapa: 'espera' });
    expect(screen.queryByRole('button', { name: /Deshacer/ })).toBeNull();
  });

  it('con el auto listo ofrece "Avisar por WhatsApp" con el link que da la API', async () => {
    const listo = lavadoListo();
    apiFalsa({ ...sesion('superadmin'), 'GET /api/admin/lavados': { status: 200, body: diaCon(listo) } });
    renderApp('/planilla');
    const link = await screen.findByRole('link', { name: 'Avisar por WhatsApp' });
    expect(link).toHaveAttribute('href', listo.whatsappListo);
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('button', { name: 'Entregar' })).toBeInTheDocument();
  });

  it('el empleado mueve sus autos pero no los de otro (y ve el estado igual)', async () => {
    const suyo = { ...lavadoEnEspera().lavado, trabajador: { id: BETO_ID, nombre: 'Beto' } };
    const ajeno = { ...suyo, id: 'otro', trabajador: { id: 'alguien', nombre: 'Ana' } };
    apiFalsa({
      ...sesion('empleado'),
      'GET /api/admin/lavados': { status: 200, body: { ...diaCon(suyo), lavados: [suyo, ajeno].map((l) => ({ ...l, monto: null })) } },
    });
    renderApp('/planilla');
    const listas = await screen.findAllByRole('list', { name: 'Etapas del auto' });
    expect(listas).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Empezar a lavar' })).toHaveLength(1);
  });

  it('el error de la API se muestra y el auto queda donde estaba', async () => {
    const espera = lavadoEnEspera().lavado;
    apiFalsa({
      ...sesion('superadmin'),
      'GET /api/admin/lavados': { status: 200, body: diaCon(espera) },
      [`PATCH /api/admin/lavados/${espera.id}/etapa`]: {
        status: 403,
        body: { error: { code: 'FORBIDDEN', message: 'Solo podés cambiar la etapa de tus lavados.' } },
      },
    });
    const { user } = renderApp('/planilla');
    await user.click(await screen.findByRole('button', { name: 'Empezar a lavar' }));
    expect(await screen.findByText('Solo podés cambiar la etapa de tus lavados.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Empezar a lavar' })).toBeInTheDocument();
  });

  it('en Registrar, "Recién llega" manda etapa espera y el talón lo dice', async () => {
    const api = apiFalsa({
      ...sesion('superadmin'),
      'POST /api/admin/lavados': { status: 201, body: registrado({ etapa: 'espera' }) },
    });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Lavado Básico/ }));
    await user.click(screen.getByRole('radio', { name: 'Recién llega' }));
    await user.click(screen.getByRole('button', { name: 'Anotar auto que llega' }));
    expect(await screen.findByText('Auto anotado: queda En espera')).toBeInTheDocument();
    expect(api.de('POST', '/api/admin/lavados')[0]?.body).toMatchObject({ etapa: 'espera' });
  });

  it('por defecto es "Ya terminado" y no manda etapa', async () => {
    const api = apiFalsa({ ...sesion('superadmin'), 'POST /api/admin/lavados': { status: 201, body: registrado({}) } });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Lavado Básico/ }));
    expect(screen.getByRole('radio', { name: 'Ya terminado' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    await screen.findByText('Lavado registrado');
    expect(api.de('POST', '/api/admin/lavados')[0]?.body).not.toHaveProperty('etapa');
    const talon = screen.getByText('Lavado registrado').closest('.talon');
    expect(talon && within(talon as HTMLElement).queryByText(/En espera/)).toBeNull();
  });
});
