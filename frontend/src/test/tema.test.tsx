/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiFalsa } from './apiFalsa';
import { COLOR_BARRA } from '../lib/tema';
import { renderApp } from './render';
import { sesionEmpleado } from './sesiones';

describe('cómo se ve la pantalla (Más)', () => {
  it('el empleado elige Alto contraste: se aplica en <html> y queda guardado', async () => {
    apiFalsa(sesionEmpleado());
    const { user } = renderApp('/mas');
    const auto = await screen.findByRole('radio', { name: /Automático/ });
    expect(auto).toBeChecked();
    expect(document.documentElement).not.toHaveAttribute('data-tema');

    await user.click(screen.getByRole('radio', { name: /Alto contraste/ }));
    expect(document.documentElement).toHaveAttribute('data-tema', 'contraste');
    expect(localStorage.getItem('buddys.tema.v1')).toBe('contraste');

    await user.click(screen.getByRole('radio', { name: /Automático/ }));
    expect(document.documentElement).not.toHaveAttribute('data-tema');
    expect(localStorage.getItem('buddys.tema.v1')).toBeNull();
  });

  it('si el celular no deja guardar, el tema igual se pone y avisa', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError');
    });
    apiFalsa(sesionEmpleado());
    const { user } = renderApp('/mas');
    await user.click(await screen.findByRole('radio', { name: /Oscuro/ }));
    expect(document.documentElement).toHaveAttribute('data-tema', 'oscuro');
    expect(screen.getByText('Este celular no deja guardarlo')).toBeInTheDocument();
  });
});

describe('cómo se ve la pantalla (menú de la cuenta)', () => {
  const botonCuenta = () => screen.findByRole('button', { name: /Beto/ });

  it('el tema está en el menú de la cuenta como opciones de radio: elegir lo aplica, lo guarda y no cierra el menú', async () => {
    apiFalsa(sesionEmpleado());
    const { user } = renderApp('/registrar');
    await user.click(await botonCuenta());

    const grupo = screen.getByRole('group', { name: 'Cómo se ve' });
    const opciones = within(grupo).getAllByRole('menuitemradio');
    expect(opciones.map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^Automático/),
      'Claro',
      'Oscuro',
      expect.stringMatching(/^Alto contraste/),
    ]);
    expect(within(grupo).getByRole('menuitemradio', { name: /Automático/ })).toHaveAttribute('aria-checked', 'true');

    await user.click(within(grupo).getByRole('menuitemradio', { name: 'Oscuro' }));
    expect(document.documentElement).toHaveAttribute('data-tema', 'oscuro');
    expect(localStorage.getItem('buddys.tema.v1')).toBe('oscuro');
    // El menú sigue abierto y marca lo elegido.
    expect(within(grupo).getByRole('menuitemradio', { name: 'Oscuro' })).toHaveAttribute('aria-checked', 'true');
    expect(within(grupo).getByRole('menuitemradio', { name: /Automático/ })).toHaveAttribute('aria-checked', 'false');

    await user.click(within(grupo).getByRole('menuitemradio', { name: /Automático/ }));
    expect(document.documentElement).not.toHaveAttribute('data-tema');
    expect(localStorage.getItem('buddys.tema.v1')).toBeNull();
  });

  it('las flechas recorren también las opciones del tema', async () => {
    apiFalsa(sesionEmpleado());
    const { user } = renderApp('/registrar');
    (await botonCuenta()).focus();
    await user.keyboard('{ArrowDown}');
    // Mi perfil, las 4 opciones del tema y Cerrar sesión.
    expect(screen.getByRole('menuitem', { name: 'Mi perfil' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: /Automático/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Cerrar sesión' })).toHaveFocus();
  });

  it('si el celular no deja guardar, el tema igual se pone y lo dice', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError');
    });
    apiFalsa(sesionEmpleado());
    const { user } = renderApp('/registrar');
    await user.click(await botonCuenta());
    await user.click(screen.getByRole('menuitemradio', { name: /Alto contraste/ }));
    expect(document.documentElement).toHaveAttribute('data-tema', 'contraste');
    expect(screen.getByRole('status')).toHaveTextContent('Este celular no deja guardarlo');
  });
});

describe('color de la barra del sistema (theme-color)', () => {
  it('COLOR_BARRA, tema-inicial.js y --nav-fondo de tokens.css dicen lo mismo', () => {
    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    const inicial = readFileSync(resolve(process.cwd(), 'public/tema-inicial.js'), 'utf8');
    const par = /--nav-fondo:\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/i.exec(tokens);
    const contraste = /tema:contraste[\s\S]*?--nav-fondo:\s*(#[0-9a-f]{6})/i.exec(tokens);
    expect([par?.[1], par?.[2], contraste?.[1]]).toEqual([COLOR_BARRA.claro, COLOR_BARRA.oscuro, COLOR_BARRA.contraste]);
    for (const color of Object.values(COLOR_BARRA)) expect(inicial).toContain(`'${color}'`);
  });

  it('elegir un tema pinta la barra del sistema con un color de verdad (no un light-dark sin resolver)', async () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
    apiFalsa(sesionEmpleado());
    const { user } = renderApp('/mas');
    await user.click(await screen.findByRole('radio', { name: /Oscuro/ }));
    expect(meta.content).toBe(COLOR_BARRA.oscuro);
    await user.click(screen.getByRole('radio', { name: /Alto contraste/ }));
    expect(meta.content).toBe(COLOR_BARRA.contraste);
    meta.remove();
  });
});
