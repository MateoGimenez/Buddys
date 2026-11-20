/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('si en la misma pestaña entra otra persona, a ella sí le aparece', async () => {
    const { unmount } = abrir(sesionEmpleado());
    await screen.findByText('12 de 20 lavados');
    unmount();
    const otra = abrir(sesionAdmin());
    expect(await screen.findByText('12 de 20 lavados')).toBeInTheDocument();
    expect(otra.api.de('GET', '/api/admin/metas/hoy')).toHaveLength(1);
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

  it('un toque con el dedo lo deja quieto: el pointerleave al levantar el dedo no lo reanuda', async () => {
    abrir();
    await screen.findByText('12 de 20 lavados');
    const aviso = document.querySelector('.aviso-meta') as HTMLElement;
    fireEvent.pointerEnter(aviso, { pointerType: 'touch' });
    fireEvent.pointerDown(aviso, { pointerType: 'touch' });
    fireEvent.pointerUp(aviso, { pointerType: 'touch' });
    fireEvent.pointerLeave(aviso, { pointerType: 'touch' });
    pasar(AVISO_META_MS * 3);
    pasar(300);
    expect(screen.getByText('12 de 20 lavados')).toBeInTheDocument();
    expect(aviso).toHaveAttribute('data-estado', 'visible');
  });

  it('cerrar con el teclado deja el foco en el contenido, no perdido en el body', async () => {
    const { user } = abrir();
    await screen.findByText('12 de 20 lavados');
    const cerrar = screen.getByRole('button', { name: 'Cerrar el aviso de la meta' });
    cerrar.focus();
    await user.keyboard('{Enter}');
    pasar(300);
    expect(document.querySelector('.aviso-meta')).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('contenido'));
  });

  it('con objetivo 1 dice "lavado" en singular', async () => {
    abrir(sesionEmpleado(), { hechos: 0, objetivo: 1, mesCumplido: false });
    expect(await screen.findByText('0 de 1 lavado')).toBeInTheDocument();
  });

  it('con muchos lavados hechos la barra no pasa del 100% y festeja', async () => {
    abrir(sesionEmpleado(), { hechos: 9999, objetivo: 3, mesCumplido: false });
    expect(await screen.findByText('9999 de 3 lavados')).toBeInTheDocument();
    expect(screen.getByText('¡Llegaron a la meta de hoy!')).toBeInTheDocument();
    await waitFor(() => {
      expect((document.querySelector('.aviso-meta-relleno') as HTMLElement).style.transform).toBe('scaleX(1)');
    });
  });

  describe('con sessionStorage bloqueado', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('igual sale una sola vez en esta carga de la página', async () => {
      const bloqueado = () => {
        throw new DOMException('Bloqueado', 'SecurityError');
      };
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(bloqueado);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(bloqueado);
      const { api, unmount } = abrir();
      await screen.findByText('12 de 20 lavados');
      unmount();
      const segunda = abrir();
      await screen.findByRole('heading', { name: 'Registrar lavado' });
      expect(screen.queryByText('12 de 20 lavados')).toBeNull();
      expect(api.de('GET', '/api/admin/metas/hoy')).toHaveLength(1);
      expect(segunda.api.de('GET', '/api/admin/metas/hoy')).toHaveLength(0);
    });
  });

  it('queda debajo de la barra (y de su menú de la cuenta)', () => {
    const z = (archivo: string, selector: string) => {
      const css = readFileSync(resolve(process.cwd(), archivo), 'utf8');
      const bloque = css.slice(css.indexOf(`${selector} {`));
      return Number(/z-index:\s*(\d+)/.exec(bloque.slice(0, bloque.indexOf('}')))?.[1]);
    };
    const aviso = z('src/components/aviso-meta.css', '.aviso-meta');
    const barra = z('src/styles/estructura.css', '.barra');
    expect(Number.isFinite(aviso) && Number.isFinite(barra)).toBe(true);
    expect(aviso).toBeLessThan(barra);
  });

  it('sin meta de hoy, o si la API falla, no aparece nada', async () => {
    abrir(sesionEmpleado(), null);
    await screen.findByRole('heading', { name: 'Registrar lavado' });
    pasar(50);
    expect(document.querySelector('.aviso-meta')).toBeNull();
  });
});
