import type { Booking, VehiculoTipo } from './booking.js';

/**
 * Clientes (contrato: reportes/2026-11-15_03_contrato-mejoras.md, funciones 6 y 14): historial y resumen por teléfono o
 * por patente, tarjeta de sellos y clientes inactivos. Un cliente se identifica por su teléfono normalizado
 * (telefono_whatsapp) o, si no dejó teléfono, por la patente escrita en `vehiculo_modelo`.
 */

/** Largo de una patente ya normalizada (Argentina: AAA999 o AA999AA; se aceptan de 5 a 10 por las viejas y motos). */
export const PATENTE_MIN = 5;
export const PATENTE_MAX = 10;
/** Desde cuántas letras/dígitos la búsqueda general (GET /api/admin/bookings?q=) prueba también como patente. */
export const MIN_PATENTE_BUSQUEDA = 5;

/** Mayúsculas y solo letras y dígitos ASCII: "ab-123 cd" -> "AB123CD". */
export function normalizarPatente(texto: string): string {
  return texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type ClaveCliente = { tipo: 'telefono'; telefonoWhatsapp: string } | { tipo: 'patente'; patente: string };

export interface ServicioMasHecho {
  servicioId: string;
  nombre: string;
  cantidad: number;
}

/** Lo que sale de la base para el resumen de un cliente (con importes: la vista por rol los saca). */
export interface ResumenCliente {
  nombre: string;
  telefonoWhatsapp: string | null;
  /** Modelos/patentes distintos, más recientes primero (hasta 5). */
  vehiculos: string[];
  /** Turnos y lavados completados. */
  visitas: number;
  /** YYYY-MM-DD de agenda del último completado; null si ninguno. */
  ultimaVisita: string | null;
  serviciosMasHechos: ServicioMasHecho[];
  /** Suma de `monto` de los completados. */
  totalGastado: number;
}

export interface HistorialCliente {
  resumen: ResumenCliente;
  /** Todos sus turnos (cualquier estado), más nuevos primero, hasta el límite. */
  lavados: Booking[];
  total: number;
}

export const PREMIOS = ['gratis', 'descuento'] as const;
export type Premio = (typeof PREMIOS)[number];

/** Configuración de la tarjeta de sellos y de los inactivos (tabla fidelizacion, una sola fila). */
export interface Fidelizacion {
  sellosCada: number;
  premio: Premio;
  /** 1 a 99 con premio 'descuento'; null con 'gratis'. */
  premioPorcentaje: number | null;
  inactivosDias: number;
  updatedAt: string;
}

export type CambiosFidelizacion = Omit<Fidelizacion, 'updatedAt'>;

export const SELLOS_MIN = 2;
export const SELLOS_MAX = 50;
export const INACTIVOS_DIAS_MIN = 7;
export const INACTIVOS_DIAS_MAX = 365;

export interface ProgresoSellos {
  visitas: number;
  /** Sellos de la tarjeta actual: visitas mod (cada + 1). */
  sellos: number;
  cada: number;
  /** Cuántas visitas faltan para que la próxima sea el premio (0 = la próxima ya es el premio). */
  faltan: number;
  proximoEsPremio: boolean;
  premio: Premio;
  porcentaje: number | null;
}

/**
 * Cada `sellosCada` visitas completadas, la siguiente es el premio: la tarjeta tiene sellosCada + 1 casilleros (los
 * pagos y el premio). Sin tabla de canjes: se calcula con la cantidad de visitas (la del premio también cuenta).
 */
export function calcularSellos(visitas: number, config: Pick<Fidelizacion, 'sellosCada' | 'premio' | 'premioPorcentaje'>): ProgresoSellos {
  const sellos = visitas % (config.sellosCada + 1);
  return {
    visitas,
    sellos,
    cada: config.sellosCada,
    faltan: Math.max(0, config.sellosCada - sellos),
    proximoEsPremio: sellos === config.sellosCada,
    premio: config.premio,
    porcentaje: config.premioPorcentaje,
  };
}

/** Un cliente que no viene hace tiempo (siempre con teléfono: si no, no hay cómo escribirle). */
export interface ClienteInactivo {
  telefonoWhatsapp: string;
  nombre: string;
  vehiculoModelo: string | null;
  vehiculoTipo: VehiculoTipo;
  visitas: number;
  ultimaVisita: string;
  diasSinVenir: number;
}

export interface ClienteRepository {
  /** Resumen y turnos de un cliente; undefined si no tiene ningún turno. Agrega en SQL. */
  historial(clave: ClaveCliente, limit: number): Promise<HistorialCliente | undefined>;
  /** Visitas completadas de un cliente (para la tarjeta de sellos). */
  visitas(clave: ClaveCliente): Promise<number>;
  /**
   * Clientes con teléfono cuya última visita completada fue el `limite` o antes (YYYY-MM-DD), el que hace más que no
   * viene primero. `hoy` para calcular los días.
   */
  inactivos(limite: string, hoy: string, limit: number, offset: number): Promise<{ clientes: ClienteInactivo[]; total: number }>;
  fidelizacion(): Promise<Fidelizacion>;
  guardarFidelizacion(cambios: CambiosFidelizacion, now: Date): Promise<Fidelizacion>;
}
