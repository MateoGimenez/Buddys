import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiFalsa } from './apiFalsa';
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
