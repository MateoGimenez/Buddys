import { z } from 'zod';
import { FRANJAS, MONTO_MAX, VEHICULO_TIPOS } from '../domain/booking.js';
import { SERVICIO_ID_MAX, SERVICIO_ID_REGEX } from '../domain/servicios.js';
import { isValidCalendarDate } from '../lib/dates.js';
import { MAX_NOTAS_INTERNAS, charLength } from './admin.js';
import {
  SERVICIO_MSG,
  TELEFONO_MSG,
  blankToNull,
  cleanPhoneText,
  countDigits,
  isMultiLine,
  isSingleLine,
  nullToUndefined,
  stripBidi,
} from './bookings.js';

/** Hasta cuántos días para atrás se puede registrar un lavado que se olvidó cargar. */
export const LAVADO_DIAS_ATRAS = 31;

const MONTO_MSG = `El monto tiene que ser un número entero de pesos, de 0 a ${MONTO_MAX.toLocaleString('es-AR')}.`;
const TRABAJADOR_MSG = 'Elegí quién hizo el lavado.';
const FECHA_MSG = 'Elegí una fecha válida (YYYY-MM-DD).';
const NOTAS_MSG = `La nota tiene que tener hasta ${String(MAX_NOTAS_INTERNAS)} caracteres.`;

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
 * POST /api/admin/lavados. Estricto (un campo desconocido se rechaza). Acá solo el formato: que el servicio exista,
 * esté activo y se ofrezca para el vehículo, que la persona exista y esté activa, y los permisos, los verifica
 * LavadoService. Se arma por request porque el rango de fechas depende de "hoy".
 *
 * Obligatorios: servicioId y vehiculoTipo. El resto es opcional: fecha (hoy), franja (según la hora), trabajadorId
 * (quien registra), monto (null: se completa después), nombre ("Cliente de mostrador"), teléfono, modelo/patente y nota.
 */
export function registrarLavadoSchema(range: { min: string; max: string }) {
  return z.strictObject({
    servicioId: z
      .string({ error: SERVICIO_MSG })
      .max(SERVICIO_ID_MAX, { error: SERVICIO_MSG })
      .regex(SERVICIO_ID_REGEX, { error: SERVICIO_MSG }),
    vehiculoTipo: z.enum(VEHICULO_TIPOS, { error: 'Elegí el tipo de vehículo (auto, camioneta o moto).' }),
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
  });
}

/** GET /api/admin/lavados?fecha=YYYY-MM-DD (sin fecha: hoy). */
export const lavadosQuerySchema = z.object({
  fecha: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string({ error: FECHA_MSG }).trim().refine(isValidCalendarDate, { error: FECHA_MSG }).optional(),
  ),
});
