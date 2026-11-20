import type { Booking, BookingRepository, NuevaSena, NuevoTurnoPanel } from '../domain/booking.js';
import { fechaConfirmadaRange } from '../domain/booking-dates.js';
import { puedeCrearTurnos, vistaDeTurno } from '../domain/permisos.js';
import type { ServicioRepository } from '../domain/servicios.js';
import { addDays, todayInLaRioja } from '../lib/dates.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { SENA_DIAS_ATRAS } from '../schemas/turnos.js';
import { NOT_FOUND_MESSAGE } from './agenda.js';
import type { UsuarioSesion } from './auth.js';
import { serviciosDelLavado } from './servicios.js';

export const SIN_PERMISO_TURNOS_MESSAGE = 'Con tu rol no podés crear turnos desde el panel.';
export const SIN_PERMISO_SENA_MESSAGE = 'Con tu rol no podés cargar ni cambiar la seña de un turno.';
export const SENA_MAYOR_QUE_TOTAL_MESSAGE = 'La seña no puede ser mayor que el total que ya se cobró.';

export interface TurnoPanelServiceDeps {
  bookings: BookingRepository;
  servicios: ServicioRepository;
  logger: Logger;
  now: () => Date;
}

/** Lo que llega ya validado por crearTurnoSchema. */
export type DatosTurnoPanel = NuevoTurnoPanel;

/** Rangos de fechas del alta: el turno de hoy a 120 días; la seña, de 31 días atrás a hoy (La Rioja). */
export function rangosTurnoPanel(now: Date): { turno: { min: string; max: string }; sena: { min: string; max: string } } {
  const hoy = todayInLaRioja(now);
  return { turno: fechaConfirmadaRange(now), sena: { min: addDays(hoy, -SENA_DIAS_ATRAS), max: hoy } };
}

/**
 * Turnos para trabajos largos que crea un admin desde el panel (contrato: reportes/2026-11-15_03_contrato-mejoras.md,
 * función 8). Reusan la agenda: es un turno más (origen 'panel', nace confirmado), con varios servicios y una seña
 * opcional. Permiso turnos.crear (domain/permisos.ts): admin y superadmin. Al completarlo (PATCH
 * /api/admin/bookings/:id), `monto` es el total y la respuesta trae el saldo (AgendaService exige monto >= seña).
 * En el log: id y quién; nunca datos del cliente ni importes.
 */
export class TurnoPanelService {
  constructor(private readonly deps: TurnoPanelServiceDeps) {}

  async crear(actor: UsuarioSesion, datos: DatosTurnoPanel): Promise<Booking> {
    if (!puedeCrearTurnos(actor.rol)) throw AppError.forbidden(SIN_PERMISO_TURNOS_MESSAGE);
    const elegidos = await serviciosDelLavado(this.deps.servicios, datos.servicioIds, datos.vehiculoTipo);
    const turno = await this.deps.bookings.crearTurnoPanel(
      { ...datos, servicioIds: elegidos.map((servicio) => servicio.id) },
      this.deps.now(),
    );
    this.deps.logger.info(`Turno del panel creado id=${turno.id} fecha=${turno.fechaPreferida} por=${actor.id}`);
    return vistaDeTurno(actor.rol, turno);
  }

  /**
   * Carga o corrige (sena) o quita (null) la seña de un turno que no es de mostrador. Si el turno ya tiene el total
   * cobrado, la seña no puede ser mayor (400 en fields.monto). 404 si no existe o es un lavado de mostrador.
   */
  async cambiarSena(actor: UsuarioSesion, id: string, sena: NuevaSena | null): Promise<Booking> {
    if (!puedeCrearTurnos(actor.rol)) throw AppError.forbidden(SIN_PERMISO_SENA_MESSAGE);
    const actual = await this.deps.bookings.find(id);
    if (actual === undefined || actual.origen === 'mostrador') throw AppError.notFound(NOT_FOUND_MESSAGE);
    if (sena !== null && actual.monto !== null && sena.monto > actual.monto) {
      throw AppError.validation({ monto: SENA_MAYOR_QUE_TOTAL_MESSAGE });
    }
    const turno = await this.deps.bookings.cambiarSena(id, sena);
    if (turno === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    this.deps.logger.info(`Seña de turno ${sena === null ? 'quitada' : 'guardada'} id=${id} por=${actor.id}`);
    return vistaDeTurno(actor.rol, turno);
  }
}
