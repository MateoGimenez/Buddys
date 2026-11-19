// Patentes argentinas. El campo "Patente" del lavado también puede traer el modelo ("Gol Trend") o los dos juntos
// ("Gol Trend ab 123 cd"): todo viaja en vehiculoModelo, como siempre. Acá solo se ordena la patente (mayúsculas,
// sin espacios ni guiones) cuando se la reconoce, y se avisa si no se reconoce ninguna; nunca se bloquea.

export type TipoPatente = 'mercosur' | 'vieja' | 'moto' | 'moto-vieja';

const FORMATOS: [TipoPatente, RegExp][] = [
  ['mercosur', /^[A-Z]{2}\d{3}[A-Z]{2}$/], // AA123BB (autos desde 2016)
  ['vieja', /^[A-Z]{3}\d{3}$/], // ABC123 (autos 1995-2016)
  ['moto', /^[A-Z]\d{3}[A-Z]{3}$/], // A123BCD (motos Mercosur)
  ['moto-vieja', /^\d{3}[A-Z]{3}$/], // 123ABC (motos 1995-2016)
];

export const EJEMPLO_PATENTE: Record<TipoPatente, string> = {
  mercosur: 'AA123BB',
  vieja: 'ABC123',
  moto: 'A123BCD',
  'moto-vieja': '123ABC',
};

export const NOMBRE_PATENTE: Record<TipoPatente, string> = {
  mercosur: 'Patente Mercosur',
  vieja: 'Patente vieja',
  moto: 'Patente de moto Mercosur',
  'moto-vieja': 'Patente de moto vieja',
};

/** "ab-123 cd" → "AB123CD". */
function compactar(texto: string): string {
  return texto.toUpperCase().replace(/[\s.\-_]/g, '');
}

/** El formato de una patente ya compacta, o null si no es una. */
export function tipoDePatente(texto: string): TipoPatente | null {
  const c = compactar(texto);
  for (const [tipo, re] of FORMATOS) if (re.test(c)) return tipo;
  return null;
}

/**
 * Busca la patente dentro del texto: todo el texto, o de 1 a 3 palabras al final o al principio ("Gol AB 123 CD",
 * "ab123cd gol"). Devuelve la patente compacta y dónde está, o null.
 */
function buscar(texto: string): { patente: string; tipo: TipoPatente; antes: string[]; despues: string[] } | null {
  const palabras = texto.trim().split(/\s+/).filter(Boolean);
  if (!palabras.length) return null;
  const total = tipoDePatente(palabras.join(''));
  if (total) return { patente: compactar(palabras.join('')), tipo: total, antes: [], despues: [] };
  for (let k = Math.min(3, palabras.length - 1); k >= 1; k--) {
    const fin = palabras.slice(-k).join('');
    const tipoFin = tipoDePatente(fin);
    if (tipoFin) return { patente: compactar(fin), tipo: tipoFin, antes: palabras.slice(0, -k), despues: [] };
    const inicio = palabras.slice(0, k).join('');
    const tipoInicio = tipoDePatente(inicio);
    if (tipoInicio) return { patente: compactar(inicio), tipo: tipoInicio, antes: [], despues: palabras.slice(k) };
  }
  return null;
}

/**
 * Lo que queda guardado. Si hay una patente, va compacta y en mayúsculas, y el modelo (si lo hay) queda como se
 * escribió: "gol trend ab 123 cd" → "gol trend AB123CD". Si no hay ninguna, el texto sin espacios de más.
 */
export function normalizarPatente(texto: string): string {
  const limpio = texto.trim().replace(/\s+/g, ' ');
  const hallada = buscar(limpio);
  if (!hallada) return limpio;
  return [...hallada.antes, hallada.patente, ...hallada.despues].join(' ');
}

/** La patente que hay en el texto (compacta) y su formato, o null. */
export function patenteEn(texto: string): { patente: string; tipo: TipoPatente } | null {
  const hallada = buscar(texto);
  return hallada ? { patente: hallada.patente, tipo: hallada.tipo } : null;
}
