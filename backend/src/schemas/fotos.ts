import { z } from 'zod';
import { CONTENT_TYPES_FOTO, FOTO_TAMANO_MAX, TIPOS_FOTO } from '../domain/fotos.js';

/*
 * Fotos antes/después (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 13). Estricto. El tipo y el
 * tamaño los declara el panel; el bucket los vuelve a exigir al subir (allowed_mime_types y file_size_limit).
 */

const TIPO_MSG = 'El tipo de la foto tiene que ser "antes" o "despues".';
const CONTENT_TYPE_MSG = 'La foto tiene que ser JPG o WebP (image/jpeg o image/webp).';
const TAMANO_MSG = 'La foto puede pesar hasta 1,5 MB: achicala antes de subirla.';

/** POST /api/admin/lavados/:id/fotos { tipo, contentType, tamano }. */
export const subirFotoSchema = z.strictObject({
  tipo: z.enum(TIPOS_FOTO, { error: TIPO_MSG }),
  contentType: z.enum(CONTENT_TYPES_FOTO, { error: CONTENT_TYPE_MSG }),
  tamano: z
    .number({ error: TAMANO_MSG })
    .int({ error: TAMANO_MSG })
    .min(1, { error: TAMANO_MSG })
    .max(FOTO_TAMANO_MAX, { error: TAMANO_MSG }),
});
