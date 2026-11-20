import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AVISO_META_MS, olvidarAvisoMeta } from '../lib/avisoMeta';
import { apiFalsa } from './apiFalsa';
import { renderApp } from './render';
import { sesionAdmin, sesionEmpleado } from './sesiones';

// Contrato: reportes/2026-11-19_09_meta-de-hoy.md.

function metaHoy(lavados: { hechos: number; objetivo: number; mesCumplido: boolean } | null) {
  return { 'GET /api/admin/metas/hoy': { status: 200, body: { fecha: '2026-10-16', lavados } } };
}

const abrir = (sesion = sesionEmpleado(), lavados: Parameters<typeof metaHoy>[0] = { hechos: 12, objetivo: 20, mesCumplido: false }) => {
  const api = apiFalsa({ ...sesion, ...metaHoy(lavados) });
  const r = renderApp('/registrar', { advanceTimers: vi.advanceTimersByTime });
  return { api, ...r };
};

const pasar = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('aviso de la meta de hoy', () => {
  beforeEach(() => {
    olvidarAvisoMeta();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('el empleado ve "Meta de hoy: 12 de 20 lavados" (sin pesos) y el aviso se va solo a los 3 segundos', async () => {
    abrir();
    const cifra = await screen.findByText('12 de 20 lavados');
    const aviso = cifra.closest('.aviso-meta');
    expect(aviso).toHaveAttribute('role', 'status');
    expect(aviso).toHaveAttribute('aria-live', 'polite');
    expect(aviso).toHaveTextContent('Meta de hoy');
    expect(document.querySelector('.aviso-meta')?.textContent).not.toMatch(/\$/);
    // React arma el reloj del aviso en un efecto, un instante después de dibujarlo.
    await waitFor(() => {
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });
    pasar(AVISO_META_MS);
    pasar(300);
    expect(screen.queryByText('12 de 20 lavados')).toBeNull();
  });

  it('sale una vez por sesión: al volver a abrir el panel no se pide de nuevo', async () => {
    const { api, unmount } = abrir();
    await screen.findByText('12 de 20 lavados');
    unmount();
    const segunda = abrir();
    await screen.findByRole('heading', { name: 'Registrar lavado' });
    expect(screen.queryByText('12 de 20 lavados')).toBeNull();
    expect(api.de('GET', '/api/admin/metas/hoy')).toHaveLength(1);
    expect(segunda.api.de('GET', '/api/admin/metas/hoy')).toHaveLength(0);
  });

  it('se pausa con el puntero encima y con el foco adentro; sigue al salir', async () => {
    abrir();
    await screen.findByText('12 de 20 lavados');
    const aviso = document.querySelector('.aviso-meta') as HTMLElement;
    fireEvent.pointerEnter(aviso);
    pasar(AVISO_META_MS * 3);
    expect(screen.getByText('12 de 20 lavados')).toBeInTheDocument();
    fireEvent.pointerLeave(aviso);
    screen.getByRole('button', { name: 'Cerrar el aviso de la meta' }).focus();
    pasar(AVISO_META_MS * 3);
    expect(screen.getByText('12 de 20 lavados')).toBeInTheDocument();
    act(() => {
      (document.activeElement as HTMLElement).blur();
    });

    pasar(AVISO_META_MS);
    pasar(300);
    expect(screen.queryByText('12 de 20 lavados')).toBeNull();
  });

  it('el botón Cerrar lo saca enseguida', async () => {
    const { user } = abrir();
    await screen.findByText('12 de 20 lavados');
    await user.click(screen.getByRole('button', { name: 'Cerrar el aviso de la meta' }));
    pasar(300);
    expect(screen.queryByText('12 de 20 lavados')).toBeNull();
  });

  it('al 100% festeja con el sello; con el mes cumplido lo dice', async () => {
    abrir(sesionAdmin(), { hechos: 20, objetivo: 20, mesCumplido: false });
    expect(await screen.findByText('¡Llegaron a la meta de hoy!')).toBeInTheDocument();
    expect(document.querySelector('.aviso-meta-sello')).not.toBeNull();
  });

  it('con la meta del mes ya cumplida dice cuántos van hoy, sin barra', async () => {
    abrir(sesionAdmin(), { hechos: 1, objetivo: 0, mesCumplido: true });
    expect(await screen.findByText('¡Ya cumplieron la meta del mes!')).toBeInTheDocument();
    expect(screen.getByText('Hoy van 1 lavado.')).toBeInTheDocument();
    expect(document.querySelector('.aviso-meta-pista')).toBeNull();
  });

  it('sin meta de hoy, o si la API falla, no aparece nada', async () => {
    abrir(sesionEmpleado(), null);
    await screen.findByRole('heading', { name: 'Registrar lavado' });
    pasar(50);
    expect(document.querySelector('.aviso-meta')).toBeNull();
  });
});
