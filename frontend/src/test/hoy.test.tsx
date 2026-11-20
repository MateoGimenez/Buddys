import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hoy } from '../lib/format';
import { apiFalsa } from './apiFalsa';
import { planillaAdmin } from './fixtures';
import { enCurso, insumosConPocoStock, metaActual, sesion } from './fixtures-mejoras';
import { renderApp } from './render';


function rutasHoy() {
  return {
    'GET /api/admin/lavados': { status: 200, body: planillaAdmin(hoy()) },
    'GET /api/admin/metas/actual': { status: 200, body: metaActual() },
    'GET /api/admin/lavados/en-curso': { status: 200, body: enCurso(hoy()) },
    'GET /api/admin/insumos': { status: 200, body: insumosConPocoStock() },
  };
}

describe('Hoy', () => {
  it('el encargado entra a Hoy: cobrado contra la meta, autos en curso, sin monto y poco stock (sin ranking)', async () => {
    apiFalsa({ ...sesion('superadmin'), ...rutasHoy() });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Hoy', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('$ 72.000')).toBeInTheDocument();
    // Meta: 96.000 por día; faltan 24.000.
    expect(screen.getByRole('progressbar', { name: /meta por día/ })).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByText('$ 24.000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /1 para completar/ })).toHaveAttribute('href', '/planilla');

    const curso = screen.getByRole('region', { name: 'En el lavadero ahora' });
    expect(await within(curso).findByRole('link', { name: 'Avisar por WhatsApp' })).toBeInTheDocument();
    expect(within(curso).getByText('Listo', { selector: 'strong' })).toBeInTheDocument();

    // Sin ranking (contrato 2026-11-17_05): nadie compite en Hoy.
    expect(screen.queryByRole('region', { name: 'Quién lavó más hoy' })).not.toBeInTheDocument();
    expect(await screen.findByText('Se está terminando un insumo')).toBeInTheDocument();
  });

  it('sin autos en curso lo dice y ofrece anotar uno', async () => {
    apiFalsa({
      ...sesion('admin'),
      ...rutasHoy(),
      'GET /api/admin/lavados/en-curso': { status: 200, body: { ...enCurso(hoy()), lavados: [], resumen: { espera: 0, lavando: 0, listo: 0 } } },
    });
    renderApp('/hoy');
    expect(await screen.findByText('No hay autos esperando ni lavándose')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Anotar un auto' })).toHaveAttribute('href', '/registrar');
  });

  it('el empleado sigue entrando a Registrar y no tiene Hoy', async () => {
    apiFalsa({ ...sesion('empleado') });
    renderApp('/hoy');
    expect(await screen.findByRole('heading', { name: 'Registrar lavado' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Hoy' })).toBeNull();
  });
});
