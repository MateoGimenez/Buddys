// Regenera src/test/respuestas-reales.json a partir de backend/test/fixtures/respuestas-api.json (el backend solo se
// lee). Qué clave sale de dónde: scripts/respuestas.ts.
//
//   npm run respuestas            → reescribe el archivo y muestra los avisos
//   npm run respuestas:verificar  → no escribe; sale con error si quedaron desincronizados
//
// Cuándo: después de que el backend regenere su contrato (ACTUALIZAR_FIXTURES=1 en backend). El test
// scripts/respuestas.test.ts (parte de `npm test`) avisa si alguien se olvidó.
// Corre con Node 22.18+ directo (borra los tipos solo, sin compilar).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generar, serializar, type Respuestas } from './respuestas.ts';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = resolve(raiz, '../backend/test/fixtures/respuestas-api.json');
const FRONTEND = resolve(raiz, 'src/test/respuestas-reales.json');

const leer = (ruta: string) => JSON.parse(readFileSync(ruta, 'utf8')) as Respuestas;
const actualTexto = readFileSync(FRONTEND, 'utf8');
const { respuestas, avisos } = generar(leer(BACKEND), JSON.parse(actualTexto) as Respuestas);
const nuevo = serializar(respuestas);

for (const a of avisos) console.warn(`aviso: ${a}`);

if (process.argv.includes('--verificar')) {
  if (nuevo !== actualTexto) {
    console.error('src/test/respuestas-reales.json no está al día con el contrato del backend. Corré: npm run respuestas');
    process.exit(1);
  }
  console.log('src/test/respuestas-reales.json está al día con el contrato del backend.');
} else if (nuevo === actualTexto) {
  console.log('Sin cambios: src/test/respuestas-reales.json ya estaba al día.');
} else {
  writeFileSync(FRONTEND, nuevo);
  console.log('Listo: src/test/respuestas-reales.json regenerado. Corré npm test para ver que todo siga en verde.');
}
