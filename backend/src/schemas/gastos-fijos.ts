import { z } from 'zod';
import { CATEGORIAS_GASTO, GASTO_MONTO_MAX, GASTO_MONTO_MIN } from '../domain/gastos.js';
import { GASTO_FIJO_CONCEPTO_MAX } from '../domain/gastos-fijos.js';
import { textoDeUnaLinea } from './finanzas.js';

/*
 * Gastos fijos mensuales (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 10). Estrictos. Los meses van
 * como YYYY-MM. Que la persona exista y que `hasta` no sea anterior a `desde` lo verifica GastoFijoService.
 */

const CONCEPTO_MSG = `El concepto tiene que tener de 1 a ${String(GASTO_FIJO_CONCEPTO_MAX)} caracteres, en una línea.`;
const MONTO_MSG = `El monto tiene que ser un número entero de pesos, de ${String(GASTO_MONTO_MIN)} a ${GASTO_MONTO_MAX.toLocaleString('es-AR')}.`;
const CATEGORIA_MSG = `La categoría tiene que ser una de: ${CATEGORIAS_GASTO.join(', ')}.`;
const PERFIL_MSG = 'La persona tiene que ser el id de alguien del panel, o null.';
const MES_MSG = 'El mes tiene que tener el formato AAAA-MM.';

const mesSchema = z.string({ error: MES_MSG }).regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: MES_MSG });
const montoSchema = z
  .number({ error: MONTO_MSG })
  .int({ error: MONTO_MSG })
  .min(GASTO_MONTO_MIN, { error: MONTO_MSG })
  .max(GASTO_MONTO_MAX, { error: MONTO_MSG });
const perfilSchema = z
  .uuid({ error: PERFIL_MSG })
  .transform((id) => id.toLowerCase())
  .nullable();

/** POST /api/admin/gastos-fijos { concepto, monto, categoria, perfilId?, desde? } (sin desde: el mes actual). */
export const crearGastoFijoSchema = z.strictObject({
  concepto: textoDeUnaLinea(GASTO_FIJO_CONCEPTO_MAX, CONCEPTO_MSG),
  monto: montoSchema,
  categoria: z.enum(CATEGORIAS_GASTO, { error: CATEGORIA_MSG }),
  perfilId: perfilSchema.default(null),
  desde: mesSchema.optional(),
});

/** PATCH /api/admin/gastos-fijos/:id: al menos un campo. `activo` y `hasta` no van juntos. */
export const actualizarGastoFijoSchema = z
  .strictObject({
    concepto: textoDeUnaLinea(GASTO_FIJO_CONCEPTO_MAX, CONCEPTO_MSG).optional(),
    monto: montoSchema.optional(),
    categoria: z.enum(CATEGORIAS_GASTO, { error: CATEGORIA_MSG }).optional(),
    perfilId: perfilSchema.optional(),
    activo: z.boolean({ error: 'activo tiene que ser true o false.' }).optional(),
    desde: mesSchema.optional(),
    hasta: mesSchema.nullable().optional(),
  })
  .superRefine((cambios, ctx) => {
    if (!Object.values(cambios as Record<string, unknown>).some((valor) => valor !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['concepto'], message: 'Indicá al menos un cambio.' });
    }
    if (cambios.activo !== undefined && cambios.hasta !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'Mandá activo o hasta, no los dos.' });
    }
  });

/** Los ids de gastos fijos son UUID; cualquier otra cosa no puede existir (404). */
export const gastoFijoIdSchema = z.uuid();
