import type { Booking, BookingRepository, Franja, NuevoLavado } from '../domain/booking.js';
import { type FormaDePago, FORMAS_DE_PAGO, TurnoConComprobanteError } from '../domain/comprobantes.js';
import type { PerfilRepository } from '../domain/perfil.js';
import type { StockPushNotifier } from '../domain/push.js';
import {
  deshacerLavadoHasta,
  puedeAnotarLavadoDeOtro,
  puedeDeshacerLavado,
  puedeRegistrarLavados,
  puedeVerImportes,
  vistaDeTurno,
} from '../domain/permisos.js';
import type { ServicioRepository } from '../domain/servicios.js';
import { AppError } from '../lib/errors.js';
import { addDays, hourInLaRioja, todayInLaRioja } from '../lib/dates.js';
import type { Logger } from '../lib/logger.js';
import { LAVADO_DIAS_ATRAS } from '../schemas/lavados.js';
import { EMPLEADO_OTRO_TRABAJADOR_MESSAGE, TRABAJADOR_INVALIDO_MESSAGE } from './agenda.js';
import type { UsuarioSesion } from './auth.js';
import { avisarStockBajo } from './inventario.js';
import { serviciosDelLavado } from './servicios.js';

/** Nombre que queda cuando el lavado se registra sin nombre de cliente. */
export const NOMBRE_MOSTRADOR = 'Cliente de mostrador';

/** Desde esta hora (La Rioja) un lavado sin franja queda "tarde". */
export const HORA_TARDE = 14;

export const LAVADO_NOT_FOUND = 'No encontramos ese lavado.';
export const DESHACER_AJENO_MESSAGE = 'Solo podés deshacer un lavado que registraste vos.';
export const ID_LOCAL_AJENO_MESSAGE = 'Ese lavado ya lo registró otra persona.';
export const LAVADO_CON_COMPROBANTE_MESSAGE =
  'Este lavado ya tiene un comprobante de pago emitido: no se puede deshacer.';

/** Lo que llega ya validado por registrarLavadoSchema. */
export interface DatosLavado {
  /** 1 a 10, sin repetidos; el primero es el principal (un servicioId suelto ya llega como [servicioId]). */
  servicioIds: string[];
  vehiculoTipo: NuevoLavado['vehiculoTipo'];
  monto: number | null;
  trabajadorId?: string | undefined;
  fecha?: string | undefined;
  franja?: Franja | undefined;
  nombre: string | null;
  telefono: string | null;
  vehiculoModelo: string | null;
  notasInternas: string | null;
  formaPago: FormaDePago | null;
  idLocal?: string | undefined;
}

/** Respuesta de POST /api/admin/lavados. */
export interface LavadoRegistrado {
  lavado: Booking;
  /** ISO 8601 UTC: hasta cuándo quien lo registró lo puede deshacer (creación + 5 minutos). */
  deshacerHasta: string;
  /** false si el idLocal ya estaba registrado por esta persona (reintento): se devuelve el original (200). */
  creado: boolean;
}

export interface ResumenFormaDePago {
  /** null = sin indicar. */
  formaPago: FormaDePago | null;
  cantidad: number;
  /** Pesos cobrados con esa forma; null para quien no ve importes. */
  total: number | null;
}

export interface LavadosDelDia {
  fecha: string;
  lavados: Booking[];
  resumen: {
    cantidad: number;
    /** Suma de los montos cargados; null para quien no ve importes. */
    total: number | null;
    /** Lavados sin monto cargado (para completarlos). */
    sinMonto: number;
    /**
     * Cierre de caja: una entrada por forma de pago usada ese día (null = sin indicar). Más cobrado primero (solo
     * para quien ve importes); si no, más lavados primero. Empates: el orden de FORMAS_DE_PAGO, "sin indicar" al final.
     */
    porFormaPago: ResumenFormaDePago[];
  };
}

/** Posición de una forma de pago en los desempates: el orden de FORMAS_DE_PAGO y "sin indicar" al final. */
const ordenForma = (forma: FormaDePago | null): number =>
  forma === null ? FORMAS_DE_PAGO.length : FORMAS_DE_PAGO.indexOf(forma);

export interface LavadoServiceDeps {
  bookings: BookingRepository;
  servicios: ServicioRepository;
  perfiles: PerfilRepository;
  logger: Logger;
  now: () => Date;
  /** Aviso push de stock bajo cuando la receta deja un insumo bajo el mínimo (después del COMMIT). */
  avisos?: StockPushNotifier | undefined;
}

/** Rango de fechas permitido para registrar un lavado: de hoy - LAVADO_DIAS_ATRAS a hoy (La Rioja). */
export function rangoLavado(now: Date): { min: string; max: string } {
  const hoy = todayInLaRioja(now);
  return { min: addDays(hoy, -LAVADO_DIAS_ATRAS), max: hoy };
}

/**
 * "Registrar lavado": el auto que llega sin turno. Se guarda como turno completado de origen 'mostrador' con su cobro,
 * así cuenta en estadísticas, metas y "mis trabajos". Queda registrado a nombre de quien lo carga (registradoPor).
 * `trabajadorId` se sigue aceptando por compatibilidad (domain/permisos.ts, lavados.registrar): admin y superadmin
 * pueden anotar a otra persona del equipo; el empleado, solo a su nombre. El panel ya no lo manda. El monto lo puede cargar
 * cualquiera al registrar (es el momento de cobrar), pero el empleado nunca lo recibe en las respuestas.
 */
export class LavadoService {
  constructor(private readonly deps: LavadoServiceDeps) {}

  async registrar(actor: UsuarioSesion, datos: DatosLavado): Promise<LavadoRegistrado> {
    const { bookings, servicios, perfiles, logger } = this.deps;
    const now = this.deps.now();
    if (!puedeRegistrarLavados(actor.rol)) throw AppError.forbidden('Con tu rol no podés registrar lavados.');

    // Reintento de la cola sin conexión: si ese idLocal ya se registró, se devuelve el original (antes de validar el
    // resto: el servicio pudo haberse desactivado entre el envío original y el reintento).
    const idLocal = datos.idLocal ?? null;
    if (idLocal !== null) {
      const previo = await this.yaRegistrado(actor, idLocal);
      if (previo !== undefined) return previo;
    }

    // Quién lavó: el empleado no elige a otra persona (se verifica antes de leer nada).
    let trabajadorId = datos.trabajadorId ?? actor.id;
    if (!puedeAnotarLavadoDeOtro(actor.rol)) {
      if (trabajadorId !== actor.id) throw AppError.forbidden(EMPLEADO_OTRO_TRABAJADOR_MESSAGE);
      trabajadorId = actor.id;
    } else if (trabajadorId !== actor.id) {
      const persona = await perfiles.findById(trabajadorId);
      if (persona?.activo !== true) throw AppError.validation({ trabajadorId: TRABAJADOR_INVALIDO_MESSAGE });
    }

    // Cada servicio: activo y ofrecido para el vehículo (400 en fields.servicioIds).
    const elegidos = await serviciosDelLavado(servicios, datos.servicioIds, datos.vehiculoTipo);

    const guardado = await bookings.registrarLavado(
      {
        nombre: datos.nombre ?? NOMBRE_MOSTRADOR,
        telefono: datos.telefono,
        vehiculoTipo: datos.vehiculoTipo,
        vehiculoModelo: datos.vehiculoModelo,
        servicioIds: elegidos.map((servicio) => servicio.id),
        fecha: datos.fecha ?? todayInLaRioja(now),
        franja: datos.franja ?? (hourInLaRioja(now) < HORA_TARDE ? 'manana' : 'tarde'),
        monto: datos.monto,
        trabajadorId,
        notasInternas: datos.notasInternas,
        formaPago: datos.formaPago,
        registradoPor: actor.id,
        idLocal,
      },
      now,
    );
    if (guardado === undefined) {
      // Otro pedido con el mismo idLocal entró entre la búsqueda y el INSERT: el índice único lo frenó.
      const previo = idLocal === null ? undefined : await this.yaRegistrado(actor, idLocal);
      if (previo === undefined) throw new Error('El lavado con ese idLocal no se encontró');
      return previo;
    }
    const { lavado, stockBajo } = guardado;
    // Sin importe ni datos del cliente en el log.
    logger.info(`Lavado registrado id=${lavado.id} servicios=${elegidos.map((s) => s.id).join(',')} por=${actor.id}`);
    // El stock lo descontó la misma transacción (receta); el aviso sale ahora, después del COMMIT, y nunca falla.
    avisarStockBajo(this.deps.avisos, logger, stockBajo);
    return { lavado: vistaDeTurno(actor.rol, lavado), deshacerHasta: deshacerLavadoHasta(lavado.createdAt), creado: true };
  }

  /** El lavado ya registrado con ese idLocal (creado: false), 409 si lo registró otra persona, o undefined. */
  private async yaRegistrado(actor: UsuarioSesion, idLocal: string): Promise<LavadoRegistrado | undefined> {
    const lavado = await this.deps.bookings.lavadoPorIdLocal(idLocal);
    if (lavado === undefined) return undefined;
    if (lavado.registradoPor?.id !== actor.id) throw AppError.conflict(ID_LOCAL_AJENO_MESSAGE);
    return { lavado: vistaDeTurno(actor.rol, lavado), deshacerHasta: deshacerLavadoHasta(lavado.createdAt), creado: false };
  }

  /**
   * "Deshacer" (DELETE /api/admin/lavados/:id): borra un lavado de mostrador. Reglas (domain/permisos.ts,
   * lavados.deshacer): quien puede borrar turnos, siempre; quien lo registró, hasta 5 minutos después (deps.now).
   * 404 si no existe o no es de mostrador; 403 FORBIDDEN si es de otra persona; 403 PLAZO_DESHACER_VENCIDO si pasó
   * el plazo; 409 TURNO_CON_COMPROBANTE si ya tiene comprobante emitido.
   */
  async deshacer(actor: UsuarioSesion, id: string): Promise<void> {
    const { bookings, logger } = this.deps;
    const registro = await bookings.registroDeLavado(id);
    if (registro === undefined) throw AppError.notFound(LAVADO_NOT_FOUND);

    const permiso = puedeDeshacerLavado(actor.rol, actor.id, registro, this.deps.now());
    if (permiso === 'no') throw AppError.forbidden(DESHACER_AJENO_MESSAGE);
    if (permiso === 'vencido') throw AppError.plazoDeshacerVencido();

    try {
      // Devuelve al stock lo que descontó su receta, en la misma transacción que el borrado (regla 4).
      if (!(await bookings.delete(id, actor.id))) throw AppError.notFound(LAVADO_NOT_FOUND);
    } catch (error) {
      if (error instanceof TurnoConComprobanteError) throw AppError.turnoConComprobante(LAVADO_CON_COMPROBANTE_MESSAGE);
      throw error;
    }
    logger.info(`Lavado deshecho id=${id} por=${actor.id}`);
  }

  async delDia(actor: UsuarioSesion, fecha: string | undefined): Promise<LavadosDelDia> {
    const dia = fecha ?? todayInLaRioja(this.deps.now());
    const [delDia, formas] = await Promise.all([
      this.deps.bookings.lavadosDelDia(dia),
      this.deps.bookings.formasDePagoDelDia(dia),
    ]);
    const lavados = delDia.filter((l) => l.estado !== 'cancelado');
    const veImportes = puedeVerImportes(actor.rol);
    const suma = (lista: Booking[]) => lista.reduce((acc, l) => acc + (l.monto ?? 0), 0);

    return {
      fecha: dia,
      lavados: lavados.map((l) => vistaDeTurno(actor.rol, l)),
      resumen: {
        cantidad: lavados.length,
        total: veImportes ? suma(lavados) : null,
        sinMonto: lavados.filter((l) => l.monto === null).length,
        // Sin importes, el orden no depende de lo cobrado (si no, el orden mismo lo revelaría).
        porFormaPago: formas
          .sort(
            (a, b) =>
              (veImportes ? b.total - a.total : 0) ||
              b.cantidad - a.cantidad ||
              ordenForma(a.formaPago) - ordenForma(b.formaPago),
          )
          .map(({ formaPago, cantidad, total }) => ({ formaPago, cantidad, total: veImportes ? total : null })),
      },
    };
  }
}
