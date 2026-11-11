import type { Booking, BookingRepository, Franja, NuevoLavado, Trabajador } from '../domain/booking.js';
import type { PerfilRepository } from '../domain/perfil.js';
import { puedeAnotarLavadoDeOtro, puedeRegistrarLavados, puedeVerImportes, vistaDeTurno } from '../domain/permisos.js';
import type { ServicioRepository } from '../domain/servicios.js';
import { AppError } from '../lib/errors.js';
import { addDays, hourInLaRioja, todayInLaRioja } from '../lib/dates.js';
import type { Logger } from '../lib/logger.js';
import { SERVICIO_MSG } from '../schemas/bookings.js';
import { LAVADO_DIAS_ATRAS } from '../schemas/lavados.js';
import { EMPLEADO_OTRO_TRABAJADOR_MESSAGE, TRABAJADOR_INVALIDO_MESSAGE } from './agenda.js';
import type { UsuarioSesion } from './auth.js';

/** Nombre que queda cuando el lavado se registra sin nombre de cliente. */
export const NOMBRE_MOSTRADOR = 'Cliente de mostrador';

/** Desde esta hora (La Rioja) un lavado sin franja queda "tarde". */
export const HORA_TARDE = 14;

/** Lo que llega ya validado por registrarLavadoSchema. */
export interface DatosLavado {
  servicioId: string;
  vehiculoTipo: NuevoLavado['vehiculoTipo'];
  monto: number | null;
  trabajadorId?: string | undefined;
  fecha?: string | undefined;
  franja?: Franja | undefined;
  nombre: string | null;
  telefono: string | null;
  vehiculoModelo: string | null;
  notasInternas: string | null;
}

export interface ResumenTrabajador {
  trabajador: Trabajador | null;
  cantidad: number;
  /** Pesos cobrados; null para quien no ve importes. */
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
     * Quién lavó más ese día: más lavados primero; a igual cantidad, más cobrado (solo para quien ve importes) y después
     * por nombre.
     */
    porTrabajador: ResumenTrabajador[];
  };
}

export interface LavadoServiceDeps {
  bookings: BookingRepository;
  servicios: ServicioRepository;
  perfiles: PerfilRepository;
  logger: Logger;
  now: () => Date;
}

/** Rango de fechas permitido para registrar un lavado: de hoy - LAVADO_DIAS_ATRAS a hoy (La Rioja). */
export function rangoLavado(now: Date): { min: string; max: string } {
  const hoy = todayInLaRioja(now);
  return { min: addDays(hoy, -LAVADO_DIAS_ATRAS), max: hoy };
}

/**
 * "Registrar lavado": el auto que llega sin turno. Se guarda como turno completado de origen 'mostrador' con su cobro,
 * así cuenta en estadísticas, metas y el ranking del equipo. Permisos (domain/permisos.ts, lavados.registrar):
 * admin y superadmin anotan a cualquiera del equipo; el empleado, solo a su nombre. El monto lo puede cargar
 * cualquiera al registrar (es el momento de cobrar), pero el empleado nunca lo recibe en las respuestas.
 */
export class LavadoService {
  constructor(private readonly deps: LavadoServiceDeps) {}

  async registrar(actor: UsuarioSesion, datos: DatosLavado): Promise<Booking> {
    const { bookings, servicios, perfiles, logger } = this.deps;
    const now = this.deps.now();
    if (!puedeRegistrarLavados(actor.rol)) throw AppError.forbidden('Con tu rol no podés registrar lavados.');

    // Quién lavó: el empleado no elige a otra persona (se verifica antes de leer nada).
    let trabajadorId = datos.trabajadorId ?? actor.id;
    if (!puedeAnotarLavadoDeOtro(actor.rol)) {
      if (trabajadorId !== actor.id) throw AppError.forbidden(EMPLEADO_OTRO_TRABAJADOR_MESSAGE);
      trabajadorId = actor.id;
    } else if (trabajadorId !== actor.id) {
      const persona = await perfiles.findById(trabajadorId);
      if (persona?.activo !== true) throw AppError.validation({ trabajadorId: TRABAJADOR_INVALIDO_MESSAGE });
    }

    const servicio = await servicios.findById(datos.servicioId);
    if (!servicio?.activo) throw AppError.validation({ servicioId: SERVICIO_MSG });
    if (!servicio.vehiculos.includes(datos.vehiculoTipo)) {
      throw AppError.validation({ servicioId: `Ese servicio no se ofrece para ${datos.vehiculoTipo}. Elegí otro.` });
    }

    const lavado = await bookings.registrarLavado(
      {
        nombre: datos.nombre ?? NOMBRE_MOSTRADOR,
        telefono: datos.telefono,
        vehiculoTipo: datos.vehiculoTipo,
        vehiculoModelo: datos.vehiculoModelo,
        servicioId: servicio.id,
        fecha: datos.fecha ?? todayInLaRioja(now),
        franja: datos.franja ?? (hourInLaRioja(now) < HORA_TARDE ? 'manana' : 'tarde'),
        monto: datos.monto,
        trabajadorId,
        notasInternas: datos.notasInternas,
      },
      now,
    );
    // Sin importe ni datos del cliente en el log.
    logger.info(`Lavado registrado id=${lavado.id} servicio="${servicio.nombre}" por=${actor.id}`);
    return vistaDeTurno(actor.rol, lavado);
  }

  async delDia(actor: UsuarioSesion, fecha: string | undefined): Promise<LavadosDelDia> {
    const dia = fecha ?? todayInLaRioja(this.deps.now());
    const lavados = (await this.deps.bookings.lavadosDelDia(dia)).filter((l) => l.estado !== 'cancelado');
    const veImportes = puedeVerImportes(actor.rol);
    const suma = (lista: Booking[]) => lista.reduce((acc, l) => acc + (l.monto ?? 0), 0);

    const grupos = new Map<string, { trabajador: Trabajador | null; lavados: Booking[] }>();
    for (const lavado of lavados) {
      const clave = lavado.trabajador?.id ?? '';
      const grupo = grupos.get(clave) ?? { trabajador: lavado.trabajador, lavados: [] };
      grupo.lavados.push(lavado);
      grupos.set(clave, grupo);
    }
    const porTrabajador = [...grupos.values()]
      .map((g) => ({ trabajador: g.trabajador, cantidad: g.lavados.length, cobrado: suma(g.lavados) }))
      // El desempate por lo cobrado solo para quien ve importes: si no, el orden mismo revelaría quién cobró más.
      .sort(
        (a, b) =>
          b.cantidad - a.cantidad ||
          (veImportes ? b.cobrado - a.cobrado : 0) ||
          (a.trabajador?.nombre ?? '').localeCompare(b.trabajador?.nombre ?? '', 'es'),
      )
      .map(({ trabajador, cantidad, cobrado }) => ({ trabajador, cantidad, total: veImportes ? cobrado : null }));

    return {
      fecha: dia,
      lavados: lavados.map((l) => vistaDeTurno(actor.rol, l)),
      resumen: {
        cantidad: lavados.length,
        total: veImportes ? suma(lavados) : null,
        sinMonto: lavados.filter((l) => l.monto === null).length,
        porTrabajador,
      },
    };
  }
}
