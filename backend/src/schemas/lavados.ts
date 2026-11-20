import { z } from 'zod';
import { ETAPAS, FRANJAS, MONTO_MAX, VEHICULO_TIPOS } from '../domain/booking.js';
import { SERVICIO_ID_MAX, SERVICIO_ID_REGEX } from '../domain/servicios.js';
import { isValidCalendarDate } from '../lib/dates.js';
import { MAX_NOTAS_INTERNAS, charLength, formaPagoTurnoSchema } from './admin.js';
import {
  SERVICIO_MSG,
  TELEFONO_MSG,
  VEHICULO_TIPO_MSG,
  blankToNull,
  cleanPhoneText,
  countDigits,
  isMultiLine,
  isSingleLine,
  nullToUndefined,
  stripBidi,
} from './bookings.js';
import { descuentoMotivoSchema, descuentoSchema, revisarDescuento } from './descuentos.js';
import { SERVICIOS_LAVADO_MSG, servicioIdsSchema } from './servicios.js';

/** Hasta cuántos días para atrás se puede registrar un lavado que se olvidó cargar. */
export const LAVADO_DIAS_ATRAS = 31;

const MONTO_MSG = `El monto tiene que ser un número entero de pesos, de 0 a ${MONTO_MAX.toLocaleString('es-AR')}.`;
const TRABAJADOR_MSG = 'Elegí quién hizo el lavado.';
const FECHA_MSG = 'Elegí una fecha válida (YYYY-MM-DD).';
const SERVICIOS_DOS_FORMAS_MSG = 'Mandá servicioIds (la lista) o servicioId (uno solo), no los dos.';
const NOTAS_MSG = `La nota tiene que tener hasta ${String(MAX_NOTAS_INTERNAS)} caracteres.`;
const ETAPA_MSG = `La etapa tiene que ser una de: ${ETAPAS.join(', ')}.`;
/** Texto opcional de una línea: "" u omitido => null. */
const textoOpcional = (max: number, campo: string) =>
  z.preprocess(
    nullToUndefined,
    z
      .string({ error: `Revisá ${campo}.` })
      .transform(stripBidi)
      .pipe(
        z
          .string()
          .trim()
          .max(max, { error: `${campo[0]?.toUpperCase() ?? ''}${campo.slice(1)} no puede tener más de ${String(max)} caracteres.` })
          .refine(isSingleLine, { error: `${campo[0]?.toUpperCase() ?? ''}${campo.slice(1)} tiene caracteres que no se permiten.` })
          .transform(blankToNull),
      )
      .default(null),
  );

/**
 * POST /api/admin/lavados. Estricto (un campo desconocido se rechaza). Acá solo el formato: que los servicios existan,
 * estén activos y se ofrezcan para el vehículo, que la persona exista y esté activa, y los permisos, los verifica
 * LavadoService. Se arma por request porque el rango de fechas depende de "hoy".
 *
 * Obligatorios: servicioIds (1 a 10, sin repetidos; el primero es el principal) y vehiculoTipo. Por compatibilidad con
 * la cola sin conexión del panel, un `servicioId` suelto (sin servicioIds) vale como [servicioId]; mandar los dos es
 * un error (fields.servicioIds). Sale siempre con servicioIds. El resto es opcional: fecha (hoy), franja (según la hora), trabajadorId
 * (quien registra), monto (null: se completa después), formaPago (null: sin indicar), nombre ("Cliente de mostrador"),
 * teléfono, modelo/patente, nota e idLocal (el id que genera la cola sin conexión del panel: un reintento no duplica).
 */
export function registrarLavadoSchema(range: { min: string; max: string }) {
  return z.strictObject({
    servicioIds: servicioIdsSchema.optional(),
    servicioId: z
      .string({ error: SERVICIO_MSG })
      .max(SERVICIO_ID_MAX, { error: SERVICIO_MSG })
      .regex(SERVICIO_ID_REGEX, { error: SERVICIO_MSG })
      .optional(),
    vehiculoTipo: z.enum(VEHICULO_TIPOS, { error: VEHICULO_TIPO_MSG }),
    monto: z
      .number({ error: MONTO_MSG })
      .int({ error: MONTO_MSG })
      .min(0, { error: MONTO_MSG })
      .max(MONTO_MAX, { error: MONTO_MSG })
      .nullable()
      .default(null),
    trabajadorId: z
      .uuid({ error: TRABAJADOR_MSG })
      .transform((id) => id.toLowerCase())
      .optional(),
    fecha: z
      .string({ error: FECHA_MSG })
      .trim()
      .refine(isValidCalendarDate, { error: FECHA_MSG, abort: true })
      .refine((value) => value <= range.max, { error: 'No se puede registrar un lavado en una fecha futura.', abort: true })
      .refine((value) => value >= range.min, {
        error: `Solo se pueden registrar lavados de los últimos ${String(LAVADO_DIAS_ATRAS)} días.`,
      })
      .optional(),
    franja: z.enum(FRANJAS, { error: 'La franja tiene que ser manana o tarde.' }).optional(),
    formaPago: formaPagoTurnoSchema.default(null),
    etapa: z.enum(ETAPAS, { error: ETAPA_MSG }).default('entregado'),
    descuento: descuentoSchema.default(0),
    descuentoMotivo: descuentoMotivoSchema,
    idLocal: z
      .uuid({ error: 'El idLocal tiene que ser un UUID.' })
      .transform((id) => id.toLowerCase())
      .optional(),
    nombre: textoOpcional(80, 'el nombre'),
    telefono: z.preprocess(
      nullToUndefined,
      z
        .string({ error: TELEFONO_MSG })
        .transform(cleanPhoneText)
        .pipe(
          z
            .string()
            .trim()
            .transform(blankToNull)
            .pipe(
              z.union([
                z.null(),
                z
                  .string()
                  .min(8, { error: TELEFONO_MSG })
                  .max(20, { error: TELEFONO_MSG })
                  .regex(/^[0-9 +\-()]+$/, { error: TELEFONO_MSG })
                  .refine((value) => countDigits(value) >= 8, { error: TELEFONO_MSG }),
              ]),
            ),
        )
        .default(null),
    ),
    vehiculoModelo: textoOpcional(80, 'el modelo o la patente'),
    notasInternas: z.preprocess(
      nullToUndefined,
      z
        .string({ error: NOTAS_MSG })
        .transform((text) => stripBidi(text).replace(/\r\n/g, '\n').trim())
        .refine(isMultiLine, { error: 'La nota tiene caracteres que no se permiten.' })
        .refine((text) => charLength(text) <= MAX_NOTAS_INTERNAS, { error: NOTAS_MSG })
        .transform(blankToNull)
        .default(null),
    ),
  })
    .superRefine(({ servicioIds, servicioId, monto, descuento, descuentoMotivo }, ctx) => {
      if (servicioIds !== undefined && servicioId !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['servicioIds'], message: SERVICIOS_DOS_FORMAS_MSG });
      } else if (servicioIds === undefined && servicioId === undefined) {
        ctx.addIssue({ code: 'custom', path: ['servicioIds'], message: SERVICIOS_LAVADO_MSG });
      }
      revisarDescuento(ctx, monto, descuento, descuentoMotivo);
    })
    .transform(({ servicioIds, servicioId, ...resto }) => ({
      ...resto,
      servicioIds: servicioIds ?? (servicioId === undefined ? [] : [servicioId]),
    }));
}

/** PATCH /api/admin/lavados/:id/etapa { etapa }. */
export const etapaSchema = z.strictObject({ etapa: z.enum(ETAPAS, { error: ETAPA_MSG }) });

/** GET /api/admin/lavados?fecha=YYYY-MM-DD (sin fecha: hoy). */
export const lavadosQuerySchema = z.object({
  fecha: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string({ error: FECHA_MSG }).trim().refine(isValidCalendarDate, { error: FECHA_MSG }).optional(),
  ),
});
