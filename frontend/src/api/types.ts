// Tipos de la API de Buddys. Fuente: backend/README.md y backend/test/fixtures/respuestas-api.json.

export type Rol = 'superadmin' | 'admin' | 'empleado';
export type VehiculoTipo = 'auto' | 'suv' | 'pickup' | 'moto';
export type Franja = 'manana' | 'tarde';
export type EstadoTurno = 'pendiente' | 'confirmado' | 'completado' | 'cancelado';
/** Dónde está el auto de un lavado de mostrador: llega (espera), se lava, queda listo y se entrega. */
export type Etapa = 'espera' | 'lavando' | 'listo' | 'entregado';
/** En el orden del lavadero. */
export const ETAPAS: readonly Etapa[] = ['espera', 'lavando', 'listo', 'entregado'];

/** Orden canónico: el de los selectores, las tablas de precios y los textos. */
export const VEHICULOS: readonly VehiculoTipo[] = ['auto', 'suv', 'pickup', 'moto'];

export interface Usuario {
  id: string;
  email: string | null;
  nombre: string | null;
  rol: Rol;
  /** Foto de perfil: URL firmada que vence en avatarVenceEl (~1 h). null sin foto o con Storage apagado. */
  avatarUrl?: string | null;
  avatarVenceEl?: string | null;
}

export interface Persona {
  id: string;
  nombre: string;
  /** Si el backend la manda; si no, se cruza por id con /trabajadores (lib/avatares.ts). */
  avatarUrl?: string | null;
}

/** El objeto Turno de /api/admin/bookings (y de los lavados). `monto` es siempre null para el empleado. */
export interface Turno {
  id: string;
  nombre: string;
  telefono: string | null;
  telefonoWhatsapp: string | null;
  email: string | null;
  vehiculoTipo: VehiculoTipo;
  vehiculoModelo: string | null;
  /** 'panel' = turno que cargó un encargado desde el panel. */
  origen: 'web' | 'mostrador' | 'panel';
  /** El servicio principal (el primero de `servicios`). */
  servicioId: string;
  /** Todos los servicios del lavado, en orden. precioLista null para el empleado o si el servicio era "Consultá". */
  servicios: ServicioDelTurno[];
  fechaPreferida: string;
  franja: Franja;
  fechaConfirmada: string | null;
  franjaConfirmada: Franja | null;
  comentario: string | null;
  estado: EstadoTurno;
  notasInternas: string | null;
  /** Cómo se pagó (todos los roles la ven). null = sin indicar. */
  formaPago: FormaPago | null;
  turnosDelCliente: number | null;
  monto: number | null;
  trabajador: Persona | null;
  /** Solo lavados de mostrador; null en turnos de la web o del panel. */
  etapa: Etapa | null;
  /** Desde cuándo está en esa etapa (ISO UTC). null si etapa es null. */
  etapaDesde: string | null;
  /** Pesos descontados (0 = sin descuento). null para el empleado. */
  descuento: number | null;
  /** null sin descuento o para el empleado. */
  descuentoMotivo: string | null;
  /** Seña del turno; monto null para el empleado. */
  sena: { monto: number | null; formaPago: FormaPago | null; fecha: string } | null;
  /** monto - seña. null sin monto o para el empleado. */
  saldo: number | null;
  /** Link de wa.me con el "ya está listo" (lo ven todos los roles). null sin teléfono. */
  whatsappListo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServicioDelTurno {
  id: string;
  nombre: string;
  precioLista: number | null;
}

export interface ResumenTrabajador {
  trabajador: Persona | null;
  cantidad: number;
  total: number | null;
}

/** Cierre de caja: lavados y total por forma de pago. formaPago null = "Sin indicar"; total null para el empleado. */
export interface ResumenFormaPago {
  formaPago: FormaPago | null;
  cantidad: number;
  total: number | null;
}

export interface PlanillaDelDia {
  fecha: string;
  lavados: Turno[];
  resumen: {
    cantidad: number;
    total: number | null;
    sinMonto: number;
    porTrabajador: ResumenTrabajador[];
    porFormaPago: ResumenFormaPago[];
  };
}

/** Cuántos servicios puede llevar un lavado (el backend rechaza más). */
export const MAX_SERVICIOS = 10;

export interface NuevoLavado {
  /** De 1 a 10, sin repetidos; el primero es el principal. */
  servicioIds: string[];
  vehiculoTipo: VehiculoTipo;
  monto?: number | null;
  trabajadorId?: string;
  fecha?: string;
  franja?: Franja;
  nombre?: string;
  telefono?: string;
  vehiculoModelo?: string;
  notasInternas?: string;
  formaPago?: FormaPago | null;
  /** Por defecto 'entregado' ("ya terminado"); 'espera' = recién llega. */
  etapa?: Etapa;
  /** Solo quien ve importes, y solo si es > 0 (con su motivo). */
  descuento?: number;
  descuentoMotivo?: string;
  /**
   * uuid que genera el panel por cada envío (el mismo en los reintentos desde la cola sin conexión). Si el backend ya
   * tiene un lavado con ese idLocal del mismo usuario responde 200 con ese lavado (no crea otro); de otra persona, 409.
   */
  idLocal?: string;
}

/**
 * Un lavado como lo guardaba la cola sin conexión antes de los servicios múltiples: un solo `servicioId`. El backend lo
 * sigue aceptando (nunca junto con `servicioIds`: eso es 400).
 */
export type NuevoLavadoLegado = Omit<NuevoLavado, 'servicioIds'> & { servicioId: string };

/** Respuesta de POST /api/admin/lavados: el lavado y hasta cuándo quien lo registró puede deshacerlo (ISO). */
export interface LavadoRegistrado {
  lavado: Turno;
  deshacerHasta: string;
}

export interface CambioTurno {
  estado?: EstadoTurno;
  notasInternas?: string | null;
  monto?: number | null;
  trabajadorId?: string | null;
  formaPago?: FormaPago | null;
  /** Solo quien tiene cobro.corregir. */
  servicioIds?: string[];
  /** 0 = sin descuento (y sin motivo). Con descuento > 0 el motivo es obligatorio. */
  descuento?: number;
  descuentoMotivo?: string | null;
}

export interface Trabajador {
  id: string;
  nombre: string;
  rol: Rol;
  avatarUrl?: string | null;
}

export interface Servicio {
  id: string;
  nombre: string;
  resumen: string;
  descripcion: string;
  incluye: string[];
  glosario: { termino: string; significado: string }[];
  /** "Lavado", "Interior", "Pulido", "Protección", "Pre venta", "Motos"… null = sin categoría. */
  categoria: string | null;
  /** duracion y precioDesde son los de auto. null = "Consultá" (nunca se usa el de auto para otro vehículo). */
  duracion: string | null;
  duracionSuv: string | null;
  duracionPickup: string | null;
  duracionMoto: string | null;
  precioDesde: number | null;
  precioDesdeSuv: number | null;
  precioDesdePickup: number | null;
  precioDesdeMoto: number | null;
  vehiculos: VehiculoTipo[];
  destacado: boolean;
  activo: boolean;
  orden: number;
  updatedAt: string;
}

export type PrecioServicio = 'precioDesde' | 'precioDesdeSuv' | 'precioDesdePickup' | 'precioDesdeMoto';

export type NuevoServicio = Pick<Servicio, 'id' | 'nombre' | 'resumen' | 'descripcion'> &
  Partial<Pick<Servicio, PrecioServicio | 'categoria' | 'vehiculos' | 'activo'>>;

export type CambioServicio = Partial<Pick<Servicio, 'nombre' | 'resumen' | PrecioServicio | 'categoria' | 'vehiculos' | 'activo'>>;

export type NivelPermiso = 'si' | 'no' | 'parcial';

export interface Capacidad {
  id: string;
  grupo: string;
  texto: string;
  roles: Record<Rol, NivelPermiso>;
  matiz?: Partial<Record<Rol, string>>;
}

export interface Permisos {
  roles: { id: Rol; nombre: string; descripcion: string }[];
  capacidades: Capacidad[];
  tuRol: Rol;
}

export interface Cifras {
  completados: number;
  ingresos: number;
  gastos: number;
  ganancia: number;
}

export interface Estadisticas {
  rango: { desde: string; hasta: string };
  granularidad: 'dia' | 'mes';
  resumen: Record<'hoy' | 'mes' | 'anio', { actual: Cifras; anterior: Cifras }>;
  periodo: {
    turnos: number;
    pedidos: number;
    pendientes: number;
    confirmados: number;
    completados: number;
    cancelados: number;
    ingresos: number;
    gastos: number;
    gananciaNeta: number;
    margen: number | null;
    ticketPromedio: number | null;
    completadosSinMonto: number;
    tasaCancelacion: number | null;
  };
  serie: { clave: string; completados: number; ingresos: number; gastos: number }[];
  porServicio: { servicioId: string; nombre: string; pedidos: number; completados: number; ingresos: number }[];
  porTrabajador: { id: string | null; nombre: string; completados: number; ingresos: number; avatarUrl?: string | null }[];
  porDiaSemana: { dia: number; manana: number; tarde: number }[];
  completadosSinTrabajador: number;
  gastosPorCategoria: { categoria: string; monto: number }[];
}

export interface MisTrabajos {
  rango: { desde: string; hasta: string };
  completados: number;
  porServicio: { servicioId: string; nombre: string; completados: number }[];
  serie: { clave: string; completados: number }[];
}

export type EstadoMeta = 'sin-meta' | 'cumplida' | 'adelantado' | 'en-ritmo' | 'atrasado';

export interface MetaActual {
  mes: string;
  meta: { ingresosObjetivo: number | null; trabajosObjetivo: number | null } | null;
  progreso: {
    ingresos: number;
    trabajos: number;
    porcentajeIngresos: number | null;
    porcentajeTrabajos: number | null;
    diasDeAtencionTranscurridos: number;
    diasDeAtencionRestantes: number;
    diasDeAtencionTotales: number;
    proyeccionIngresos: number | null;
    necesarioPorDia: number | null;
    estado: EstadoMeta;
  };
}

export interface UsuarioEquipo {
  id: string;
  email: string | null;
  nombre: string | null;
  rol: Rol;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
  avatarUrl?: string | null;
}

export interface NuevoUsuario {
  email: string;
  password: string;
  nombre?: string;
  rol: Rol;
  activo: boolean;
}

export const CATEGORIAS_GASTO = [
  'insumos',
  'herramientas',
  'alquiler',
  'servicios',
  'sueldos',
  'publicidad',
  'mantenimiento',
  'impuestos',
  'otros',
] as const;
export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number];

export interface Gasto {
  id: string;
  fecha: string;
  categoria: CategoriaGasto;
  descripcion: string;
  monto: number;
  proveedor: string | null;
  origen: 'manual' | 'inventario';
  creadoPor: Persona | null;
  createdAt: string;
  updatedAt: string;
}

export interface NuevoGasto {
  fecha: string;
  categoria: CategoriaGasto;
  descripcion: string;
  monto: number;
  proveedor?: string | null;
}

export const UNIDADES = ['unidad', 'litro', 'ml', 'kg', 'g', 'par', 'caja'] as const;
export type Unidad = (typeof UNIDADES)[number];

export interface Insumo {
  id: string;
  nombre: string;
  categoria: string | null;
  unidad: Unidad;
  stock: number;
  stockMinimo: number;
  costoUnitario: number | null;
  activo: boolean;
  bajoStock: boolean;
  valorEnStock: number | null;
  updatedAt: string;
}

export interface ListaInsumos {
  insumos: Insumo[];
  total: number;
  bajoStock: number;
  valorTotal: number | null;
}

export interface NuevoInsumo {
  nombre: string;
  categoria?: string;
  unidad: Unidad;
  stockInicial?: number;
  stockMinimo?: number;
  costoUnitario?: number;
}

export type MovimientoNuevo =
  | { tipo: 'uso'; cantidad: number; nota?: string }
  | { tipo: 'compra'; cantidad: number; costoTotal?: number; proveedor?: string; nota?: string }
  | { tipo: 'ajuste'; stockReal: number; nota?: string };

export const ESTADOS_PRESUPUESTO = ['borrador', 'enviado', 'aceptado', 'rechazado'] as const;
export type EstadoPresupuesto = (typeof ESTADOS_PRESUPUESTO)[number];

export interface ItemPresupuesto {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
}

export interface Presupuesto {
  id: string;
  numero: number;
  codigo: string;
  clienteNombre: string;
  clienteTelefono: string | null;
  vehiculo: string | null;
  items: ItemPresupuesto[];
  descuento: number;
  subtotal: number;
  total: number;
  validezDias: number;
  venceEl: string;
  estado: EstadoPresupuesto;
  vencido: boolean;
  notas: string | null;
  turnoId: string | null;
  creadoPor: Persona | null;
  createdAt: string;
  updatedAt: string;
}

export interface NuevoPresupuesto {
  clienteNombre: string;
  clienteTelefono?: string;
  vehiculo?: string;
  items: ItemPresupuesto[];
  descuento?: number;
  validezDias?: number;
  notas?: string;
}

export const FORMAS_PAGO = ['efectivo', 'transferencia', 'debito', 'credito', 'otro'] as const;
export type FormaPago = (typeof FORMAS_PAGO)[number];

export interface Comprobante {
  id: string;
  numero: number;
  codigo: string;
  fechaEmision: string;
  formaPago: FormaPago;
  monto: number;
  clienteNombre: string;
  servicioNombre: string;
  vehiculo: string;
  notas: string | null;
}
