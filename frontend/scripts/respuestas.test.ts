/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANA_ID, COPIAR, CONFORMAR, PROPIAS, conformar, generar, serializar, type Json, type Respuestas } from './respuestas.ts';

// Los tests corren desde frontend/.
const leer = (ruta: string) => readFileSync(resolve(process.cwd(), ruta), 'utf8');
const backend = JSON.parse(leer('../backend/test/fixtures/respuestas-api.json')) as Respuestas;
const actualTexto = leer('src/test/respuestas-reales.json');
const actuales = JSON.parse(actualTexto) as Respuestas;

describe('src/test/respuestas-reales.json y el contrato del backend', () => {
  it('están sincronizados (si falla: npm run respuestas, y revisá que los tests sigan en verde)', () => {
    const { respuestas, avisos } = generar(backend, actuales);
    expect(avisos).toEqual([]);
    expect(serializar(respuestas)).toBe(actualTexto);
  });

  it('cada clave del archivo está en un solo mapa, y cada clave del backend que se usa existe', () => {
    const todas = [...Object.keys(COPIAR), ...Object.keys(CONFORMAR), ...PROPIAS];
    expect(new Set(todas).size).toBe(todas.length);
    expect(new Set(todas)).toEqual(new Set(Object.keys(actuales)));
    for (const desde of [...Object.values(COPIAR), ...Object.values(CONFORMAR)]) expect(backend[desde], desde).toBeDefined();
  });
});

describe('conformar', () => {
  it('suma lo nuevo del backend (con los ids del frontend), saca lo que ya no manda y respeta los valores de acá', () => {
    const plantilla = { a: 1, nuevo: { id: '00000000-0000-4000-8000-000000000002' }, lista: [{ x: 1, y: 2 }] };
    const valor: Json = { a: 99, viejo: true, lista: [{ x: 5 }, { x: 6, y: 7 }] };
    expect(conformar(valor, plantilla)).toEqual({ a: 99, nuevo: { id: ANA_ID }, lista: [{ x: 5, y: 2 }, { x: 6, y: 7 }] });
  });

  it('un null de acá queda null aunque el backend mande un objeto (por ejemplo, sin trabajador)', () => {
    expect(conformar({ trabajador: null }, { trabajador: { id: 'x', nombre: 'y' } })).toEqual({ trabajador: null });
  });
});
