// El aviso de la meta de hoy sale una vez por sesión del navegador y por persona (contrato
// reportes/2026-11-19_09_meta-de-hoy.md): si en la misma pestaña se sale y entra otra persona, a ella le aparece.
// sessionStorage con try/catch: si el navegador no deja, vale por esta carga de la página.

const CLAVE = 'buddys.metaVista.v1';
/** Cuánto queda a la vista el aviso si nadie lo toca. */
export const AVISO_META_MS = 3000;

let vistoEnEstaCarga: string | null = null;

/** ¿Esta persona (id de perfil) ya vio el aviso en esta sesión del navegador? */
export function yaSeVioAvisoMeta(usuarioId: string): boolean {
  if (vistoEnEstaCarga === usuarioId) return true;
  try {
    return sessionStorage.getItem(CLAVE) === usuarioId;
  } catch {
    return false;
  }
}

export function marcarAvisoMetaVisto(usuarioId: string) {
  vistoEnEstaCarga = usuarioId;
  try {
    sessionStorage.setItem(CLAVE, usuarioId);
  } catch {
    // Queda la marca en memoria.
  }
}

/** Solo para los tests. */
export function olvidarAvisoMeta() {
  vistoEnEstaCarga = null;
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    // Nada que borrar.
  }
}
