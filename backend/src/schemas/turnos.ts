import { z } from 'zod';
import { MONTO_MAX } from '../domain/booking.js';
import { MAX_DAYS_CONFIRMADA } from '../domain/booking-dates.js';
import { FORMAS_DE_PAGO } from '../domain/comprobantes.js';
import { isValidCalendarDate } from '../lib/dates.js';
import { CONTROL_CHARS, MAX_NOTAS_INTERNAS, BIDI_CONTROLS, charLength } from './admin.js';
import { blankToNull, createBookingSchema, nullToUndefined } from './bookings.js';
import { servicioIdsSchema } from './servicios.js';

/*
 * Turnos creados desde el panel, con seña (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 8).
 * Estrictos: un campo de más es un 400 con su nombre. Se arman por request porque los rangos de fechas dependen de
 * "hoy". Que los servicios existan, estén activos y se ofrezcan para el vehículo lo verifica TurnoPanelService.
 */

/** Hasta cuántos días para atrás se puede anotar el cobro de una seña. */
export const SENA_DIAS_ATRAS = 31;

const SENA_MONTO_MSG = `La seña tiene que ser un número entero de pesos, de 1 a ${MONTO_MAX.toLocaleString('es-AR')}.`;
const SENA_FORMA_MSG = `La forma de pago de la seña tiene que ser una de: ${FORMAS_DE_PAGO.join(', ')}.`;
const SENA_FECHA_MSG = 'La fecha de la seña tiene que ser una fecha válida AAAA-MM-DD.';
const FECHA_MSG = 'Elegí la fecha del turno (AAAA-MM-DD).';
const NOTAS_MSG = `La nota interna tiene que tener hasta ${String(MAX_NOTAS_INTERNAS)} caracteres.`;

/** La seña: { monto, formaPago, fecha? } (sin fecha: hoy). */
export function senaSchema(rango: { min: string; max: string }) {
  return z.strictObject({
    monto: z
      .number({ error: SENA_MONTO_MSG })
      .int({ error: SENA_MONTO_MSG })
      .min(1, { error: SENA_MONTO_MSG })
      .max(MONTO_MAX, { error: SENA_MONTO_MSG }),
    formaPago: z.enum(FORMAS_DE_PAGO, { error: SENA_FORMA_MSG }),
    fecha: z
      .string({ error: SENA_FECHA_MSG })
      .trim()
      .refine(isValidCalendarDate, { error: SENA_FECHA_MSG, abort: true })
      .refine((value) => value <= rango.max, { error: 'La seña no puede tener una fecha futura.', abort: true })
      .refine((value) => value >= rango.min, {
        error: `La fecha de la seña puede ser de hasta ${String(SENA_DIAS_ATRAS)} días atrás.`,
      })
      .default(rango.max),
  });
}

/**
 * POST /api/admin/turnos. Lo de siempre del alta de un turno (nombre, teléfono, email, vehículo, franja, comentario;
 * mismas reglas que POST /api/bookings) más servicioIds, la fecha (de hoy a 120 días, como al confirmar para otra
 * fecha), la nota interna y la seña opcional.
 */
export function crearTurnoSchema(rangoTurno: { min: string; max: string }, rangoSena: { min: string; max: string }) {
  const base = createBookingSchema(rangoTurno).pick({
    nombre: true,
    telefono: true,
    email: true,
    vehiculoTipo: true,
    vehiculoModelo: true,
    franja: true,
    comentario: true,
  });
  return base.extend({
    servicioIds: servicioIdsSchema,
    fecha: z
      .string({ error: FECHA_MSG })
      .trim()
      .refine(isValidCalendarDate, { error: FECHA_MSG, abort: true })
      .refine((value) => value >= rangoTurno.min, { error: 'La fecha no puede ser anterior a hoy.', abort: true })
      .refine((value) => value <= rangoTurno.max, {
        error: `La fecha puede ser hasta ${String(MAX_DAYS_CONFIRMADA)} días desde hoy.`,
      }),
    notasInternas: z.preprocess(
      nullToUndefined,
      z
        .string({ error: NOTAS_MSG })
        .transform((text) => text.replace(BIDI_CONTROLS, '').replace(/\r\n/g, '\n').trim())
        .refine((text) => !CONTROL_CHARS.test(text), { error: 'La nota tiene caracteres que no se permiten.' })
        .refine((text) => charLength(text) <= MAX_NOTAS_INTERNAS, { error: NOTAS_MSG })
        .transform(blankToNull)
        .default(null),
    ),
    sena: z.preprocess(nullToUndefined, senaSchema(rangoSena).optional()).transform((sena) => sena ?? null),
  });
}
