/** Cantidad de tonos de la paleta de avatares (--avatar-1 a --avatar-8 en styles.css). */
export const TONOS_AVATAR = 8;

/**
 * Hasta 2 iniciales: la primera y la última palabra del nombre ("Lucía Gómez" → "LG", "Beto" → "B"). Sin nombre, del
 * email ("ana.perez@…" → "AP"). Sin nada, "?".
 */
export function iniciales(nombre: string | null, email: string | null): string {
  const desdeNombre = nombre?.trim() ? nombre.trim().split(/\s+/u) : [];
  const desdeEmail = email ? (email.split('@')[0] ?? '').split(/[._+-]+/u).filter(Boolean) : [];
  const palabras = desdeNombre.length ? desdeNombre : desdeEmail;
  const primera = palabras[0];
  if (!primera) return '?';
  const ultima = palabras.length > 1 ? palabras[palabras.length - 1] : undefined;
  // Array.from separa por caracteres reales (no parte una letra con tilde compuesta ni un emoji en dos).
  const letra = (p: string | undefined) => (p ? (Array.from(p)[0] ?? '') : '');
  return (letra(primera) + letra(ultima)).toLocaleUpperCase('es-AR');
}

/** Tono fijo para cada persona (1 a 8): un hash FNV-1a del id. El mismo id da siempre el mismo color. */
export function tonoDe(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % TONOS_AVATAR) + 1;
}
