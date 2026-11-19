import { z } from 'zod';
import { VEHICULO_TIPOS } from '../domain/booking.js';
import { MAX_RENGLONES_RECETA, RECETA_CANTIDAD_MAX, type VarianteReceta } from '../domain/recetas.js';

/*
 * PUT /api/admin/servicios/:id/receta (contrato: reportes/2026-11-17_06_recetas-stock-avisos.md). Estricto: un campo de
 * más es un 400 con su nombre. Acá solo el formato; que el servicio exista y ofrezca el vehículo, y que cada insumo
 * exista y esté activo, lo verifica el servicio.
 */

const VEHICULO_MSG = `El vehículo tiene que ser null (receta general) o uno de: ${VEHICULO_TIPOS.join(', ')}.`;
const ITEMS_MSG = `Mandá de 0 a ${String(MAX_RENGLONES_RECETA)} renglones en la receta.`;
const CANTIDAD_MSG = `La cantidad tiene que ser un número mayor que 0 y hasta ${RECETA_CANTIDAD_MAX.toLocaleString('es-AR')}, con hasta 2 decimales.`;
export const INSUMO_REPETIDO_MSG = 'Ese insumo ya está en la receta: no lo repitas.';
/** Mismo texto que el de un insumo inexistente (lo verifica el servicio): un id con otro formato no puede existir. */
const INSUMO_MSG = 'Ese insumo no existe o está inactivo.';
/** Un id de insumo (uuid); más largo que eso no puede existir. */
const INSUMO_ID_MAX = 64;

const renglonSchema = z.strictObject({
  insumoId: z.string({ error: INSUMO_MSG }).min(1, { error: INSUMO_MSG }).max(INSUMO_ID_MAX, { error: INSUMO_MSG }),
  cantidad: z
    .number({ error: CANTIDAD_MSG })
    .refine(
      (valor) =>
        Number.isFinite(valor) &&
        valor > 0 &&
        valor <= RECETA_CANTIDAD_MAX &&
        Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6,
      { error: CANTIDAD_MSG },
    )
    .transform((valor) => Math.round(valor * 100) / 100),
});

export const varianteRecetaSchema = z
  .strictObject({
    vehiculo: z.enum(VEHICULO_TIPOS, { error: VEHICULO_MSG }).nullable(),
    items: z.array(renglonSchema, { error: ITEMS_MSG }).max(MAX_RENGLONES_RECETA, { error: ITEMS_MSG }),
  })
  .superRefine(({ items }, ctx) => {
    // Sin insumos repetidos (sin distinguir mayúsculas: el uuid es el mismo). El error va en el renglón repetido.
    const vistos = new Set<string>();
    items.forEach((item, indice) => {
      const id = item.insumoId.toLowerCase();
      if (vistos.has(id)) ctx.addIssue({ code: 'custom', path: ['items', indice, 'insumoId'], message: INSUMO_REPETIDO_MSG });
      vistos.add(id);
    });
  })
  .transform((valor): VarianteReceta => ({ vehiculo: valor.vehiculo, items: valor.items }));
