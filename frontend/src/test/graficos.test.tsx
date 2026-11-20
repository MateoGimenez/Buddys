import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Barras } from '../components/Barras';
import { BarrasDivergentes } from '../components/BarrasDivergentes';
import { BarrasHorizontales } from '../components/BarrasHorizontales';

// Contrato: reportes/2026-11-19_10_graficos.md. Cada gráfico tiene su tabla para el lector de pantalla.

const filasDe = (tabla: HTMLElement) =>
  within(tabla)
    .getAllByRole('row')
    .map((f) => Array.from(f.querySelectorAll('th, td')).map((c) => c.textContent));

describe('Barras (una serie en el tiempo)', () => {
  const dias = [
    { clave: '2026-11-13', valor: 2 }, // viernes
    { clave: '2026-11-14', valor: 1 },
    { clave: '2026-11-16', valor: 4 }, // lunes
    { clave: '2026-11-19', valor: 3 },
  ];

  it('agrupable: elige día, semana o mes y la tabla accesible lo sigue', async () => {
    const user = userEvent.setup();
    render(<Barras titulo="Lavados" agrupable puntos={dias} formato={(v) => `${String(v)} lavados`} />);
    const tabla = screen.getByRole('table', { name: /Lavados, por día/ });
    expect(filasDe(tabla)).toHaveLength(4);

    await user.click(screen.getByRole('radio', { name: 'Semana' }));
    expect(filasDe(screen.getByRole('table', { name: /Lavados, por semana/ }))).toEqual([
      ['Semana del 9 nov', '3 lavados'],
      ['Semana del 16 nov', '7 lavados'],
    ]);

    await user.click(screen.getByRole('radio', { name: 'Mes' }));
    expect(filasDe(screen.getByRole('table', { name: /Lavados, por mes/ }))).toEqual([['noviembre de 2026', '10 lavados']]);
  });

  it('una serie que ya viene por mes no ofrece día ni semana', () => {
    render(<Barras titulo="Ingresos" agrupable puntos={[{ clave: '2026-10', valor: 5 }, { clave: '2026-11', valor: 7 }]} formato={String} />);
    expect(screen.queryByRole('radio', { name: 'Semana' })).toBeNull();
    expect(filasDe(screen.getByRole('table'))).toHaveLength(2);
  });
});

describe('BarrasHorizontales', () => {
  it('la tabla accesible lleva cada valor y la marca del mínimo', () => {
    render(
      <BarrasHorizontales
        titulo="Cuánto queda de cada uno"
        columnas={['Insumo', 'Queda']}
        maximo={1}
        filas={[
          { id: 'a', nombre: 'Shampoo', valor: 0.25, texto: '0,5 litros · mín. 1', marca: { valor: 0.5, texto: 'el mínimo es 1 litro' }, alerta: true },
          { id: 'b', nombre: 'Cera', valor: 0.9, texto: '900 ml · mín. 500' },
        ]}
      />,
    );
    const tabla = screen.getByRole('table', { name: 'Cuánto queda de cada uno' });
    expect(filasDe(tabla)).toEqual([
      ['Insumo', 'Queda'],
      ['Shampoo', '0,5 litros · mín. 1 (el mínimo es 1 litro)'],
      ['Cera', '900 ml · mín. 500'],
    ]);
    // La barra visible no se lee dos veces: la lista dibujada está oculta para el lector.
    expect(document.querySelector('.barras-h-lista')).toHaveAttribute('aria-hidden', 'true');
    const relleno = document.querySelector<HTMLElement>('.barras-h-fila[data-alerta] .barras-h-relleno');
    expect(relleno?.style.inlineSize).toBe('25%');
  });
});

describe('BarrasDivergentes', () => {
  it('lo que faltó, lo que sobró y lo justo, siempre con su texto (nunca solo el color)', () => {
    render(
      <BarrasDivergentes
        titulo="Diferencia de cada cierre"
        filas={[
          { id: '1', nombre: '17 nov', valor: -500, texto: 'Faltan $ 500' },
          { id: '2', nombre: '18 nov', valor: 0, texto: 'Cierra justo' },
          { id: '3', nombre: '19 nov', valor: 1000, texto: 'Sobran $ 1.000' },
        ]}
      />,
    );
    expect(filasDe(screen.getByRole('table', { name: 'Diferencia de cada cierre' }))).toEqual([
      ['17 nov', 'Faltan $ 500'],
      ['18 nov', 'Cierra justo'],
      ['19 nov', 'Sobran $ 1.000'],
    ]);
    const tonos = Array.from(document.querySelectorAll('.barras-d-fila')).map((f) => f.getAttribute('data-tono'));
    expect(tonos).toEqual(['falta', 'justo', 'sobra']);
    // La más grande ocupa media pista (el eje está en el medio).
    expect(document.querySelector<HTMLElement>('[data-tono="sobra"] .barras-d-relleno')?.style.inlineSize).toBe('50%');
  });
});
