import { describe, expect, it } from 'vitest';
import { hoy, miles, pesos, slug, sumarDias, ultimoDelMes } from '../lib/format';

describe('formato', () => {
  it('pesos en es-AR sin decimales', () => {
    expect(pesos(12500)).toBe('$ 12.500');
    expect(pesos(0)).toBe('$ 0');
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
    expect(pesos(99_999_999)).toBe('$ 99.999.999');
    expect(miles('99999999')).toBe('99.999.999');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2028-03-01', -1)).toBe('2028-02-29');
    expect(ultimoDelMes('2026-02-01')).toBe('2026-02-28');
    // 23:30 del 31/12 en Argentina ya es 1/1 en UTC.
    expect(hoy(new Date('2027-01-01T02:30:00Z'))).toBe('2026-12-31');
  });
});
