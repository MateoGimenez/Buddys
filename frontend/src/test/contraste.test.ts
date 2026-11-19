/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Se lee del disco (los tests corren desde frontend/): en los tests el CSS no se procesa (css: false en vite.config.ts).
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

// Contraste de cada par texto/fondo que usa el panel, en los tres temas. Lee los colores de styles/tokens.css: si
// alguien cambia un color y deja un par ilegible (al sol, de noche), este test lo dice.
//  - texto: WCAG 1.4.3 (AA 4.5:1). En alto contraste, 1.4.6 (AAA 7:1).
//  - grande: texto de 18.66 px en negrita o más (cifras, títulos): AA 3:1, AAA 4.5:1.
//  - borde: lo que hace falta ver para usar un control (borde de campo, casilla, marca): 1.4.11, 3:1.

type Tema = Record<string, string>;

/** Las variables `--nombre: #hex;` de un bloque del archivo (desde el marcador hasta la primera llave que cierra). */
function bloque(marcador: string): Tema {
  const inicio = tokens.indexOf(marcador);
  if (inicio < 0) throw new Error(`Falta el bloque ${marcador} en tokens.css`);
  const apertura = tokens.indexOf('{', inicio);
  const cuerpoTexto = tokens.slice(apertura + 1, tokens.indexOf('}', apertura));
  const vars: Tema = {};
  for (const m of cuerpoTexto.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) vars[m[1] ?? ''] = (m[2] ?? '').toLowerCase();
  return vars;
}

const claro = bloque(':root {');
const TEMAS: Record<string, { colores: Tema; aaa: boolean }> = {
  claro: { colores: claro, aaa: false },
  oscuro: { colores: { ...claro, ...bloque('/* tema:oscuro (elegido) */') }, aaa: false },
  contraste: { colores: { ...claro, ...bloque('/* tema:contraste') }, aaa: true },
};

function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

type Tipo = 'texto' | 'grande' | 'borde';
/** [texto, fondo, tipo, dónde] */
const PARES: [string, string, Tipo, string][] = [
  ['tinta', 'papel', 'texto', 'texto de las hojas'],
  ['tinta', 'fondo', 'texto', 'títulos sobre el fondo'],
  ['tinta-2', 'papel', 'texto', 'detalles'],
  ['tinta-3', 'papel', 'texto', 'ayudas de los campos, placeholder'],
  ['tinta-3', 'fondo', 'texto', 'fecha del encabezado'],
  ['tinta', 'canario', 'texto', 'copia de la planilla, talón'],
  ['tinta-2', 'canario', 'texto', 'detalle de la copia'],
  ['tinta-3', 'canario', 'texto', 'hora de la copia'],
  ['serie', 'canario', 'texto', 'N° de la copia'],
  ['serie', 'papel', 'grande', 'puesto del ranking'],
  ['carbon', 'papel', 'texto', 'enlaces y botones fantasma'],
  ['carbon', 'fondo', 'texto', 'enlaces sobre el fondo'],
  ['carbon', 'carbon-claro', 'texto', 'botón fantasma con el dedo encima'],
  ['tinta', 'carbon-claro', 'texto', 'opción con el dedo encima, aviso info'],
  ['sobre-tinta', 'tinta', 'texto', 'opción elegida, fichas, "Sin conexión"'],
  ['marca-sobre-tinta', 'tinta', 'borde', 'tilde de la forma de pago elegida'],
  ['sobre-rosa', 'rosa', 'texto', 'botón principal'],
  ['sobre-rosa-fuerte', 'rosa-fuerte', 'texto', 'botón principal con el dedo encima'],
  ['tinta', 'rosa-claro', 'texto', 'servicio elegido'],
  ['tinta-2', 'rosa-claro', 'texto', 'precio del servicio elegido, talón borrado'],
  ['peligro', 'peligro-claro', 'texto', 'aviso de error'],
  ['peligro', 'papel', 'texto', 'error de un campo, botón Borrar'],
  ['sobre-peligro', 'peligro', 'texto', 'botón de peligro'],
  ['sobre-peligro', 'peligro-hover', 'texto', 'botón de peligro con el dedo encima'],
  ['ok', 'ok-claro', 'texto', 'aviso de listo'],
  ['ok', 'papel', 'texto', 'texto de listo'],
  ['sobre-ok', 'ok', 'borde', 'tilde del sello del talón'],
  ['alerta', 'alerta-claro', 'texto', 'avisos de alerta, lavados por enviar'],
  ['alerta', 'papel', 'texto', 'precio a consultar, sin monto'],
  ['alerta', 'canario', 'texto', '"Se envía solo cuando vuelva la señal"'],
  ['tinta-2', 'alerta-claro', 'texto', 'insumo bajo de stock'],
  ['tinta-2', 'inactivo', 'texto', 'servicio inactivo'],
  ['tinta-2', 'apagado', 'texto', 'etiqueta apagada'],
  ['nav-texto', 'nav-fondo', 'texto', 'pestañas de abajo'],
  ['nav-activo', 'nav-fondo', 'texto', 'pestaña actual'],
  ['nav-marca', 'nav-fondo', 'borde', 'marca de la pestaña actual, foco en la barra'],
  ['nav-activo-texto', 'nav-activo-fondo', 'texto', 'sección actual del riel'],
  ['linea-fuerte', 'papel', 'borde', 'borde de campos y fichas'],
  ['tinta-3', 'papel', 'borde', 'casilla de los servicios'],
  ['carbon', 'papel', 'borde', 'anillo de foco'],
  ['carbon', 'fondo', 'borde', 'anillo de foco sobre el fondo'],
  ['tinta', 'pista', 'borde', 'barra de la meta y del plazo para deshacer'],
  // Caja, agenda, gastos fijos e insumos (pages/caja, agenda, gastos, insumos).
  ['serie', 'papel', 'texto', 'sello "Cerrada", franja del turno'],
  ['serie', 'inactivo', 'texto', 'franja de un turno completado'],
  ['peligro', 'canario', 'texto', '"Faltan" en el cierre elegido del historial, error en la seña'],
  ['ok', 'canario', 'texto', '"Cierra justo" en el cierre elegido del historial'],
  ['tinta-2', 'carbon-claro', 'texto', 'quién cerró, con el dedo encima'],
  ['carbon', 'carbon-claro', 'texto', 'marca "Automático" de un movimiento'],
  ['tinta-3', 'inactivo', 'texto', 'detalle de un turno completado'],
  ['peligro', 'papel', 'borde', 'borde de la diferencia (falta)'],
  ['alerta', 'papel', 'borde', 'borde de la diferencia (sobra)'],
  // Selects (la lista desplegada, con colores propios en los tres temas) y fotos de perfil.
  ['tinta', 'papel', 'texto', 'opción de un select desplegado'],
  ['tinta', 'rosa-claro', 'texto', 'opción elegida de un select desplegado'],
  ['tinta-3', 'papel', 'texto', 'opción deshabilitada de un select'],
  ['tinta', 'carbon-claro', 'texto', 'iniciales de quien no tiene foto'],
  ['tinta-2', 'carbon-claro', 'borde', 'ícono de persona sin foto (botón Tu perfil)'],
  ['borde-primario', 'papel', 'borde', 'aro de la foto en el encabezado (en Perfil o con el dedo encima)'],
  ['linea-fuerte', 'papel', 'borde', 'borde de la foto grande del perfil'],
];

function minimo(tipo: Tipo, aaa: boolean): number {
  if (tipo === 'borde') return 3;
  if (tipo === 'grande') return aaa ? 4.5 : 3;
  return aaa ? 7 : 4.5;
}

describe('contraste de los temas (styles/tokens.css)', () => {
  for (const [nombre, { colores, aaa }] of Object.entries(TEMAS)) {
    it(`${nombre}: cada texto se lee sobre su fondo (${aaa ? 'AAA' : 'AA'})`, () => {
      const fallas: string[] = [];
      for (const [texto, fondo, tipo, donde] of PARES) {
        const a = colores[texto];
        const b = colores[fondo];
        if (!a || !b) {
          fallas.push(`falta --${a ? fondo : texto}`);
          continue;
        }
        const c = contraste(a, b);
        const min = minimo(tipo, aaa);
        if (c < min) fallas.push(`${donde}: --${texto} sobre --${fondo} da ${c.toFixed(2)}:1 (mínimo ${String(min)}:1)`);
      }
      expect(fallas).toEqual([]);
    });
  }

  it('el oscuro automático y el elegido a mano son el mismo', () => {
    const auto = bloque('/* tema:oscuro (automático) */');
    expect(Object.keys(auto).length).toBeGreaterThan(20);
    expect(auto).toEqual(bloque('/* tema:oscuro (elegido) */'));
  });
});
