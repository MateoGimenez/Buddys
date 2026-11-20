import { describe, expect, it } from 'vitest';
import { agruparSerie, esDiaria, lunesDe } from '../lib/series';

describe('series de los gráficos (lib/series.ts)', () => {
  it('lunesDe: el lunes de la semana, también cruzando de mes y de año', () => {
    expect(lunesDe('2026-11-19')).toBe('2026-11-16'); // jueves
    expect(lunesDe('2026-11-16')).toBe('2026-11-16'); // lunes
    expect(lunesDe('2026-11-22')).toBe('2026-11-16'); // domingo: es de la semana que empezó el lunes
    expect(lunesDe('2026-11-01')).toBe('2026-10-26'); // domingo 1/11: semana que cruza de mes
    expect(lunesDe('2027-01-01')).toBe('2026-12-28'); // cruza de año
  });

  it('agrupa por semana sumando los días (las puntas pueden quedar incompletas)', () => {
    const dias = [
      { clave: '2026-10-29', valor: 2 }, // jueves
      { clave: '2026-10-30', valor: 1 },
      { clave: '2026-11-01', valor: 4 }, // domingo: misma semana
      { clave: '2026-11-02', valor: 3 }, // lunes: semana nueva
      { clave: '2026-11-03', valor: 0 },
    ];
    expect(agruparSerie(dias, 'semana')).toEqual([
      { clave: '2026-10-26', valor: 7 },
      { clave: '2026-11-02', valor: 3 },
    ]);
  });

  it('agrupa por mes', () => {
    const dias = [
      { clave: '2026-10-31', valor: 5 },
      { clave: '2026-11-01', valor: 1 },
      { clave: '2026-11-30', valor: 2 },
    ];
    expect(agruparSerie(dias, 'mes')).toEqual([
      { clave: '2026-10', valor: 5 },
      { clave: '2026-11', valor: 3 },
    ]);
  });

  it('con "dia", con la serie vacía o con una serie que ya viene por mes, la devuelve igual', () => {
    const dias = [{ clave: '2026-11-19', valor: 1 }];
    expect(agruparSerie(dias, 'dia')).toEqual(dias);
    expect(agruparSerie([], 'semana')).toEqual([]);
    const meses = [{ clave: '2026-10', valor: 9 }];
    expect(esDiaria(meses)).toBe(false);
    expect(agruparSerie(meses, 'semana')).toEqual(meses);
  });
});
