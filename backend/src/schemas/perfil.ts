import { z } from 'zod';
import { AVATAR_TAMANO_MAX, CONTENT_TYPES_AVATAR } from '../domain/avatar.js';
import { passwordSchema } from './usuarios.js';

/*
 * Perfil propio (contrato: reportes/2026-11-16_04_contrato-perfil.md). Todos estrictos: un campo desconocido => 400.
 */

const BIDI_CONTROLS = /\p{Bidi_Control}/gu;
const CONTROL_CHARS = /\p{Cc}/u;
const NOMBRE_MSG = 'El nombre tiene que tener entre 2 y 60 caracteres.';
const CONTENT_TYPE_MSG = 'La foto tiene que ser JPG o WebP (image/jpeg o image/webp).';
const TAMANO_MSG = 'La foto de perfil puede pesar hasta 512 KB: achicala antes de subirla.';

/** PATCH /api/admin/perfil { nombre }: una línea, 2 a 60 caracteres (sin contar los espacios de los costados). */
export const cambiarNombreSchema = z.strictObject({
  nombre: z
    .string({ error: 'Ingresá tu nombre.' })
    .transform((value) => value.replace(BIDI_CONTROLS, '').trim())
    .pipe(
      z
        .string()
        .min(2, { error: NOMBRE_MSG })
        .max(60, { error: NOMBRE_MSG })
        .refine((value) => !CONTROL_CHARS.test(value), { error: 'El nombre tiene que ser de una sola línea, sin caracteres raros.' }),
    ),
});

/** POST /api/admin/perfil/avatar { contentType, tamano }. El bucket vuelve a exigir tipo y tamaño al subir. */
export const pedirAvatarSchema = z.strictObject({
  contentType: z.enum(CONTENT_TYPES_AVATAR, { error: CONTENT_TYPE_MSG }),
  tamano: z
    .number({ error: TAMANO_MSG })
    .int({ error: TAMANO_MSG })
    .min(1, { error: TAMANO_MSG })
    .max(AVATAR_TAMANO_MAX, { error: TAMANO_MSG }),
});

/** POST /api/admin/perfil/clave { actual, nueva }: la nueva, 8 a 72 caracteres y distinta de la actual. */
export const cambiarClaveSchema = z
  .strictObject({
    actual: z
      .string({ error: 'Ingresá tu contraseña actual.' })
      .min(1, { error: 'Ingresá tu contraseña actual.' })
      .max(200, { error: 'La contraseña actual no es correcta.' }),
    nueva: passwordSchema,
  })
  .refine((datos) => datos.nueva !== datos.actual, {
    error: 'La contraseña nueva tiene que ser distinta de la actual.',
    path: ['nueva'],
  });
