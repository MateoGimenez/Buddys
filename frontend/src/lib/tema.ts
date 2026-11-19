// Cómo se ve el panel: Automático (sigue al celular), Claro, Oscuro o Alto contraste (para leer a pleno sol).
// Se guarda en este dispositivo (localStorage; si el navegador no deja, vale para esta visita) y se aplica como
// data-tema en <html>: los colores de cada tema están en styles/tokens.css.
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

/** El color de la barra del sistema (Android) acompaña al tema: el de la barra de abajo del panel. */
function pintarBarraDelSistema() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta || typeof getComputedStyle !== 'function') return;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--nav-fondo').trim();
  if (color) meta.content = color;
}

/** Pone el tema en la página (sin guardarlo). */
export function aplicarTema(tema: Tema) {
  const raiz = document.documentElement;
  if (tema === 'auto') raiz.removeAttribute('data-tema');
  else raiz.setAttribute('data-tema', tema);
  pintarBarraDelSistema();
}

/** Elige, aplica y guarda el tema. Devuelve false si el dispositivo no lo pudo guardar (igual queda puesto). */
export function elegirTema(tema: Tema): boolean {
  actual = tema;
  aplicarTema(tema);
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

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  // Otra pestaña eligió otro tema.
  const alGuardar = (e: StorageEvent) => {
    if (e.key !== CLAVE) return;
    actual = leerTema();
    aplicarTema(actual);
    oyente();
  };
  window.addEventListener('storage', alGuardar);
  return () => {
    oyentes.delete(oyente);
    window.removeEventListener('storage', alGuardar);
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
