import type { FormaDePago } from './comprobantes.js';

/** Tipos de vehículo, en orden canónico. 'suv' y 'pickup' reemplazaron a 'camioneta' (migración vehiculos_suv_pickup). */
export const VEHICULO_TIPOS = ['auto', 'suv', 'pickup', 'moto'] as const;
export const FRANJAS = ['manana', 'tarde'] as const;
export const ESTADOS = ['pendiente', 'confirmado', 'completado', 'cancelado'] as const;
/** web = pedido de turno; mostrador = lavado registrado en el panel ("Registrar lavado"), nace completado. */
export const ORIGENES = ['web', 'mostrador'] as const;

export type VehiculoTipo = (typeof VEHICULO_TIPOS)[number];
export type Franja = (typeof FRANJAS)[number];
export type Estado = (typeof ESTADOS)[number];
export type Origen = (typeof ORIGENES)[number];

/** Nombre visible de cada tipo de vehículo (avisos, comprobantes, mensajes de error). */
export const VEHICULO_NOMBRES: Readonly<Record<VehiculoTipo, string>> = {
  auto: 'Auto',
  suv: 'SUV',
  pickup: 'Pick-up',
  moto: 'Moto',
};

/** Cuántos servicios distintos puede llevar un mismo lavado (un auto). */
export const MAX_SERVICIOS_LAVADO = 10;

/**
 * Un servicio de un turno o lavado (tabla lavado_servicios), en el orden en que se eligió. `precioLista` es la foto del
 * precio de lista de ese servicio para el vehículo al momento de registrarlo: null si era "Consultá", si no se conoce
 * (turnos anteriores a la tabla) o para quien no ve importes (el empleado; ver domain/permisos.ts, vistaDeTurno).
 */
export interface ServicioDelTurno {
  id: string;
  nombre: string;
  precioLista: number | null;
}

/** Datos ya validados de una solicitud de turno (lo que se guarda). */
export interface NewBooking {
  nombre: string;
  /** Tal como lo escribió el cliente (con trim). */
  telefono: string;
  email: string | null;
  vehiculoTipo: VehiculoTipo;
  vehiculoModelo: string | null;
  /** id de un servicio del catálogo (buddys.servicios) que estaba activo al pedir el turno. */
  servicioId: string;
  /** YYYY-MM-DD */
  fechaPreferida: string;
  franja: Franja;
  comentario: string | null;
}

/** Tope del monto cobrado, en pesos (el mismo que el precio "desde" del catálogo). */
export const MONTO_MAX = 99_999_999;

/**
 * Persona que hizo o registró un trabajo: `nombre` es su nombre o, si no tiene, la parte de su email antes de la @ (el
 * email entero no sale: estos nombres los ve también el empleado).
 */
export interface Trabajador {
  id: string;
  nombre: string;
}

/** Turno tal como lo devuelve la API de administración (camelCase, fechas ISO 8601). */
export interface Booking extends Omit<NewBooking, 'telefono'> {
  id: string;
  /** Tal como se escribió. null solo en lavados de mostrador registrados sin teléfono. */
  telefono: string | null;
  /** De dónde vino: pedido de turno (web) o lavado registrado en el panel (mostrador). */
  origen: Origen;
  /**
   * Teléfono listo para https://wa.me/<n>: solo dígitos, formato internacional, sin "+".
   * null si el teléfono no se puede interpretar. Se guarda al crear el turno (columna telefono_whatsapp, la que
   * identifica al cliente); en un turno viejo todavía sin normalizar se calcula al leer: ver domain/telefono.ts.
   */
  telefonoWhatsapp: string | null;
  /**
   * Fecha (YYYY-MM-DD) que confirmó el taller, si es distinta de la pedida. null = se confirmó (o se confirmará)
   * para `fechaPreferida`. Va siempre junto con `franjaConfirmada` (las dos null o las dos con valor).
   */
  fechaConfirmada: string | null;
  franjaConfirmada: Franja | null;
  estado: Estado;
  /** Nota interna del taller (hasta 1000 caracteres). Nunca sale por la API pública ni en los avisos. */
  notasInternas: string | null;
  /**
   * Cuántos turnos tienen el mismo teléfono normalizado guardado (columna telefono_whatsapp), contando este y
   * todos los estados (1 = primer turno). null si el turno no tiene teléfono normalizado guardado.
   */
  turnosDelCliente: number | null;
  /**
   * Pesos cobrados por el trabajo (entero 0 a MONTO_MAX). Solo en turnos completados; null = sin cobro cargado.
   * Es plata: SOLO admin y superadmin lo reciben con valor (para el empleado siempre es null; ver
   * domain/permisos.ts, vistaDeTurno) y nunca sale por la API pública.
   */
  monto: number | null;
  /** Quién hizo el trabajo; solo en completados. null = sin asignar (o la persona se borró). */
  trabajador: Trabajador | null;
  /**
   * Quién lo registró en el panel (columna registrado_por), con el mismo criterio de nombre que `trabajador`; a alguien
   * dado de baja se lo sigue mostrando por su nombre. null = sin dato (turnos de la web, o una persona que se borró
   * antes de que las claves pasaran a ON DELETE RESTRICT). Es un nombre, no un importe: lo reciben todos los roles.
   */
  registradoPor: Trabajador | null;
  /**
   * Cómo pagó el cliente (efectivo, transferencia, debito, credito, otro). null = sin indicar. No es un importe: la
   * ven todos los roles. La usa el cierre de caja de la planilla de lavados.
   */
  formaPago: FormaDePago | null;
  /**
   * Los servicios del turno (1 a MAX_SERVICIOS_LAVADO), en el orden elegido. El primero es el principal, el mismo que
   * `servicioId`. Un turno web o viejo tiene uno solo.
   */
  servicios: ServicioDelTurno[];
  createdAt: string;
  updatedAt: string;
}

/** Lo único que se devuelve al público al crear un turno (sin datos personales). */
export interface PublicBooking {
  id: string;
  servicioId: string;
  fechaPreferida: string;
  franja: Franja;
  estado: 'pendiente';
  /** Ruta relativa de la página de seguimiento: /turno/<id>. */
  seguimientoUrl: string;
}

/** Ruta relativa de la página pública de seguimiento de un turno. */
export const seguimientoPath = (id: string): string => `/turno/${id}`;

/**
 * Lo que ve el cliente en /turno/<id> (GET /api/turnos/:id). SOLO esto: nunca nombre, teléfono, email, vehículo,
 * comentario ni notas internas. `fecha` y `franja` son las de agenda (la confirmada si existe, si no la pedida).
 */
export interface SeguimientoTurno {
  id: string;
  servicioNombre: string;
  fecha: string;
  franja: Franja;
  estado: Estado;
  /** updated_at en ISO 8601 UTC. */
  actualizadoEl: string;
}

/** Un turno confirmado que necesita recordatorio: solo lo que hace falta para mandarlo. */
export interface CandidatoRecordatorio {
  id: string;
  email: string | null;
  /** El teléfono normalizado guardado (columna telefono_whatsapp); null si no hay. */
  telefonoWhatsapp: string | null;
  servicioNombre: string;
  /** Fecha y franja de agenda. */
  fecha: string;
  franja: Franja;
}

export interface ListBookingsOptions {
  estado?: Estado;
  /**
   * Texto de búsqueda (ya validado: trim, 2 a 80 caracteres). Coincide, sin mayúsculas ni acentos, con nombre,
   * email o modelo; o, si tiene al menos MIN_DIGITOS_BUSQUEDA dígitos, con los dígitos del teléfono o con
   * telefonoWhatsapp. Los comodines de LIKE (porcentaje, guion bajo, barra invertida) se buscan como texto.
   */
  q?: string;
  /** Un telefonoWhatsapp exacto: todos los turnos de ese cliente. */
  cliente?: string;
  limit: number;
  offset: number;
}

/** Mínimo de dígitos en `q` para buscar también por teléfono. */
export const MIN_DIGITOS_BUSQUEDA = 4;

/** Cambios de un turno que no tocan la fecha de agenda. undefined = no se toca; notasInternas null = borrar la nota. */
export interface ActualizacionTurno {
  estado?: Estado;
  notasInternas?: string | null;
  /**
   * Cobro del trabajo (undefined = no se toca; null = borrarlo). Solo tiene efecto si el turno queda completado: si
   * queda en otro estado, el repositorio los deja en null (la base lo exige: CHECK bookings_cobro_solo_completado).
   */
  monto?: number | null;
  trabajadorId?: string | null;
  /** Forma de pago (undefined = no se toca; null = sin indicar). No depende del estado del turno. */
  formaPago?: FormaDePago | null;
  /**
   * Servicios del turno (undefined = no se tocan). Reemplaza la lista entera y el principal (el primero). Los que ya
   * estaban conservan su foto del precio de lista; los nuevos toman el precio de lista vigente para el vehículo.
   */
  servicioIds?: string[];
}

/**
 * Un lavado de mostrador ya validado (POST /api/admin/lavados). Se guarda como turno completado con su cobro y
 * `origen = 'mostrador'`: así cuenta en estadísticas, metas y "mis trabajos" sin lógica aparte.
 */
export interface NuevoLavado {
  /** Si no se indica, "Cliente de mostrador". */
  nombre: string;
  telefono: string | null;
  vehiculoTipo: VehiculoTipo;
  /** Modelo y/o patente, texto libre. */
  vehiculoModelo: string | null;
  /** Ids de servicios activos y ofrecidos para el vehículo (1 a MAX_SERVICIOS_LAVADO, sin repetidos). El primero es el principal. */
  servicioIds: string[];
  /** YYYY-MM-DD: el día del lavado. */
  fecha: string;
  franja: Franja;
  /** null = sin monto cargado (se puede completar después desde PATCH /api/admin/bookings/:id). */
  monto: number | null;
  /** Quién lavó (perfil activo). */
  trabajadorId: string;
  notasInternas: string | null;
  /** Cómo pagó el cliente; null = sin indicar. */
  formaPago: FormaDePago | null;
  /** Quién lo registró (la sesión): es quien lo puede deshacer en los primeros minutos. */
  registradoPor: string;
  /** Id que generó el panel (cola sin conexión); null si no mandó. Único: un reintento no registra otro. */
  idLocal: string | null;
}

/** Lo que hace falta para decidir si un lavado de mostrador se puede deshacer (DELETE /api/admin/lavados/:id). */
export interface RegistroDeLavado {
  /** Quién lo registró; null en los lavados anteriores a la columna o si la persona se borró. */
  registradoPor: string | null;
  /** ISO 8601 UTC. */
  createdAt: string;
}

/** Una fila del cierre de caja: lavados del día agrupados por forma de pago (null = sin indicar). */
export interface TotalFormaDePago {
  formaPago: FormaDePago | null;
  cantidad: number;
  /** Suma de los montos cargados (los sin monto suman 0). */
  total: number;
}

/** Estados en los que un turno ya no se puede reprogramar. */
export const ESTADOS_CERRADOS: readonly Estado[] = ['cancelado', 'completado'];

/** Fecha y franja confirmadas por el taller (siempre juntas). */
export interface Confirmada {
  /** YYYY-MM-DD */
  fecha: string;
  franja: Franja;
}

/** Cambio de la fecha de agenda de un turno (PATCH /api/admin/bookings/:id con fechaConfirmada + franjaConfirmada). */
export interface Reprogramacion {
  /** null = volver a lo que pidió el cliente. */
  confirmada: Confirmada | null;
  /** Si viene, se cambia el estado en la misma escritura (p. ej. "confirmar para otra fecha"). */
  estado?: Estado;
  /** Si viene, se cambia la nota interna en la misma escritura (null = borrarla). */
  notasInternas?: string | null;
  /** Si viene, se cambia la forma de pago en la misma escritura (null = sin indicar). */
  formaPago?: FormaDePago | null;
  /** Si viene, se reemplazan los servicios en la misma transacción (como en ActualizacionTurno). */
  servicioIds?: string[];
}

/** El turno está cancelado o completado: no se le puede cambiar la fecha. */
export class TurnoCerradoError extends Error {
  constructor(readonly estado: Estado) {
    super(`No se puede cambiar la fecha de un turno ${estado}.`);
    this.name = 'TurnoCerradoError';
  }
}

/**
 * Puerto de persistencia de turnos. Los métodos son async para que la implementación pueda cambiar sin tocar
 * rutas ni servicios.
 */
export interface BookingRepository {
  /** Guarda un turno nuevo en estado "pendiente", sin mirar la disponibilidad (datos de prueba, scripts). */
  create(input: NewBooking, now: Date): Promise<Booking>;
  /**
   * El alta pública: en UNA transacción, bloquea la fecha (pg_advisory_xact_lock), calcula los cupos de ese día y,
   * si hay lugar en la franja, guarda el turno. Lanza DiaCerradoError o FranjaLlenaError (domain/disponibilidad.ts)
   * sin guardar nada. Dos altas simultáneas por el último lugar no pueden entrar las dos.
   */
  reservar(input: NewBooking, now: Date): Promise<Booking>;
  /**
   * Guarda un lavado de mostrador ya completado, con su cobro. No mira ni ocupa cupos de la agenda. undefined si ya
   * existe un lavado con ese idLocal (no guarda nada: ON CONFLICT DO NOTHING; se busca con lavadoPorIdLocal).
   */
  registrarLavado(input: NuevoLavado, now: Date): Promise<Booking | undefined>;
  /** El lavado con ese id del panel (idLocal); quién lo registró va en `registradoPor`. undefined si no hay. */
  lavadoPorIdLocal(idLocal: string): Promise<Booking | undefined>;
  /** Los lavados de mostrador con fecha `fecha`, en el orden en que se registraron. */
  lavadosDelDia(fecha: string): Promise<Booking[]>;
  /**
   * Cierre de caja: los lavados de mostrador no cancelados de `fecha`, agrupados (en SQL) por forma de pago. Una
   * fila por forma usada ese día; sin orden garantizado (lo pone el servicio, que sabe quién mira).
   */
  formasDePagoDelDia(fecha: string): Promise<TotalFormaDePago[]>;
  /** Quién registró un lavado de mostrador y cuándo. undefined si no existe, no es de mostrador o el id no es UUID. */
  registroDeLavado(id: string): Promise<RegistroDeLavado | undefined>;
  /** Lo público del turno para la página de seguimiento. undefined si no existe (o el id no es un UUID). */
  seguimiento(id: string): Promise<SeguimientoTurno | undefined>;
  /** Confirmados con fecha de agenda `fecha` y sin recordatorio enviado, por orden de llegada. */
  recordatoriosPendientes(fecha: string): Promise<CandidatoRecordatorio[]>;
  /**
   * Marca el recordatorio como enviado si el turno sigue confirmado, en esa fecha de agenda y sin marca. true si
   * lo marcó.
   */
  marcarRecordatorio(id: string, fecha: string, now: Date): Promise<boolean>;
  /** Un turno por id. undefined si no existe (o el id no es un UUID). */
  find(id: string): Promise<Booking | undefined>;
  /** Más nuevas primero. `total` es la cantidad que cumple el filtro, sin paginar. */
  list(options: ListBookingsOptions): Promise<{ bookings: Booking[]; total: number }>;
  /**
   * Cambia el estado, la nota interna y/o el cobro (monto y trabajador) en una sola escritura (también en un turno
   * cancelado o completado). Si el turno queda en un estado distinto de completado, monto y trabajador quedan en
   * null. updated_at solo cambia si cambia el estado o la nota: cargar o corregir el cobro no es un cambio para el
   * cliente. undefined si el turno no existe.
   */
  actualizar(id: string, cambios: ActualizacionTurno, now: Date): Promise<Booking | undefined>;
  /** undefined si el turno no existe. */
  updateEstado(id: string, estado: Estado, now: Date): Promise<Booking | undefined>;
  /**
   * Cambia la fecha/franja confirmadas (y el estado, si viene) en una sola escritura. undefined si el turno no
   * existe; TurnoCerradoError si está cancelado o completado (se verifica en el mismo UPDATE, sin carreras).
   * Si cambia la fecha o la franja de agenda, limpia la marca del recordatorio (para que reciba el nuevo). No mira
   * los cupos: el panel manda.
   */
  reprogramar(id: string, cambios: Reprogramacion, now: Date): Promise<Booking | undefined>;
  /**
   * Turnos no cancelados cuya fecha de agenda (la confirmada si existe, si no la pedida) cae en [desde, hasta],
   * ambos inclusive. Orden: fecha de agenda, franja de agenda (mañana antes que tarde) y orden de llegada.
   */
  agenda(desde: string, hasta: string): Promise<Booking[]>;
  /** true si existía y se borró. */
  delete(id: string): Promise<boolean>;
}
