import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { agrupar, SECCIONES } from '../components/Layout';
import { apiFalsa } from './apiFalsa';
import { renderApp } from './render';
import { sesionAdmin, sesionEmpleado } from './sesiones';

// Contrato: reportes/2026-11-19_08_mas-por-secciones.md.

/** Los grupos de Más como se ven: [título, [secciones]]. */
function gruposDeMas(): [string, string[]][] {
  const nav = screen.getByRole('navigation', { name: 'Otras secciones' });
  return within(nav)
    .getAllByRole('region')
    .map((grupo) => [
      within(grupo).getByRole('heading', { level: 2 }).textContent,
      within(grupo)
        .getAllByRole('link')
        .map((a) => a.querySelector('.menu-nombre')?.textContent ?? ''),
    ]);
}

describe('Más agrupado por secciones', () => {
  it('cada sección que no es principal tiene un grupo', () => {
    expect(SECCIONES.filter((s) => !s.principal && !s.grupo).map((s) => s.ruta)).toEqual([]);
  });

  it('el dueño ve los tres grupos, en orden, con sus secciones', async () => {
    apiFalsa(sesionAdmin());
    renderApp('/mas');
    await screen.findByRole('heading', { name: 'Atención', level: 2 });
    expect(gruposDeMas()).toEqual([
      ['Atención', ['Agenda', 'Clientes']],
      ['Plata', ['Caja', 'Gastos', 'Presupuestos']],
      ['Taller', ['Servicios', 'Insumos', 'Equipo']],
    ]);
  });

  it('el empleado no ve grupos vacíos ni secciones que su rol no tiene', async () => {
    apiFalsa(sesionEmpleado());
    renderApp('/mas');
    await screen.findByRole('heading', { name: 'Atención', level: 2 });
    const grupos = gruposDeMas();
    expect(grupos.map(([titulo]) => titulo)).not.toContain('Plata');
    expect(grupos.flatMap(([, secciones]) => secciones)).not.toContain('Gastos');
    for (const [, secciones] of grupos) expect(secciones.length).toBeGreaterThan(0);
  });

  it('agrupar deja afuera las principales y los grupos vacíos', () => {
    const soloPrincipales = SECCIONES.filter((s) => s.principal);
    expect(agrupar(soloPrincipales)).toEqual([]);
    expect(agrupar(SECCIONES).map((g) => g.id)).toEqual(['atencion', 'plata', 'taller']);
  });

  it('el riel de escritorio usa los mismos grupos', async () => {
    apiFalsa(sesionAdmin());
    renderApp('/mas');
    const riel = await screen.findByRole('navigation', { name: 'Secciones' });
    const listas = within(riel).getAllByRole('list');
    // La primera lista son las principales (sin título); después, una por grupo.
    expect(listas.slice(1).map((l) => l.getAttribute('aria-labelledby'))).toEqual(['riel-atencion', 'riel-plata', 'riel-taller']);
    expect(within(listas[2] as HTMLElement).getAllByRole('link').map((a) => a.textContent)).toEqual(['Caja', 'Gastos', 'Presupuestos']);
  });
});
