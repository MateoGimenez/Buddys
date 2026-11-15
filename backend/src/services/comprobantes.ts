import {
  type Comprobante,
  type ComprobanteRepository,
  type DatosComprobante,
  FormaDePagoFaltanteError,
  TurnoNoEncontradoError,
  TurnoSinCobroError,
  PRIMERO_CARGA_EL_COBRO,
} from '../domain/comprobantes.js';
import { todayInLaRioja } from '../lib/dates.js';
import { AppError } from '../lib/errors.js';
import { FORMA_PAGO_MSG } from '../schemas/documentos.js';
import type { Logger } from '../lib/logger.js';
import type { UsuarioSesion } from './auth.js';

export interface ComprobanteServiceDeps {
  comprobantes: ComprobanteRepository;
  logger: Logger;
  now: () => Date;
}

export const COMPROBANTE_NOT_FOUND = 'Este turno todavía no tiene comprobante.';
export const TURNO_NOT_FOUND = 'No encontramos ese turno.';
export const COMPROBANTE_ID_NOT_FOUND = 'No encontramos ese comprobante.';

/**
 * Casos de uso de los comprobantes de pago (contrato: reportes/2026-10-27_17_finanzas-inventario-documentos.md). Los
 * permisos los exige la ruta (domain/permisos.ts, puedeEmitirComprobantes). NO son facturas. En el log: quién y qué id.
 */
export class ComprobanteService {
  constructor(private readonly deps: ComprobanteServiceDeps) {}

  /**
   * Idempotente: si el turno ya tiene comprobante, lo devuelve (`creado: false`) y no emite otro. Sin formaPago, usa
   * la del turno (la que se cargó con el lavado); si tampoco tiene: 400 en fields.formaPago.
   */
  async emitir(
    actor: UsuarioSesion,
    bookingId: string,
    datos: DatosComprobante,
  ): Promise<{ comprobante: Comprobante; creado: boolean }> {
    try {
      const emision = await this.deps.comprobantes.emitir(bookingId, datos, {
        perfilId: actor.id,
        hoy: todayInLaRioja(this.deps.now()),
      });
      if (emision.creado) {
        this.deps.logger.info(`Comprobante emitido id=${emision.comprobante.id} turno=${bookingId} por=${actor.id}`);
      }
      return emision;
    } catch (error) {
      if (error instanceof TurnoNoEncontradoError) throw AppError.notFound(TURNO_NOT_FOUND);
      if (error instanceof TurnoSinCobroError) throw AppError.validation(undefined, PRIMERO_CARGA_EL_COBRO);
      if (error instanceof FormaDePagoFaltanteError) throw AppError.validation({ formaPago: FORMA_PAGO_MSG });
      throw error;
    }
  }

  async deTurno(bookingId: string): Promise<Comprobante> {
    const comprobante = await this.deps.comprobantes.deTurno(bookingId);
    if (comprobante === null) throw AppError.notFound(COMPROBANTE_NOT_FOUND);
    return comprobante;
  }

  async obtener(id: string): Promise<Comprobante> {
    const comprobante = await this.deps.comprobantes.obtener(id);
    if (comprobante === null) throw AppError.notFound(COMPROBANTE_ID_NOT_FOUND);
    return comprobante;
  }
}
