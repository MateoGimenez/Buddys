// El aviso de la meta de hoy sale una vez por sesión del navegador (contrato reportes/2026-11-19_09_meta-de-hoy.md).
// sessionStorage con try/catch: si el navegador no deja, vale por esta carga de la página.

const CLAVE = 'buddys.metaVista.v1';
/** Cuánto queda a la vista el aviso si nadie lo toca. */
export const AVISO_META_MS = 3000;

let vistoEnEstaCarga = false;

export function yaSeVioAvisoMeta(): boolean {
  if (vistoEnEstaCarga) return true;
  try {
    return sessionStorage.getItem(CLAVE) === '1';
  } catch {
    return false;
  }
}

export function marcarAvisoMetaVisto() {
  vistoEnEstaCarga = true;
  try {
    sessionStorage.setItem(CLAVE, '1');
  } catch {
    // Queda la marca en memoria.
  }
}

/** Solo para los tests. */
export function olvidarAvisoMeta() {
  vistoEnEstaCarga = false;
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    // Nada que borrar.
  }
}
