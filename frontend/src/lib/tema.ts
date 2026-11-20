// Cómo se ve el panel: Automático (sigue al celular), Claro, Oscuro o Alto contraste (para leer a pleno sol).
// Se guarda en este dispositivo (localStorage; si el navegador no deja, vale para esta visita) y se aplica como
// data-tema en <html>: los colores de cada tema están en styles/tokens.css. Al abrir, public/tema-inicial.js lo pone
// antes del primer dibujo (misma clave y valores); desde ahí sigue este módulo.
import { useSyncExternalStore } from 'react';

export const TEMAS = ['auto', 'claro', 'oscuro', 'contraste'] as const;
export type Tema = (typeof TEMAS)[number];

const CLAVE = 'buddys.tema.v1';

function esTema(v: unknown): v is Tema {
  return typeof v === 'string' && (TEMAS as readonly string[]).includes(v);
}

export function leerTema(): Tema {
  try {
    const v = localStorage.getItem(CLAVE);
    return esTema(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

let actual: Tema = typeof window === 'undefined' ? 'auto' : leerTema();
const oyentes = new Set<() => void>();

/**
 * El color de la barra de abajo del panel (--nav-fondo en styles/tokens.css) en cada tema, para la barra del sistema
 * (Android). Va escrito acá porque --nav-fondo es un light-dark() y la variable no se puede leer resuelta desde JS. Los
 * mismos tres valores usa public/tema-inicial.js; src/test/tema.test.tsx controla que coincidan con tokens.css.
 */
export const COLOR_BARRA = { claro: '#17204d', oscuro: '#080b18', contraste: '#000000' } as const;

function sistemaOscuro(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** El color de la barra del sistema (Android) acompaña al tema: el de la barra de abajo del panel. */
function pintarBarraDelSistema(tema: Tema = actual) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  const efectivo = tema === 'auto' ? (sistemaOscuro() ? 'oscuro' : 'claro') : tema;
  meta.content = COLOR_BARRA[efectivo];
}

/** Pone el tema en la página (sin guardarlo). */
export function aplicarTema(tema: Tema) {
  const raiz = document.documentElement;
  if (tema === 'auto') raiz.removeAttribute('data-tema');
  else raiz.setAttribute('data-tema', tema);
  pintarBarraDelSistema(tema);
}

/**
 * Cambia el tema sin transiciones: los botones tienen transition en el color y, si no, por un instante se verían con
 * el texto de un tema y el fondo del otro. La clase se va después del siguiente dibujo.
 */
let cambios = 0;
function cambiarDeUna(tema: Tema) {
  const raiz = document.documentElement;
  // Con dos cambios seguidos (doble toque), solo el último saca la clase: si no, el segundo cambio se dibujaba con
  // transiciones.
  const este = ++cambios;
  raiz.classList.add('cambiando-tema');
  aplicarTema(tema);
  const sacar = () => {
    if (este === cambios) raiz.classList.remove('cambiando-tema');
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(sacar));
  else sacar();
}

/** Elige, aplica y guarda el tema. Devuelve false si el dispositivo no lo pudo guardar (igual queda puesto). */
export function elegirTema(tema: Tema): boolean {
  actual = tema;
  cambiarDeUna(tema);
  for (const o of oyentes) o();
  try {
    if (tema === 'auto') localStorage.removeItem(CLAVE);
    else localStorage.setItem(CLAVE, tema);
    return true;
  } catch {
    return false;
  }
}

/** Al abrir la app, antes del primer dibujo. Con "Automático", la barra del sistema sigue al celular si cambia. */
export function iniciarTema() {
  aplicarTema(actual);
  if (typeof window.matchMedia !== 'function') return;
  const oscuro = window.matchMedia('(prefers-color-scheme: dark)');
  const alCambiar = () => {
    if (actual === 'auto') pintarBarraDelSistema();
  };
  oscuro.addEventListener('change', alCambiar);
}

/**
 * Otra pestaña eligió otro tema (o borró todo: key null). Un solo oyente para todo el módulo, siempre activo: así se
 * sigue también en las pantallas sin selector montado (ingreso) y `actual` nunca queda viejo.
 */
function alGuardarEnOtraPestana(e: StorageEvent) {
  if (e.key !== null && e.key !== CLAVE) return;
  const nuevo = leerTema();
  if (nuevo === actual) return;
  actual = nuevo;
  cambiarDeUna(nuevo);
  for (const o of oyentes) o();
}
if (typeof window !== 'undefined') window.addEventListener('storage', alGuardarEnOtraPestana);

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

export function useTema(): Tema {
  return useSyncExternalStore(
    suscribir,
    () => actual,
    (): Tema => 'auto',
  );
}

/** Solo para los tests. */
export function reiniciarTema() {
  actual = leerTema();
  aplicarTema(actual);
}
