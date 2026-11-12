// Tipos de la API de Buddys. Fuente: backend/README.md y backend/test/fixtures/respuestas-api.json.

export type Rol = 'superadmin' | 'admin' | 'empleado';
export type VehiculoTipo = 'auto' | 'camioneta' | 'moto';
export type Franja = 'manana' | 'tarde';
export type EstadoTurno = 'pendiente' | 'confirmado' | 'completado' | 'cancelado';

export const VEHICULOS: readonly VehiculoTipo[] = ['auto', 'camioneta', 'moto'];

export interface Usuario {
  id: string;
  email: string | null;
  nombre: string | null;
  rol: Rol;
}

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
  servicioId: string;
  fechaPreferida: string;
  franja: Franja;
  fechaConfirmada: string | null;
  franjaConfirmada: Franja | null;
  comentario: string | null;
  estado: EstadoTurno;
  notasInternas: string | null;
  turnosDelCliente: number | null;
  monto: number | null;
  trabajador: Persona | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResumenTrabajador {
  trabajador: Persona | null;
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
  };
}

export interface NuevoLavado {
  servicioId: string;
  vehiculoTipo: VehiculoTipo;
  monto?: number | null;
  trabajadorId?: string;
  fecha?: string;
  franja?: Franja;
  nombre?: string;
  telefono?: string;
  vehiculoModelo?: string;
  notasInternas?: string;
}

export interface CambioTurno {
  estado?: EstadoTurno;
  notasInternas?: string | null;
  monto?: number | null;
  trabajadorId?: string | null;
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
  duracion: string | null;
  duracionCamioneta: string | null;
  duracionMoto: string | null;
  precioDesde: number | null;
  precioDesdeCamioneta: number | null;
  precioDesdeMoto: number | null;
  vehiculos: VehiculoTipo[];
  destacado: boolean;
  activo: boolean;
  orden: number;
  updatedAt: string;
}

export type NuevoServicio = Pick<Servicio, 'id' | 'nombre' | 'resumen' | 'descripcion'> &
  Partial<Pick<Servicio, 'precioDesde' | 'precioDesdeCamioneta' | 'precioDesdeMoto' | 'vehiculos' | 'activo'>>;

export type CambioServicio = Partial<
  Pick<
    Servicio,
    'nombre' | 'resumen' | 'precioDesde' | 'precioDesdeCamioneta' | 'precioDesdeMoto' | 'vehiculos' | 'activo'
  >
>;

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
  porTrabajador: { id: string | null; nombre: string; completados: number; ingresos: number }[];
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
