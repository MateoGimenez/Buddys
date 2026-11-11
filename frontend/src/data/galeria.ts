import type { FotoGaleria, ParAntesDespues } from '../types';

/**
 * GALERÍA DE TRABAJOS — cómo agregar fotos reales
 *
 * 1. Copiá la foto original (la pesada, tal como sale del celular) a `fotos-originales/`, que queda fuera de la web.
 *    Sirven verticales (4:5, como las de Instagram) y horizontales; la galería se adapta a las dos.
 *
 * 2. Sumala a la lista FOTOS de `scripts/optimizar-fotos.mjs` con el nombre final (minúsculas y guiones, ej.:
 *    'hilux-pulido') y corré `npm run fotos`: genera en `public/trabajos/` tres WebP (480, 800 y 1080 px) y un JPG
 *    de respaldo. Ninguna foto original se publica.
 *
 * 3. Fotos sueltas: agregá `fotoOptimizada({...})` en `fotos` con ese nombre, el tamaño en píxeles del original y:
 *      - alt: lo que SE VE en la foto, para quienes usan lector de pantalla (y ayuda a Google). Nada de lo que no se ve.
 *      - titulo: corto y neutro ("Toyota Hilux"). No pongas el servicio si no estás seguro de cuál fue.
 *      - servicioId: solo si es seguro; con él la foto aparece también en la página de ese servicio.
 *
 * 4. Antes y después: sacá las dos fotos desde el mismo lugar y con el mismo encuadre (mismo tamaño, mejor horizontal
 *    3:2), sin recortar. Pasalas por el script como cualquier otra y cargalas en `antesDespues` con las rutas de los
 *    respaldos JPG (`/trabajos/gol-antes-800.jpg`). En antes/después describí solo el objeto: la web agrega "Antes:"
 *    y "Después:" sola. (Hoy no hay ningún par: las fotos de ejemplo no lo son.)
 *
 * Mientras las dos listas estén vacías, la web muestra "Fotos reales muy pronto".
 */

export const fotos: readonly FotoGaleria[] = [];

export const antesDespues: readonly ParAntesDespues[] = [];
