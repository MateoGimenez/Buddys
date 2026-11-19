import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from './auth.js';
import { nombreSchema, passwordSchema } from './usuarios.js';

/** Tipos de imagen que acepta PUT /api/admin/perfil/foto (el body es la imagen tal cual). */
export const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type TipoFoto = (typeof TIPOS_FOTO)[number];

/** Tope del body de la foto: 2 MB. */
export const FOTO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * PATCH /api/admin/perfil. Estricto (un campo desconocido => 400). `passwordActual` y `passwordNueva` van juntas: si
 * falta una, el error va en su campo. Que venga al menos un cambio lo verifica la ruta.
 */
export const updatePerfilSchema = z
  .strictObject({
    nombre: nombreSchema.optional(),
    passwordActual: z
      .string({ error: 'Ingresá tu contraseña actual.' })
      .min(1, { error: 'Ingresá tu contraseña actual.' })
      .max(PASSWORD_MAX_LENGTH, { error: 'La contraseña es demasiado larga.' })
      .optional(),
    passwordNueva: passwordSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.passwordActual !== undefined && value.passwordNueva === undefined) {
      ctx.addIssue({ code: 'custom', path: ['passwordNueva'], message: 'Ingresá la contraseña nueva.' });
    }
    if (value.passwordNueva !== undefined && value.passwordActual === undefined) {
      ctx.addIssue({ code: 'custom', path: ['passwordActual'], message: 'Ingresá tu contraseña actual.' });
    }
  });

/** El tipo de una foto, sin parámetros (`image/png; charset=x` => image/png). undefined si no es uno aceptado. */
export function tipoFoto(header: string | undefined): TipoFoto | undefined {
  const tipo = header?.split(';')[0]?.trim().toLowerCase();
  return TIPOS_FOTO.find((aceptado) => aceptado === tipo);
}
