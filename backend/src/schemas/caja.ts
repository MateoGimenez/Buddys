import { z } from 'zod';
import { CAJA_IMPORTE_MAX, CAJA_NOTA_MAX } from '../domain/caja.js';
import { isValidCalendarDate } from '../lib/dates.js';
import { DEFAULT_PAGE_SIZE, MAX_OFFSET, MAX_PAGE_SIZE, blankToUndefined, integerParam } from './admin.js';
import { textoOpcionalDeUnaLinea } from './finanzas.js';

/*
 * Cierre de caja (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 11). El body es estricto; las queries
 * ignoran parámetros desconocidos. El rango de fechas permitido (hasta hoy, 366 días atrás) lo verifica CajaService.
 */

const IMPORTE_MSG = `Lo contado tiene que ser un número entero de pesos, de 0 a ${CAJA_IMPORTE_MAX.toLocaleString('es-AR')}.`;
const FECHA_MSG = 'La fecha tiene que ser una fecha válida con formato AAAA-MM-DD.';
const NOTA_MSG = `La nota tiene que tener hasta ${String(CAJA_NOTA_MAX)} caracteres, en una línea.`;

const importe = z
  .number({ error: IMPORTE_MSG })
  .int({ error: IMPORTE_MSG })
  .min(0, { error: IMPORTE_MSG })
  .max(CAJA_IMPORTE_MAX, { error: IMPORTE_MSG });

export const fechaCajaSchema = z.string({ error: FECHA_MSG }).refine(isValidCalendarDate, { error: FECHA_MSG });

/** PUT /api/admin/caja/:fecha { contado: { efectivo, transferencia?, debito?, credito?, otro? }, nota? }. */
export const cerrarCajaSchema = z.strictObject({
  contado: z.strictObject(
    {
      efectivo: importe,
      transferencia: importe.nullable().default(null),
      debito: importe.nullable().default(null),
      credito: importe.nullable().default(null),
      otro: importe.nullable().default(null),
    },
    { error: 'Mandá lo contado por forma de pago (al menos efectivo).' },
  ),
  nota: z.preprocess((v) => (v === null ? undefined : v), textoOpcionalDeUnaLinea(CAJA_NOTA_MAX, NOTA_MSG).default(null)),
});

/** GET /api/admin/caja?fecha= (sin fecha: hoy). */
export const cajaQuerySchema = z.object({
  fecha: z.preprocess(blankToUndefined, fechaCajaSchema.optional()),
});

/** GET /api/admin/caja/cierres?desde=&hasta=&limit=&offset= (sin rango: los últimos 31 días). */
export const cierresQuerySchema = z.object({
  desde: z.preprocess(blankToUndefined, fechaCajaSchema.optional()),
  hasta: z.preprocess(blankToUndefined, fechaCajaSchema.optional()),
  limit: z.preprocess(
    blankToUndefined,
    integerParam(1, MAX_PAGE_SIZE, `El límite tiene que ser un número entre 1 y ${String(MAX_PAGE_SIZE)}.`).default(
      DEFAULT_PAGE_SIZE,
    ),
  ),
  offset: z.preprocess(
    blankToUndefined,
    integerParam(0, MAX_OFFSET, 'El desplazamiento tiene que ser un número entero mayor o igual a 0.').default(0),
  ),
});
