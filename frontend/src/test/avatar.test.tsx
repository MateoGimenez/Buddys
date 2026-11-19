import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from '../components/Avatar';
import { iniciales, tonoDe, TONOS_AVATAR } from '../lib/avatar';
import { apiFalsa } from './apiFalsa';
import { ANA_ID, BETO_ID, CARLA_ID, equipo, permisosDueno, usuarioAdmin } from './fixtures';
import { renderApp } from './render';

const LUCIA_ID = '00000000-0000-4000-8000-0000000011c1';

describe('iniciales', () => {
  it('toma la primera y la última palabra del nombre, en mayúsculas', () => {
    expect(iniciales('Lucía Gómez', null)).toBe('LG');
    expect(iniciales('  juan  carlos   pérez ', null)).toBe('JP');
    expect(iniciales('Beto', 'beto@buddys.test')).toBe('B');
    expect(iniciales('Ángel', null)).toBe('Á');
  });

  it('sin nombre usa el email, y sin nada muestra "?"', () => {
    expect(iniciales(null, 'ana.perez@buddys.test')).toBe('AP');
    expect(iniciales('   ', 'dani@ejemplo.com')).toBe('D');
    expect(iniciales(null, null)).toBe('?');
  });
});

describe('tono del avatar', () => {
  it('es estable para el mismo id y cae siempre en la paleta de 8', () => {
    const ids = [ANA_ID, BETO_ID, CARLA_ID, LUCIA_ID, 'x', ''];
    for (const id of ids) {
      expect(tonoDe(id)).toBe(tonoDe(id));
      expect(tonoDe(id)).toBeGreaterThanOrEqual(1);
      expect(tonoDe(id)).toBeLessThanOrEqual(TONOS_AVATAR);
    }
    // No es un solo color para todos: el equipo de prueba usa más de un tono.
    expect(new Set(ids.map(tonoDe)).size).toBeGreaterThan(1);
  });

  it('el color no cambia entre renders ni al cambiar el nombre', () => {
    const { container, rerender } = render(<Avatar persona={{ id: BETO_ID, nombre: 'Beto', email: null, fotoVersion: null }} />);
    const tono = container.querySelector('.avatar')?.getAttribute('data-tono');
    expect(tono).toBe(String(tonoDe(BETO_ID)));
    rerender(<Avatar persona={{ id: BETO_ID, nombre: 'Roberto Díaz', email: null, fotoVersion: null }} />);
    expect(container.querySelector('.avatar')?.getAttribute('data-tono')).toBe(tono);
    expect(container.textContent).toBe('RD');
  });
});

describe('Avatar', () => {
  it('sin foto muestra las iniciales, decorativo (el nombre va al lado)', () => {
    const { container } = render(<Avatar persona={{ id: ANA_ID, nombre: 'Ana', email: 'ana@buddys.test', fotoVersion: null }} />);
    const avatar = container.querySelector('.avatar') as HTMLElement;
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
    expect(avatar.textContent).toBe('A');
    expect(container.querySelector('img')).toBeNull();
  });

  it('con foto pide la imagen de la API con la versión, lazy y con tamaño fijo', () => {
    const version = '2026-11-17T13:00:00.000Z';
    const { container } = render(<Avatar persona={{ id: ANA_ID, nombre: 'Ana', email: null, fotoVersion: version }} tamano={32} />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`/api/admin/usuarios/${ANA_ID}/foto?v=${encodeURIComponent(version)}`);
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).toHaveAttribute('width', '32');
    expect(img).toHaveAttribute('height', '32');
  });

  it('si la imagen falla vuelve a las iniciales, y con una versión nueva la vuelve a intentar', () => {
    const persona = { id: ANA_ID, nombre: 'Ana Pérez', email: null, fotoVersion: '2026-11-17T13:00:00.000Z' };
    const { container, rerender } = render(<Avatar persona={persona} />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('AP');

    rerender(<Avatar persona={{ ...persona, fotoVersion: '2026-11-17T14:00:00.000Z' }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toContain('v=2026-11-17T14');
  });
});

describe('Equipo: avatar en cada fila', () => {
  it('cada persona tiene su avatar: foto si tiene, iniciales si no', async () => {
    const lista = equipo('ana');
    const version = '2026-11-17T12:00:00.000Z';
    lista.usuarios = lista.usuarios.map((u) => (u.id === LUCIA_ID ? { ...u, fotoVersion: version } : u));
    apiFalsa({
      'GET /api/auth/me': { status: 200, body: { usuario: usuarioAdmin } },
      'GET /api/admin/permisos': { status: 200, body: permisosDueno() },
      'GET /api/admin/usuarios': { status: 200, body: lista },
    });
    renderApp('/equipo');
    const lucia = (await screen.findByRole('heading', { name: /^Lucía Gómez/ })).closest('li') as HTMLElement;
    expect(lucia.querySelector('.avatar img')?.getAttribute('src')).toBe(`/api/admin/usuarios/${LUCIA_ID}/foto?v=${encodeURIComponent(version)}`);

    const beto = screen.getByRole('heading', { name: /^Beto/ }).closest('li') as HTMLElement;
    expect(beto.querySelector('.avatar img')).toBeNull();
    expect(beto.querySelector('.avatar')?.textContent).toBe('B');
    // El avatar no se suma al nombre que lee el lector de pantalla.
    expect(within(beto).getByRole('heading').textContent).toMatch(/^Beto/);
  });
});
