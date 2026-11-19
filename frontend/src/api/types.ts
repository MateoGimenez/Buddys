// Tipos de la API de Buddys. Fuente: backend/README.md y backend/test/fixtures/respuestas-api.json.

export type Rol = 'superadmin' | 'admin' | 'empleado';
export type VehiculoTipo = 'auto' | 'suv' | 'pickup' | 'moto';
export type Franja = 'manana' | 'tarde';
export type EstadoTurno = 'pendiente' | 'confirmado' | 'completado' | 'cancelado';

/** Orden canónico: el de los selectores, las tablas de precios y los textos. */
export const VEHICULOS: readonly VehiculoTipo[] = ['auto', 'suv', 'pickup', 'moto'];

export interface Usuario {
  id: string;
  email: string | null;
  nombre: string | null;
  rol: Rol;
  /** Versión de la foto de perfil (ISO 8601) o null si no tiene. Va en la URL de la foto como `?v=`. */
  fotoVersion: string | null;
}

/** GET/PATCH /api/admin/perfil y PUT/DELETE /api/admin/perfil/foto: el perfil propio (misma forma que el de la sesión). */
export type Perfil = Usuario;

/** Lo que se puede cambiar del perfil propio. La contraseña va siempre con la actual. */
export type CambioPerfil =
  | { nombre: string | null }
  | { passwordActual: string; passwordNueva: string };

export interface Persona {
  id: string;
  nombre: string;
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
  origen: 'web' | 'mostrador';
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
  /** Quién hizo el trabajo. Sigue llegando, pero el panel ya no lo muestra (contrato 05: solo "Registrado por"). */
  trabajador: Persona | null;
  /** Quién lo registró en el panel. null en los turnos de la web (o si no hay dato). Lo reciben todos los roles. */
  registradoPor: Persona | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServicioDelTurno {
  id: string;
  nombre: string;
  precioLista: number | null;
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
}

export interface Trabajador {
  id: string;
  nombre: string;
  rol: Rol;
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
  porDiaSemana: { dia: number; manana: number; tarde: number }[];
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

/**
 * Un usuario de GET /api/admin/usuarios. `email` llega en null para quien no podés ver (el admin no ve el de admins ni
 * superadmins) y para los dados de baja. `gestionable`: si quien pide puede editarlo y eliminarlo.
 */
export interface UsuarioEquipo {
  id: string;
  email: string | null;
  nombre: string | null;
  rol: Rol;
  activo: boolean;
  /** ISO 8601 si está dado de baja; si no, null. */
  eliminadoAt: string | null;
  /** Aparece en algún lavado, turno, gasto, movimiento, presupuesto o comprobante: eliminarlo lo da de baja. */
  tieneHistorial: boolean;
  gestionable: boolean;
  /** Como en la sesión: versión de la foto o null. */
  fotoVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

/** DELETE /api/admin/usuarios/:id: sin historial se borra; con historial se da de baja. */
export type ResultadoEliminar = { resultado: 'eliminado' } | { resultado: 'baja'; usuario: UsuarioEquipo };

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

/**
 * Tipos de movimiento de stock. `devolucion` (contrato 06) lo crea solo el backend al deshacer o corregir un lavado:
 * devuelve lo que la receta había descontado. No se puede mandar a mano (POST con `devolucion` es 400).
 */
export type TipoMovimiento = 'uso' | 'compra' | 'ajuste' | 'devolucion';

/** Un renglón de GET /api/admin/insumos/:id/movimientos. `cantidad` con signo; `costoTotal` null para el empleado. */
export interface Movimiento {
  id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  costoTotal: number | null;
  proveedor: string | null;
  nota: string | null;
  persona: Persona | null;
  /** El lavado que lo generó (los `uso` y `devolucion` de una receta). */
  turnoId: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ Recetas y stock (contrato 06) */

/** Un insumo de una receta, con su nombre y su unidad (sin costos: lo ven todos los roles). */
export interface RenglonReceta {
  insumoId: string;
  nombre: string;
  unidad: Unidad;
  cantidad: number;
}

/**
 * Qué insumos usa un servicio. `general` se usa cuando el vehículo del lavado no tiene renglones propios.
 * `porVehiculo` solo trae las claves que tienen renglones.
 */
export interface Receta {
  servicioId: string;
  general: RenglonReceta[];
  porVehiculo: Partial<Record<VehiculoTipo, RenglonReceta[]>>;
}

/** Cuántos renglones puede tener una variante de receta (el backend rechaza más). */
export const MAX_RENGLONES_RECETA = 30;
/** Tope de la cantidad de un renglón (numeric(12,2), CHECK > 0 y <= 99999). */
export const MAX_CANTIDAD_RECETA = 99999;

/** PUT /api/admin/servicios/:id/receta: reemplaza una variante. `items: []` la borra. */
export interface CambioReceta {
  vehiculo: VehiculoTipo | null;
  items: { insumoId: string; cantidad: number }[];
}

/** GET /api/admin/insumos/alertas: lo liviano que pide la campanita. Ordenados por stock / mínimo, ascendente. */
export interface AlertasStock {
  bajoStock: number;
  insumos: { id: string; nombre: string; unidad: Unidad; stock: number; stockMinimo: number }[];
}

export interface ItemParaComprar {
  insumoId: string;
  nombre: string;
  categoria: string | null;
  unidad: Unidad;
  stock: number;
  stockMinimo: number;
  /** max(2 × mínimo − stock, 0): entero para unidad, par y caja; 2 decimales para el resto. */
  sugerido: number;
  /** round(sugerido × costo unitario), o null si el insumo no tiene costo cargado. */
  costoEstimado: number | null;
}

/** GET /api/admin/insumos/para-comprar (admin y superadmin), ordenado por categoría y nombre. */
export interface ParaComprar {
  items: ItemParaComprar[];
  /** Suma de los costoEstimado que no son null: 0 si ninguno tiene costo cargado (nunca null). */
  costoTotalEstimado: number;
}

export type AgrupadoConsumo = 'dia' | 'semana' | 'mes';

/** GET /api/admin/consumo (admin y superadmin). Los costos son con el costo unitario de hoy. */
export interface Consumo {
  rango: { desde: string; hasta: string; agrupado: AgrupadoConsumo };
  /** Lavados de mostrador completados; la serie trae ceros en los días, semanas (clave = el lunes) o meses sin lavados. */
  lavados: { total: number; serie: { clave: string; cantidad: number }[] };
  /** `consumido` = usos menos devoluciones; `costo` null si el insumo no tiene costo cargado. */
  porInsumo: { insumoId: string; nombre: string; unidad: Unidad; consumido: number; costo: number | null }[];
  costoInsumos: number;
  /** null si no hubo lavados. */
  costoPorLavado: number | null;
}

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

// ------------------------------------------------------------------ Avisos push (backend/README.md, "Avisos push")

/** GET /api/admin/push/estado: la clave pública solo viene si el envío está disponible. */
export interface EstadoPush {
  disponible: boolean;
  clavePublica: string | null;
}

/** POST /api/admin/push/suscripciones: la forma de PushSubscription.toJSON() (sin campos de más: el backend es estricto). */
export interface SuscripcionPush {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}
