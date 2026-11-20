import {
  type Booking,
  type BookingRepository,
  type CorreccionDeStock,
  ESTADOS_CERRADOS,
  type Estado,
  MONTO_MAX,
  type Reprogramacion,
  TurnoCerradoError,
} from '../domain/booking.js';
import { fechaConfirmadaRange, MAX_DAYS_CONFIRMADA } from '../domain/booking-dates.js';
import type { PerfilRepository } from '../domain/perfil.js';
import type { StockPushNotifier } from '../domain/push.js';
import type { ServicioRepository } from '../domain/servicios.js';
import { puedeCambiarEstado, puedeCorregirCobro, puedeRegistrarCobro, puedeReprogramar } from '../domain/permisos.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { CambiosTurno } from '../schemas/admin.js';
import type { AvisoService } from './avisos.js';
import type { UsuarioSesion } from './auth.js';
import { avisarStockBajo } from './inventario.js';
import { serviciosDelLavado } from './servicios.js';

export interface AgendaServiceDeps {
  bookings: BookingRepository;
  /** Para comprobar que los servicios nuevos de un turno (servicioIds) estén activos y se ofrezcan para su vehículo. */
  servicios: ServicioRepository;
  /** Para comprobar que quien hizo el trabajo existe y está activo. */
  perfiles: PerfilRepository;
  logger: Logger;
  now: () => Date;
  /** Aviso push de stock bajo si corregir los servicios de un lavado deja un insumo bajo el mínimo. */
  avisos?: StockPushNotifier | undefined;
  /** Avisos push al encargado (meta del mes cumplida). Opcional: sin él no se avisa. */
  avisosEquipo?: AvisoService;
}

export const NOT_FOUND_MESSAGE = 'No encontramos ese turno.';
export const SOLO_COMPLETAR_MESSAGE = 'Con tu rol solo podés marcar los turnos como completados.';
export const SIN_PERMISO_REPROGRAMAR_MESSAGE = 'Con tu rol no podés cambiar la fecha de un turno.';
const CERRADO_MESSAGE = 'No se puede cambiar la fecha de un turno cancelado o completado.';
export const COBRO_SOLO_COMPLETADO_MESSAGE = 'El cobro y quién hizo el trabajo solo se cargan en un turno completado.';
export const EMPLEADO_SIN_MONTO_MESSAGE = 'Con tu rol no podés cargar el monto cobrado: lo completa un administrador.';
export const EMPLEADO_OTRO_TRABAJADOR_MESSAGE = 'Con tu rol, quien hizo el trabajo sos vos: no podés elegir a otra persona.';
export const EMPLEADO_COBRO_COMPLETADO_MESSAGE = 'Con tu rol no podés cambiar el cobro de un turno ya completado.';
export const TRABAJADOR_INVALIDO_MESSAGE = 'Elegí una persona activa del panel.';
export const EMPLEADO_FORMA_PAGO_MESSAGE = 'Con tu rol no podés cambiar la forma de pago: la corrige un administrador.';
export const EMPLEADO_SERVICIOS_MESSAGE = 'Con tu rol no podés cambiar los servicios de un turno: los corrige un administrador.';
export const MOSTRADOR_NO_SE_CANCELA_MESSAGE =
  'Un lavado de mostrador no se cancela: borralo desde la planilla (así vuelven los productos al stock).';
export const EMPLEADO_DESCUENTO_MESSAGE = 'Con tu rol no podés cargar descuentos: lo carga un administrador.';
export const MONTO_MENOR_SENA_MESSAGE = 'El total no puede ser menor que la seña que ya se cobró.';
const DESCUENTO_TOPE_MESSAGE = `El monto más el descuento no puede pasar de ${MONTO_MAX.toLocaleString('es-AR')}.`;

/** Errores por campo cuando se manda cobro (con valor) para un turno que no queda completado. */
function erroresCobroSinCompletar(
  monto: number | null | undefined,
  trabajadorId: string | null | undefined,
  descuento?: { monto: number },
): Record<string, string> {
  return {
    ...(monto != null && { monto: COBRO_SOLO_COMPLETADO_MESSAGE }),
    ...(trabajadorId != null && { trabajadorId: COBRO_SOLO_COMPLETADO_MESSAGE }),
    ...(descuento !== undefined && descuento.monto > 0 && { descuento: COBRO_SOLO_COMPLETADO_MESSAGE }),
  };
}

/**
 * Agenda de turnos (contrato: reportes/2026-10-22_08_agenda.md): la consulta por rango y la reprogramación (fecha y
 * franja confirmadas, opcionalmente junto con el estado). Permisos de domain/permisos.ts; rango de fechas de
 * domain/booking-dates.ts. En el log, solo id del turno, quién y la fecha nueva: nunca datos del cliente.
 */
export class AgendaService {
  constructor(private readonly deps: AgendaServiceDeps) {}

  /** Turnos no cancelados con fecha de agenda en [desde, hasta]. El rango ya viene validado (schemas/admin.ts). */
  agenda(desde: string, hasta: string): Promise<Booking[]> {
    return this.deps.bookings.agenda(desde, hasta);
  }

  /**
   * PATCH /api/admin/bookings/:id: estado, nota interna, fecha/franja confirmadas y cobro (monto y trabajador), con
   * todas las reglas del contrato (reportes/2026-10-26_15_estadisticas-y-permisos.md):
   *  - el cobro solo vale si el turno QUEDA completado (400 con fields.monto / fields.trabajadorId); mandar null no
   *    es error: en un turno que no está completado no hay nada que borrar;
   *  - admin y superadmin cargan el monto y eligen a cualquier persona ACTIVA (400 en fields.trabajadorId si no existe
   *    o está inactiva) y pueden corregirlos en un turno ya completado;
   *  - el empleado, al completar un turno, queda él mismo como trabajador; 403 si manda un monto, a otra persona o si
   *    toca el cobro de un turno que ya estaba completado;
   *  - si el estado pasa a algo distinto de completado, monto y trabajador se borran (lo hace el repositorio);
   *  - la forma de pago (formaPago) la cambia quien corrige el cobro (cobro.corregir; 403 para el empleado), en
   *    cualquier estado, y no mueve updated_at;
   *  - los servicios (servicioIds: 1 a 10, sin repetidos, activos y ofrecidos para el vehículo del turno; 400 en
   *    fields.servicioIds) también los cambia quien corrige el cobro, en cualquier estado: reemplazan la lista y el
   *    principal (el primero) y mueven updated_at (el servicio se ve en el seguimiento). La misma lista de antes no
   *    escribe nada;
   *  - un lavado de mostrador nace completado y no sale de ahí: pasarlo a cualquier otro estado es 409 (se deshace
   *    desde la planilla, que devuelve el stock; contrato 2026-11-17_06, decisión del dueño). Los turnos web no cambian;
   *  - todo se valida antes de escribir: o se guarda todo o nada.
   * Cargar o corregir solo el cobro no mueve updated_at (es el "actualizado el" que ve el cliente).
   */
  async modificar(actor: UsuarioSesion, id: string, cambios: CambiosTurno): Promise<Booking> {
    const { estado, confirmada, notasInternas, monto, trabajadorId, formaPago, servicioIds, descuento } = cambios;
    if (formaPago !== undefined && !puedeCorregirCobro(actor.rol)) throw AppError.forbidden(EMPLEADO_FORMA_PAGO_MESSAGE);
    if (descuento !== undefined && !puedeCorregirCobro(actor.rol)) throw AppError.forbidden(EMPLEADO_DESCUENTO_MESSAGE);
    if (servicioIds !== undefined && !puedeCorregirCobro(actor.rol)) throw AppError.forbidden(EMPLEADO_SERVICIOS_MESSAGE);
    // Los servicios se validan antes de escribir nada (o se guarda todo o nada).
    const servicios = servicioIds === undefined ? undefined : await this.serviciosNuevos(id, servicioIds);
    // La forma de pago y los servicios van junto con la nota en cada escritura (no dependen del estado del turno).
    const nota = {
      ...(notasInternas !== undefined && { notasInternas }),
      ...(formaPago !== undefined && { formaPago }),
      ...(servicios !== undefined && { servicioIds: servicios }),
    };

    // Con fecha/franja: reprogramar. Un turno que se reprograma no está (ni queda) completado: no admite cobro.
    if (confirmada !== undefined) {
      if (monto != null || trabajadorId != null || (descuento !== undefined && descuento.monto > 0)) {
        if (!puedeReprogramar(actor.rol)) throw AppError.forbidden(SIN_PERMISO_REPROGRAMAR_MESSAGE);
        throw AppError.validation(erroresCobroSinCompletar(monto, trabajadorId, descuento));
      }
      return this.reprogramar(actor, id, { confirmada, ...(estado !== undefined && { estado }), ...nota });
    }

    if (estado !== undefined && !puedeCambiarEstado(actor.rol, estado)) throw AppError.forbidden(SOLO_COMPLETAR_MESSAGE);
    await this.verificarEstadoDeMostrador(id, estado);

    const completaTodo = puedeRegistrarCobro(actor.rol);
    const tocaCobro = monto !== undefined || trabajadorId !== undefined || descuento !== undefined;
    const empleadoCompleta = !completaTodo && estado === 'completado';
    const now = this.deps.now();

    if (!tocaCobro && !empleadoCompleta) {
      // Solo servicioIds, y son los mismos que ya tenía: no se escribe (el trigger movería updated_at).
      if (estado === undefined && Object.keys(nota).length === 0) {
        const actual = await this.deps.bookings.find(id);
        if (actual === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
        return actual;
      }
      // Sin cobro de por medio: estado y/o nota, como siempre (el repositorio borra el cobro si el turno sale de completado).
      const stock = this.correccionDeStock(actor);
      const booking = await this.deps.bookings.actualizar(id, { ...(estado !== undefined && { estado }), ...nota }, now, stock);
      if (booking === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
      avisarStockBajo(this.deps.avisos, this.deps.logger, stock.stockBajo);
      return booking;
    }

    // El empleado no maneja plata ni elige a otra persona (se verifica antes de leer nada).
    if (!completaTodo) {
      if (monto !== undefined) throw AppError.forbidden(EMPLEADO_SIN_MONTO_MESSAGE);
      if (trabajadorId !== undefined && trabajadorId !== actor.id) {
        throw AppError.forbidden(EMPLEADO_OTRO_TRABAJADOR_MESSAGE);
      }
    }

    const actual = await this.deps.bookings.find(id);
    if (actual === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    const yaCompletado = actual.estado === 'completado';
    if (!completaTodo && tocaCobro && yaCompletado) throw AppError.forbidden(EMPLEADO_COBRO_COMPLETADO_MESSAGE);

    let cobro: {
      monto?: number | null;
      trabajadorId?: string | null;
      descuento?: { monto: number; motivo: string | null };
    } = {};
    if ((estado ?? actual.estado) !== 'completado') {
      const errores = erroresCobroSinCompletar(monto, trabajadorId, descuento);
      if (Object.keys(errores).length > 0) throw AppError.validation(errores);
    } else if (completaTodo) {
      if (trabajadorId != null) {
        const persona = await this.deps.perfiles.findById(trabajadorId);
        if (persona?.activo !== true) throw AppError.validation({ trabajadorId: TRABAJADOR_INVALIDO_MESSAGE });
      }
      // Con los valores que van a quedar: el total no puede ser menor que la seña ni pasar el tope con el descuento.
      const montoFinal = monto !== undefined ? monto : actual.monto;
      const descuentoFinal = descuento?.monto ?? actual.descuento ?? 0;
      const sena = actual.sena?.monto ?? null;
      if (monto !== undefined && montoFinal !== null && sena !== null && montoFinal < sena) {
        throw AppError.validation({ monto: MONTO_MENOR_SENA_MESSAGE });
      }
      if (montoFinal !== null && montoFinal + descuentoFinal > MONTO_MAX) {
        throw AppError.validation({ descuento: DESCUENTO_TOPE_MESSAGE });
      }
      cobro = {
        ...(monto !== undefined && { monto }),
        ...(trabajadorId !== undefined && { trabajadorId }),
        ...(descuento !== undefined && { descuento }),
      };
    } else if (!yaCompletado) {
      cobro = { trabajadorId: actor.id }; // el empleado que completa un turno queda como quien lo hizo
    }

    // Nada cambia de verdad (por ejemplo, "Guardar" sin tocar nada): no se escribe, así el cliente no ve un cambio.
    const igualEstado = estado === undefined || estado === actual.estado;
    const igualCobro =
      (cobro.monto === undefined || cobro.monto === actual.monto) &&
      (cobro.trabajadorId === undefined || cobro.trabajadorId === (actual.trabajador?.id ?? null));
    const igualForma = formaPago === undefined || formaPago === actual.formaPago;
    const igualDescuento =
      cobro.descuento === undefined ||
      (cobro.descuento.monto === actual.descuento && cobro.descuento.motivo === actual.descuentoMotivo);
    if (igualEstado && notasInternas === undefined && igualCobro && igualForma && igualDescuento && servicios === undefined) {
      return actual;
    }

    const stock = this.correccionDeStock(actor);
    const booking = await this.deps.bookings.actualizar(
      id,
      { ...(estado !== undefined && { estado }), ...nota, ...cobro },
      now,
      stock,
    );
    if (booking === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    avisarStockBajo(this.deps.avisos, this.deps.logger, stock.stockBajo);
    if (cobro.monto !== undefined || cobro.trabajadorId !== undefined || cobro.descuento !== undefined) {
      this.deps.logger.info(`Cobro de turno actualizado id=${booking.id} por=${actor.id}`); // sin el importe
    }
    // Completar o cobrar mueve los ingresos y los trabajos del mes: puede cumplir la meta (aviso push, una vez).
    if (booking.estado === 'completado') this.deps.avisosEquipo?.revisarMeta();
    return booking;
  }

  /**
   * 409 si `estado` saca de completado a un lavado de mostrador (404 si el turno no existe). El origen de un turno no
   * cambia nunca, así que leerlo antes de escribir no deja carreras. Sin estado, o con 'completado', no lee nada.
   */
  private async verificarEstadoDeMostrador(id: string, estado: Estado | undefined): Promise<void> {
    if (estado === undefined || estado === 'completado') return;
    const actual = await this.deps.bookings.find(id);
    if (actual === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    if (actual.origen === 'mostrador') throw AppError.conflict(MOSTRADOR_NO_SE_CANCELA_MESSAGE);
  }

  /**
   * Con quién se registran los movimientos si la corrección cambia los servicios de un lavado de mostrador (el
   * repositorio devuelve lo que descontó la receta y descuenta la nueva, regla 5) y dónde quedan los insumos que
   * cruzaron su mínimo.
   */
  private correccionDeStock(actor: UsuarioSesion): CorreccionDeStock {
    return { perfilId: actor.id, stockBajo: [] };
  }

  /**
   * Los servicios nuevos del turno, ya verificados contra el catálogo y el vehículo del turno (400 en
   * fields.servicioIds; 404 si el turno no existe). undefined si son los mismos que ya tiene, en el mismo orden: no hay
   * nada que escribir.
   */
  private async serviciosNuevos(id: string, servicioIds: readonly string[]): Promise<string[] | undefined> {
    const actual = await this.deps.bookings.find(id);
    if (actual === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);
    const elegidos = await serviciosDelLavado(this.deps.servicios, servicioIds, actual.vehiculoTipo);
    const ids = elegidos.map((servicio) => servicio.id);
    const iguales = ids.length === actual.servicios.length && ids.every((sid, i) => actual.servicios[i]?.id === sid);
    return iguales ? undefined : ids;
  }

  /**
   * Cambia la fecha/franja confirmadas (null = volver a la pedida) y, si viene, el estado en la misma escritura.
   * 403 si el rol no puede reprogramar (o no puede pasar a ese estado); 400 si el turno está (o quedaría)
   * cancelado o completado, o si la fecha está fuera de rango; 404 si no existe.
   */
  async reprogramar(actor: UsuarioSesion, id: string, cambios: Reprogramacion): Promise<Booking> {
    const { estado, confirmada } = cambios;
    if (!puedeReprogramar(actor.rol)) throw AppError.forbidden(SIN_PERMISO_REPROGRAMAR_MESSAGE);
    if (estado !== undefined && !puedeCambiarEstado(actor.rol, estado)) throw AppError.forbidden(SOLO_COMPLETAR_MESSAGE);
    await this.verificarEstadoDeMostrador(id, estado);

    // Confirmar una fecha y a la vez cancelar o completar el turno no tiene sentido: se rechaza igual que
    // reprogramar uno que ya está cerrado.
    if (estado !== undefined && ESTADOS_CERRADOS.includes(estado)) throw AppError.validation(undefined, CERRADO_MESSAGE);

    const now = this.deps.now();
    if (confirmada !== null) {
      const { min, max } = fechaConfirmadaRange(now);
      if (confirmada.fecha < min) {
        throw AppError.validation({ fechaConfirmada: 'La fecha confirmada no puede ser anterior a hoy.' });
      }
      if (confirmada.fecha > max) {
        throw AppError.validation({
          fechaConfirmada: `La fecha confirmada puede ser hasta ${String(MAX_DAYS_CONFIRMADA)} días desde hoy.`,
        });
      }
    }

    let booking: Booking | undefined;
    try {
      booking = await this.deps.bookings.reprogramar(id, cambios, now);
    } catch (error) {
      if (error instanceof TurnoCerradoError) throw AppError.validation(undefined, CERRADO_MESSAGE);
      throw error;
    }
    if (booking === undefined) throw AppError.notFound(NOT_FOUND_MESSAGE);

    const destino = confirmada === null ? 'la pedida' : `${confirmada.fecha} ${confirmada.franja}`;
    this.deps.logger.info(
      `Turno reprogramado id=${booking.id} por=${actor.id} fecha=${destino}${estado === undefined ? '' : ` estado=${estado}`}`,
    );
    return booking;
  }
}
