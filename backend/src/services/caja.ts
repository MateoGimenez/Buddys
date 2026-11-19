import {
  CAJA_DIAS_ATRAS,
  type CajaEsperada,
  type CajaRepository,
  type CierreGuardado,
  type PorForma,
  diferenciaDe,
  mismaFoto,
} from '../domain/caja.js';
import { type FormaDePago, FORMAS_DE_PAGO } from '../domain/comprobantes.js';
import { puedeReabrirCaja } from '../domain/permisos.js';
import { addDays, daysBetween, todayInLaRioja } from '../lib/dates.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { UsuarioSesion } from './auth.js';

export const CAJA_CERRADA_MESSAGE = 'Esta caja ya está cerrada: solo el superadmin la puede corregir o reabrir.';
export const CIERRE_NOT_FOUND = 'Ese día no tiene un cierre de caja.';
const FECHA_FUTURA_MSG = 'No se puede cerrar la caja de un día que todavía no llegó.';
const FECHA_VIEJA_MSG = `Solo se puede cerrar la caja de los últimos ${String(CAJA_DIAS_ATRAS)} días.`;

export interface CajaServiceDeps {
  caja: CajaRepository;
  logger: Logger;
  now: () => Date;
}

export interface CajaEsperadaJson {
  formas: { formaPago: FormaDePago; esperado: number }[];
  sinIndicar: number;
  total: number;
}

export interface CierreJson {
  fecha: string;
  formas: { formaPago: FormaDePago; esperado: number; contado: number | null; diferencia: number | null }[];
  sinIndicar: number;
  esperadoTotal: number;
  contadoTotal: number;
  diferencia: number;
  nota: string | null;
  cerradoPor: { id: string; nombre: string } | null;
  cerradoEl: string;
  actualizadoEl: string;
  /** true si lo esperado de hoy ya no coincide con la foto del cierre (se tocó un lavado después de cerrar). */
  cambiosDespues: boolean;
}

function esperadoJson(esperado: CajaEsperada): CajaEsperadaJson {
  const formas = FORMAS_DE_PAGO.map((formaPago) => ({ formaPago, esperado: esperado.porForma[formaPago] }));
  return {
    formas,
    sinIndicar: esperado.sinIndicar,
    total: formas.reduce((s, f) => s + f.esperado, 0) + esperado.sinIndicar,
  };
}

function cierreJson(cierre: CierreGuardado, actual: CajaEsperada): CierreJson {
  const formas = FORMAS_DE_PAGO.map((formaPago) => {
    const contado = cierre.contado[formaPago];
    const esperado = cierre.esperado[formaPago];
    return { formaPago, esperado, contado, diferencia: contado === null ? null : contado - esperado };
  });
  return {
    fecha: cierre.fecha,
    formas,
    sinIndicar: cierre.sinIndicar,
    esperadoTotal: formas.reduce((s, f) => s + f.esperado, 0) + cierre.sinIndicar,
    contadoTotal: formas.reduce((s, f) => s + (f.contado ?? 0), 0),
    diferencia: cierre.diferencia,
    nota: cierre.nota,
    cerradoPor: cierre.cerradoPor,
    cerradoEl: cierre.createdAt,
    actualizadoEl: cierre.updatedAt,
    cambiosDespues: !mismaFoto(actual, cierre),
  };
}

/**
 * Cierre de caja con arqueo (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 11). Ver y cerrar un día
 * sin cierre: admin y superadmin (lo exige la ruta, caja.cerrar). Corregir o reabrir uno ya cerrado: solo el
 * superadmin (caja.reabrir). En el log: el día y quién; nunca importes.
 */
export class CajaService {
  constructor(private readonly deps: CajaServiceDeps) {}

  private hoy(): string {
    return todayInLaRioja(this.deps.now());
  }

  private verificarFecha(fecha: string): void {
    const hoy = this.hoy();
    if (fecha > hoy) throw AppError.validation({ fecha: FECHA_FUTURA_MSG });
    if (daysBetween(fecha, hoy) > CAJA_DIAS_ATRAS) throw AppError.validation({ fecha: FECHA_VIEJA_MSG });
  }

  async delDia(fechaPedida: string | undefined): Promise<{ fecha: string; esperado: CajaEsperadaJson; cierre: CierreJson | null }> {
    const fecha = fechaPedida ?? this.hoy();
    const [esperado, cierre] = await Promise.all([this.deps.caja.esperado(fecha), this.deps.caja.obtener(fecha)]);
    return { fecha, esperado: esperadoJson(esperado), cierre: cierre === undefined ? null : cierreJson(cierre, esperado) };
  }

  /** Cierra (201: creado true) o corrige (200) la caja de un día con la foto de lo esperado de este momento. */
  async cerrar(
    actor: UsuarioSesion,
    fecha: string,
    datos: { contado: PorForma<number | null> & { efectivo: number }; nota: string | null },
  ): Promise<{ cierre: CierreJson; creado: boolean }> {
    this.verificarFecha(fecha);
    const [existente, esperado] = await Promise.all([this.deps.caja.obtener(fecha), this.deps.caja.esperado(fecha)]);
    const corrige = puedeReabrirCaja(actor.rol);
    if (existente !== undefined && !corrige) throw AppError.forbidden(CAJA_CERRADA_MESSAGE);
    const nuevo = {
      fecha,
      contado: datos.contado,
      esperado: esperado.porForma,
      sinIndicar: esperado.sinIndicar,
      diferencia: diferenciaDe(datos.contado, esperado.porForma),
      nota: datos.nota,
      cerradoPor: actor.id,
    };
    // Solo el superadmin pisa un cierre (upsert). Los demás cierran un día sin cierre: si otro cierre entró en el medio,
    // el INSERT no hace nada y es un 409 (nunca se pisa lo que contó otra persona).
    const guardado = corrige ? await this.deps.caja.guardar(nuevo, this.deps.now()) : await this.deps.caja.crear(nuevo);
    if (guardado === undefined) throw AppError.conflict(CAJA_CERRADA_MESSAGE);
    this.deps.logger.info(`Caja ${existente === undefined ? 'cerrada' : 'corregida'} fecha=${fecha} por=${actor.id}`);
    return { cierre: cierreJson(guardado, esperado), creado: existente === undefined };
  }

  /** Reabre: borra el cierre. Solo el superadmin (lo exige la ruta). */
  async reabrir(actor: UsuarioSesion, fecha: string): Promise<void> {
    if (!(await this.deps.caja.borrar(fecha))) throw AppError.notFound(CIERRE_NOT_FOUND);
    this.deps.logger.info(`Caja reabierta fecha=${fecha} por=${actor.id}`);
  }

  async listar(pedido: { desde?: string | undefined; hasta?: string | undefined; limit: number; offset: number }): Promise<{ cierres: CierreJson[]; total: number }> {
    const hasta = pedido.hasta ?? this.hoy();
    const desde = pedido.desde ?? addDays(hasta, -30);
    if (daysBetween(desde, hasta) < 0) throw AppError.validation({ hasta: '"hasta" no puede ser anterior a "desde".' });
    const { cierres, total } = await this.deps.caja.listar(desde, hasta, pedido.limit, pedido.offset);
    const actuales = await Promise.all(cierres.map((c) => this.deps.caja.esperado(c.fecha)));
    return { cierres: cierres.map((c, i) => cierreJson(c, actuales[i] ?? { porForma: c.esperado, sinIndicar: c.sinIndicar })), total };
  }
}
