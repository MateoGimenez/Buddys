import { z } from 'zod';
import { DESCUENTO_MOTIVO_MAX, MONTO_MAX } from '../domain/booking.js';
import { blankToNull, isSingleLine, nullToUndefined, stripBidi } from './bookings.js';

/*
 * Descuentos de un lavado o turno (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 12). Los usan
 * POST /api/admin/lavados y PATCH /api/admin/bookings/:id. `monto` sigue siendo lo cobrado (ya con el descuento): el
 * descuento es cuánto se rebajó, con su motivo.
 */

const DESCUENTO_MSG = `El descuento tiene que ser un número entero de pesos, de 0 a ${MONTO_MAX.toLocaleString('es-AR')}.`;
const DESCUENTO_MOTIVO_MSG = `El motivo del descuento tiene que tener de 1 a ${String(DESCUENTO_MOTIVO_MAX)} caracteres, en una línea.`;
export const DESCUENTO_SIN_MOTIVO_MSG = 'Escribí el motivo del descuento.';
export const MOTIVO_SIN_DESCUENTO_MSG = 'Sin descuento no va motivo.';
const DESCUENTO_ALTO_MSG = `El monto más el descuento no puede pasar de ${MONTO_MAX.toLocaleString('es-AR')}.`;

/** descuento: pesos enteros de 0 a MONTO_MAX (0 = sin descuento). */
export const descuentoSchema = z
  .number({ error: DESCUENTO_MSG })
  .int({ error: DESCUENTO_MSG })
  .min(0, { error: DESCUENTO_MSG })
  .max(MONTO_MAX, { error: DESCUENTO_MSG });

/** descuentoMotivo: texto de una línea (1 a 80); "" u omitido => null. */
export const descuentoMotivoSchema = z.preprocess(
  nullToUndefined,
  z
    .string({ error: DESCUENTO_MOTIVO_MSG })
    .transform(stripBidi)
    .pipe(
      z
        .string()
        .trim()
        .max(DESCUENTO_MOTIVO_MAX, { error: DESCUENTO_MOTIVO_MSG })
        .refine(isSingleLine, { error: DESCUENTO_MOTIVO_MSG })
        .transform(blankToNull),
    )
    .default(null),
);

/**
 * Reglas del descuento que se ven en el body: con descuento hace falta motivo, sin descuento no va motivo, y lo cobrado
 * más lo descontado tiene que entrar en el tope (es el precio antes del descuento).
 */
export function revisarDescuento(
  ctx: z.RefinementCtx,
  monto: number | null | undefined,
  descuento: number | undefined,
  motivo: string | null | undefined,
): void {
  if (descuento === undefined) return;
  if (descuento > 0 && (motivo === null || motivo === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['descuentoMotivo'], message: DESCUENTO_SIN_MOTIVO_MSG });
  } else if (descuento === 0 && motivo !== null && motivo !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['descuentoMotivo'], message: MOTIVO_SIN_DESCUENTO_MSG });
  }
  if (typeof monto === 'number' && monto + descuento > MONTO_MAX) {
    ctx.addIssue({ code: 'custom', path: ['descuento'], message: DESCUENTO_ALTO_MSG });
  }
}

