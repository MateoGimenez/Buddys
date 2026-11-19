import { z } from 'zod';
import {
  type ClaveCliente,
  INACTIVOS_DIAS_MAX,
  INACTIVOS_DIAS_MIN,
  PATENTE_MAX,
  PATENTE_MIN,
  PREMIOS,
  SELLOS_MAX,
  SELLOS_MIN,
  normalizarPatente,
} from '../domain/clientes.js';
import { telefonoWhatsapp } from '../domain/telefono.js';
import { DEFAULT_PAGE_SIZE, MAX_OFFSET, MAX_PAGE_SIZE, blankToUndefined, integerParam, trimToUndefined } from './admin.js';

/*
 * Clientes (contrato: reportes/2026-11-15_03_contrato-mejoras.md, funciones 6 y 14). Las queries ignoran parámetros
 * desconocidos (como el listado de turnos); los bodies son estrictos.
 */

const TELEFONO_MSG = 'Escribí un teléfono válido.';
const PATENTE_MSG = `La patente tiene que tener de ${String(PATENTE_MIN)} a ${String(PATENTE_MAX)} letras o números.`;
const UNA_CLAVE_MSG = 'Mandá telefono o patente, uno solo.';

/**
 * GET /api/admin/clientes/historial?telefono= | ?patente=. El teléfono se acepta como se haya escrito (se normaliza
 * como telefonoWhatsapp; uno que ya son 8 a 15 dígitos se toma tal cual). La patente se normaliza (mayúsculas, sin
 * espacios, guiones ni puntos). Sale como ClaveCliente.
 */
export const historialClienteQuerySchema = z
  .object({
    telefono: z.preprocess(trimToUndefined, z.string({ error: TELEFONO_MSG }).max(30, { error: TELEFONO_MSG }).optional()),
    patente: z.preprocess(trimToUndefined, z.string({ error: PATENTE_MSG }).max(20, { error: PATENTE_MSG }).optional()),
  })
  .transform(({ telefono, patente }, ctx): ClaveCliente => {
    if ((telefono === undefined) === (patente === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['telefono'], message: UNA_CLAVE_MSG });
      return z.NEVER;
    }
    if (telefono !== undefined) {
      // Primero como teléfono escrito (3804123456 -> 5493804123456); si no se interpreta pero ya son 8 a 15 dígitos,
      // es un telefonoWhatsapp tal cual (el que devuelve la API).
      const normalizado = telefonoWhatsapp(telefono) ?? (/^\d{8,15}$/.test(telefono) ? telefono : null);
      if (normalizado === null) {
        ctx.addIssue({ code: 'custom', path: ['telefono'], message: TELEFONO_MSG });
        return z.NEVER;
      }
      return { tipo: 'telefono', telefonoWhatsapp: normalizado };
    }
    const limpia = normalizarPatente(patente ?? '');
    if (limpia.length < PATENTE_MIN || limpia.length > PATENTE_MAX) {
      ctx.addIssue({ code: 'custom', path: ['patente'], message: PATENTE_MSG });
      return z.NEVER;
    }
    return { tipo: 'patente', patente: limpia };
  });

const DIAS_MSG = `Los días tienen que ser un número entre ${String(INACTIVOS_DIAS_MIN)} y ${String(INACTIVOS_DIAS_MAX)}.`;

/** GET /api/admin/clientes/inactivos?dias=&limit=&offset= (sin dias: los de la configuración). */
export const inactivosQuerySchema = z.object({
  dias: z.preprocess(blankToUndefined, integerParam(INACTIVOS_DIAS_MIN, INACTIVOS_DIAS_MAX, DIAS_MSG).optional()),
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

const SELLOS_MSG = `Los sellos tienen que ser un número entero entre ${String(SELLOS_MIN)} y ${String(SELLOS_MAX)}.`;
const PREMIO_MSG = 'El premio tiene que ser "gratis" o "descuento".';
const PORCENTAJE_MSG = 'El porcentaje de descuento tiene que ser un número entero entre 1 y 99.';
const INACTIVOS_MSG = `Los días de inactividad tienen que ser un número entero entre ${String(INACTIVOS_DIAS_MIN)} y ${String(INACTIVOS_DIAS_MAX)}.`;

/** PUT /api/admin/fidelizacion: la configuración completa. El porcentaje va solo con premio "descuento". */
export const fidelizacionSchema = z
  .strictObject({
    sellosCada: z.number({ error: SELLOS_MSG }).int({ error: SELLOS_MSG }).min(SELLOS_MIN, { error: SELLOS_MSG }).max(SELLOS_MAX, { error: SELLOS_MSG }),
    premio: z.enum(PREMIOS, { error: PREMIO_MSG }),
    premioPorcentaje: z
      .number({ error: PORCENTAJE_MSG })
      .int({ error: PORCENTAJE_MSG })
      .min(1, { error: PORCENTAJE_MSG })
      .max(99, { error: PORCENTAJE_MSG })
      .nullable()
      .default(null),
    inactivosDias: z
      .number({ error: INACTIVOS_MSG })
      .int({ error: INACTIVOS_MSG })
      .min(INACTIVOS_DIAS_MIN, { error: INACTIVOS_MSG })
      .max(INACTIVOS_DIAS_MAX, { error: INACTIVOS_MSG }),
  })
  .superRefine(({ premio, premioPorcentaje }, ctx) => {
    if (premio === 'descuento' && premioPorcentaje === null) {
      ctx.addIssue({ code: 'custom', path: ['premioPorcentaje'], message: 'Con premio "descuento", indicá el porcentaje.' });
    } else if (premio === 'gratis' && premioPorcentaje !== null) {
      ctx.addIssue({ code: 'custom', path: ['premioPorcentaje'], message: 'Con premio "gratis" no va porcentaje.' });
    }
  });
