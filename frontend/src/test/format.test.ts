import { describe, expect, it } from 'vitest';
import { esFechaValida, hoy, miles, pesos, slug, sumarDias, ultimoDelMes } from '../lib/format';

describe('formato', () => {
  it('pesos en es-AR sin decimales', () => {
    expect(pesos(12500)).toBe('$ 12.500');
    expect(pesos(0)).toBe('$ 0');
  });

  it('pesos usa un espacio no separable: "$ 1.000" no se parte en dos renglones', () => {
    expect(pesos(1000)).toBe('$ 1.000');
    expect(pesos(1000)).not.toMatch(/ /);
    expect(pesos(-500)).not.toMatch(/ /);
  });

  it('"hoy" usa la hora de Argentina', () => {
    // 02:00 UTC del 12/11 = 23:00 del 11/11 en Argentina (UTC-3)
    expect(hoy(new Date('2026-11-12T02:00:00Z'))).toBe('2026-11-11');
    expect(hoy(new Date('2026-11-12T04:00:00Z'))).toBe('2026-11-12');
  });

  it('fechas', () => {
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(ultimoDelMes('2028-02-10')).toBe('2028-02-29');
  });

  it('inputs', () => {
    expect(miles('12a500')).toBe('12.500');
    expect(slug('Lavado de Motor ñandú')).toBe('lavado-de-motor-nandu');
  });

  it('el slug de un nombre largo nunca termina en guion (el backend lo rechazaría)', () => {
    // 63 letras + " b": el recorte a 64 cae justo en el guion.
    const id = slug(`${'a'.repeat(63)} b`);
    expect(id).toBe('a'.repeat(63));
    expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slug('Pulido   y   encerado — premium '.repeat(5)).length).toBeLessThanOrEqual(64);
    expect(slug('Pulido   y   encerado — premium '.repeat(5))).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('montos grandes y bordes de calendario', () => {
    expect(pesos(99_999_999)).toBe('$ 99.999.999');
    expect(miles('99999999')).toBe('99.999.999');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2028-03-01', -1)).toBe('2028-02-29');
    expect(ultimoDelMes('2026-02-01')).toBe('2026-02-28');
    // 23:30 del 31/12 en Argentina ya es 1/1 en UTC.
    expect(hoy(new Date('2027-01-01T02:30:00Z'))).toBe('2026-12-31');
  });
});

describe('esFechaValida (el ?fecha= de Planilla y Cierre de caja)', () => {
  it('acepta fechas que existen y rechaza las imposibles o mal escritas', () => {
    expect(esFechaValida('2026-11-19')).toBe(true);
    expect(esFechaValida('2028-02-29')).toBe(true);
    for (const mala of ['2026-13-01', '2026-00-10', '2026-02-31', '2027-02-29', '2026-1-01', 'hoy', '2026-11-19x', '']) {
      expect(esFechaValida(mala), mala).toBe(false);
    }
  });
});
