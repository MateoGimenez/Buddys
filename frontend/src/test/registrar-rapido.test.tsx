import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { normalizarPatente, patenteEn, tipoDePatente } from '../lib/patente';
import { apiFalsa } from './apiFalsa';
import { ANA_ID, BETO_ID, catalogoBuddys, registrado } from './fixtures';
import { renderApp } from './render';
import { sesionAdmin, sesionEmpleado } from './sesiones';

const monto = () => screen.getByLabelText('Cuánto se cobró');
const conCatalogo = (sesion: Record<string, unknown>) => ({ ...sesion, 'GET /api/admin/servicios': { status: 200, body: catalogoBuddys() } });

describe('Registrar más rápido', () => {
  it('recuerda el último vehículo elegido en este celular, por usuario', async () => {
    apiFalsa(conCatalogo(sesionAdmin()));
    const primera = renderApp('/registrar');
    await primera.user.click(await screen.findByRole('radio', { name: 'Moto' }));
    primera.unmount();

    renderApp('/registrar');
    expect(await screen.findByRole('radio', { name: 'Moto' })).toBeChecked();
    expect(JSON.parse(localStorage.getItem(`buddys.registrar.v1.${ANA_ID}`) ?? '{}')).toMatchObject({ vehiculo: 'moto' });
    // Otro usuario en el mismo celular arranca como siempre.
    expect(localStorage.getItem(`buddys.registrar.v1.${BETO_ID}`)).toBeNull();
  });

  it('el admin repite el último: vuelven vehículo, servicios y monto, y el foco queda en Registrar', async () => {
    apiFalsa({
      ...conCatalogo(sesionAdmin()),
      'POST /api/admin/lavados': { status: 201, body: registrado({ servicioId: 'nivel-2', monto: 60000 }) },
    });
    const { user } = renderApp('/registrar');
    expect(screen.queryByRole('button', { name: /Repetir el último/ })).toBeNull();
    await user.click(await screen.findByRole('radio', { name: 'SUV' }));
    await user.click(screen.getByRole('checkbox', { name: /Nivel II\b(?!I)/ }));
    await user.click(screen.getByRole('checkbox', { name: /Motor/ }));
    await user.clear(monto());
    await user.type(monto(), '60000');
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    await screen.findByText('Lavado registrado');

    // El formulario quedó limpio; "Repetir el último" lo vuelve a cargar.
    await user.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(screen.getByRole('checkbox', { name: /Nivel II\b(?!I)/ })).not.toBeChecked();
    const repetir = screen.getByRole('button', { name: /Repetir el último/ });
    expect(repetir).toHaveTextContent('Nivel II + Motor · SUV · $ 60.000');
    await user.click(repetir);
    expect(screen.getByRole('radio', { name: 'SUV' })).toBeChecked();
    const servicios = screen.getByRole('group', { name: 'Servicios' });
    expect(within(servicios).getByRole('checkbox', { name: /Nivel II\b(?!I)/ })).toBeChecked();
    expect(within(servicios).getByRole('checkbox', { name: /Motor/ })).toBeChecked();
    expect(monto()).toHaveValue('60.000');
    const boton = screen.getByRole('button', { name: 'Registrar lavado' });
    await expect.poll(() => document.activeElement).toBe(boton);
    expect(boton).toHaveAccessibleDescription(/Precargado: Nivel II \+ Motor, SUV/);
  });

  it('el empleado repite el último sin monto (nunca queda guardado un importe suyo)', async () => {
    apiFalsa({
      ...conCatalogo(sesionEmpleado()),
      'POST /api/admin/lavados': { status: 201, body: registrado({ servicioId: 'nivel-1', monto: null, trabajador: { id: BETO_ID, nombre: 'Beto' } }) },
    });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Nivel I\b(?!I)/ }));
    await user.type(monto(), '25000');
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    await screen.findByText('Lavado registrado');
    expect(JSON.parse(localStorage.getItem(`buddys.registrar.v1.${BETO_ID}`) ?? '{}')).toMatchObject({ ultimo: { monto: null } });

    const repetir = screen.getByRole('button', { name: /Repetir el último/ });
    expect(repetir).not.toHaveTextContent('$');
    await user.click(repetir);
    expect(screen.getByRole('checkbox', { name: /Nivel I\b(?!I)/ })).toBeChecked();
    expect(monto()).toHaveValue('');
  });

  it('si el último tenía servicios que ya no se ofrecen, no se ofrece repetirlo', async () => {
    localStorage.setItem(
      `buddys.registrar.v1.${ANA_ID}`,
      JSON.stringify({ ultimo: { vehiculo: 'auto', servicioIds: ['no-existe'], servicio: 'Viejo', monto: null } }),
    );
    apiFalsa(conCatalogo(sesionAdmin()));
    renderApp('/registrar');
    await screen.findByRole('group', { name: 'Servicios' });
    expect(screen.queryByRole('button', { name: /Repetir el último/ })).toBeNull();
  });
});

describe('Patente', () => {
  it('reconoce los formatos argentinos', () => {
    expect(tipoDePatente('AA123BB')).toBe('mercosur');
    expect(tipoDePatente('abc 123')).toBe('vieja');
    expect(tipoDePatente('A123BCD')).toBe('moto');
    expect(tipoDePatente('123-abc')).toBe('moto-vieja');
    expect(tipoDePatente('Gol Trend')).toBeNull();
    expect(tipoDePatente('AB1234')).toBeNull();
  });

  it('ordena la patente y no rompe el modelo', () => {
    expect(normalizarPatente(' ab 123 cd ')).toBe('AB123CD');
    expect(normalizarPatente('Gol Trend ab-123-cd')).toBe('Gol Trend AB123CD');
    expect(normalizarPatente('abc123 Fiesta')).toBe('ABC123 Fiesta');
    expect(normalizarPatente('Gol   Trend')).toBe('Gol Trend');
    expect(normalizarPatente('')).toBe('');
    expect(patenteEn('Hilux AE 456 FG')).toEqual({ patente: 'AE456FG', tipo: 'mercosur' });
  });

  it('en Registrar avisa si no parece una patente pero manda igual lo escrito, con la patente ordenada', async () => {
    const api = apiFalsa({
      ...conCatalogo(sesionAdmin()),
      'POST /api/admin/lavados': { status: 201, body: registrado({ servicioId: 'nivel-1', vehiculoModelo: 'Gol AB123CD' }) },
    });
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('checkbox', { name: /Nivel I\b(?!I)/ }));
    await user.click(screen.getByText('Más datos'));
    const patente = screen.getByLabelText('Patente');
    await user.type(patente, 'Gol Trend');
    expect(patente).toHaveAccessibleDescription(/No parece una patente/);
    expect(patente).not.toHaveAttribute('aria-invalid');

    await user.clear(patente);
    await user.type(patente, 'gol ab 123 cd');
    await user.tab();
    expect(patente).toHaveValue('gol AB123CD');
    expect(patente).toHaveAccessibleDescription('Patente Mercosur: AB123CD.');
    await user.click(screen.getByRole('button', { name: 'Registrar lavado' }));
    await screen.findByText('Lavado registrado');
    expect(api.de('POST', '/api/admin/lavados')[0]?.body).toMatchObject({ vehiculoModelo: 'gol AB123CD' });
  });
});
