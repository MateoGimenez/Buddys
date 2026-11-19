import type { Booking, Estado } from './booking.js';
import type { Rol } from './perfil.js';

/**
 * Permisos por rol. Es LA regla: la UI solo esconde botones, la API decide con estas funciones.
 *
 * FUENTE ÚNICA: la lista CAPACIDADES de abajo. De ella salen las funciones `puede*` (las que usa la API para
 * decidir) y la tabla que ve el usuario (GET /api/admin/permisos). Un test verifica que las funciones coinciden con
 * la matriz para los tres roles.
 *
 * Resumen (detalle y matices en CAPACIDADES):
 *
 * | Capacidad                              | superadmin | admin | empleado                          |
 * |----------------------------------------|------------|-------|-----------------------------------|
 * | Registrar un lavado de mostrador       | sí         | sí    | parcial: a su nombre               |
 * | Deshacer un lavado recién registrado   | sí         | sí    | parcial: el suyo, hasta 5 minutos  |
 * | Ver turnos, agenda, clientes, notas    | sí         | sí    | sí                                |
 * | Cambiar el estado de un turno          | cualquiera | cualq.| solo a "completado"               |
 * | Reprogramar y borrar turnos            | sí         | sí    | no                                |
 * | Registrar el cobro y quién lo hizo     | sí         | sí    | parcial: queda como trabajador    |
 * | Corregir el cobro (forma de pago, servicios) | sí   | sí    | no                                |
 * | Catálogo (ver / editar)                | sí / sí    | sí / sí | sí / no                         |
 * | Disponibilidad (ver / editar)          | sí / sí    | sí / sí | sí / no                         |
 * | Estadísticas completas (con importes)  | sí         | sí    | no                                |
 * | Estadísticas propias (sin importes)    | sí         | sí    | sí                                |
 * | Gastos y metas mensuales               | sí         | sí    | no                                |
 * | Presupuestos, comprobantes, taller     | sí         | sí    | no                                |
 * | Inventario: ver / usar                 | sí         | sí    | sí                                |
 * | Inventario: crear, comprar, ajustar    | sí         | sí    | no                                |
 * | Recetas: ver / definir                 | sí / sí    | sí / sí | sí / no                         |
 * | Consumo, para comprar y stock bajo     | sí         | sí    | no                                |
 * | Gestionar usuarios                     | sí         | parcial: solo empleados | no              |
 * | Su propio perfil (nombre, foto, clave) | sí         | sí    | sí                                |
 * | Avisos push en su dispositivo          | sí         | sí    | sí                                |
 *
 * "Reprogramar" = cambiar la fecha/franja confirmadas de un turno (también al confirmarlo "para otra fecha", o
 * volver a la que pidió el cliente). "Editar catálogo" = crear servicios, editarlos y reordenarlos.
 * "Editar disponibilidad" = cambiar el horario semanal y crear, cambiar o quitar días especiales.
 * Notas internas (también en turnos cerrados), búsqueda e historial del cliente: todos los roles; el empleado es
 * quien está con el auto.
 */

/** "si" = puede; "no" = no puede; "parcial" = puede una parte (el matiz explica cuál). */
export type Nivel = 'si' | 'no' | 'parcial';

export interface Capacidad {
  /** Identificador estable ("turnos.estado"). */
  id: string;
  /** Para agrupar en la tabla ("Turnos"). */
  grupo: string;
  /** Qué se puede hacer, en español, empezando con un verbo en infinitivo. */
  texto: string;
  roles: Readonly<Record<Rol, Nivel>>;
  /** Solo para los roles con nivel "parcial": en qué consiste. */
  matiz?: Readonly<Partial<Record<Rol, string>>>;
}

/** La matriz de permisos: una fila por cosa que un rol puede o no hacer. El orden es el de la tabla. */
export const CAPACIDADES = [
  {
    id: 'lavados.registrar',
    grupo: 'Lavados',
    texto: 'Registrar un lavado de mostrador (servicios, vehículo, cobro y forma de pago)',
    roles: { superadmin: 'si', admin: 'si', empleado: 'parcial' },
    matiz: {
      empleado:
        'Queda registrado a su nombre; carga el monto al registrarlo, pero después no lo ve ni lo corrige (tampoco ve los precios de lista)',
    },
  },
  {
    id: 'lavados.deshacer',
    grupo: 'Lavados',
    texto: 'Deshacer (borrar) un lavado de mostrador',
    roles: { superadmin: 'si', admin: 'si', empleado: 'parcial' },
    matiz: {
      empleado: 'Solo uno que registró él, hasta 5 minutos después de registrarlo y si no tiene comprobante',
    },
  },
  {
    id: 'lavados.etapa',
    grupo: 'Lavados',
    texto: 'Mover un lavado de etapa (espera, lavando, listo, entregado) y avisarle al cliente que está listo',
    roles: { superadmin: 'si', admin: 'si', empleado: 'parcial' },
    matiz: { empleado: 'Solo sus lavados: los que lavó o registró él' },
  },
  {
    id: 'fotos.subir',
    grupo: 'Lavados',
    texto: 'Subir y ver las fotos antes/después de un lavado o turno',
    roles: { superadmin: 'si', admin: 'si', empleado: 'si' },
  },
  {
    id: 'fotos.borrar',
    grupo: 'Lavados',
    texto: 'Borrar una foto de un lavado o turno',
    roles: { superadmin: 'si', admin: 'si', empleado: 'parcial' },
    matiz: { empleado: 'Solo una que subió él, hasta 5 minutos después de subirla' },
  },
  {
    id: 'turnos.ver',
    grupo: 'Turnos',
    texto: 'Ver los turnos y la agenda',
    roles: { superadmin: 'si', admin: 'si', empleado: 'si' },
  },
  {
    id: 'turnos.crear',
    grupo: 'Turnos',
    texto: 'Crear turnos desde el panel para trabajos largos y cargarles la seña',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'turnos.estado',
    grupo: 'Turnos',
    texto: 'Cambiar el estado de un turno',
    roles: { superadmin: 'si', admin: 'si', empleado: 'parcial' },
    matiz: { empleado: 'Solo puede marcarlos como Completado' },
  },
  {
    id: 'turnos.reprogramar',
    grupo: 'Turnos',
    texto: 'Cambiar la fecha y la franja de un turno',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'turnos.borrar',
    grupo: 'Turnos',
    texto: 'Borrar turnos',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'turnos.notas',
    grupo: 'Turnos',
    texto: 'Escribir notas internas en un turno',
    roles: { superadmin: 'si', admin: 'si', empleado: 'si' },
  },
  {
    id: 'turnos.clientes',
    grupo: 'Turnos',
    texto: 'Buscar turnos y ver el historial de un cliente',
    roles: { superadmin: 'si', admin: 'si', empleado: 'si' },
  },
  {
    id: 'clientes.inactivos',
    grupo: 'Turnos',
    texto: 'Ver los clientes que no vienen hace tiempo, con su link de WhatsApp',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'fidelizacion.configurar',
    grupo: 'Turnos',
    texto: 'Configurar la tarjeta de sellos (cada cuántos lavados hay premio) y cuándo un cliente está inactivo',
    roles: { superadmin: 'si', admin: 'no', empleado: 'no' },
  },
  {
    id: 'cobro.registrar',
    grupo: 'Cobro',
    texto: 'Registrar cuánto se cobró por un trabajo y quién lo hizo',
    roles: { superadmin: 'si', admin: 'si', empleado: 'parcial' },
    matiz: { empleado: 'Al completar un turno queda como quien lo hizo, pero no carga el monto' },
  },
  {
    id: 'cobro.corregir',
    grupo: 'Cobro',
    texto: 'Corregir el monto, el descuento, la forma de pago y los servicios de un turno',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'caja.cerrar',
    grupo: 'Cobro',
    texto: 'Ver la caja del día y cerrarla con el arqueo (lo contado por forma de pago)',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'caja.reabrir',
    grupo: 'Cobro',
    texto: 'Corregir o reabrir un cierre de caja ya hecho',
    roles: { superadmin: 'si', admin: 'no', empleado: 'no' },
  },
  {
    id: 'catalogo.ver',
    grupo: 'Catálogo',
    texto: 'Ver los servicios del catálogo',
    roles: { superadmin: 'si', admin: 'si', empleado: 'si' },
  },
  {
    id: 'catalogo.editar',
    grupo: 'Catálogo',
    texto: 'Crear, editar y ordenar los servicios del catálogo',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'disponibilidad.ver',
    grupo: 'Disponibilidad',
    texto: 'Ver el horario, los días especiales y los cupos',
    roles: { superadmin: 'si', admin: 'si', empleado: 'si' },
  },
  {
    id: 'disponibilidad.editar',
    grupo: 'Disponibilidad',
    texto: 'Cambiar el horario semanal y los días especiales',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'estadisticas.completas',
    grupo: 'Estadísticas',
    texto: 'Ver las estadísticas del taller, con importes',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'estadisticas.propias',
    grupo: 'Estadísticas',
    texto: 'Ver los trabajos que uno mismo registró, sin importes',
    roles: { superadmin: 'si', admin: 'si', empleado: 'si' },
  },
  {
    id: 'finanzas.gastos',
    grupo: 'Finanzas',
    texto: 'Ver y cargar los gastos del taller',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'finanzas.gastos_fijos',
    grupo: 'Finanzas',
    texto: 'Cargar los gastos fijos de cada mes (sueldos, alquiler, servicios)',
    roles: { superadmin: 'si', admin: 'parcial', empleado: 'no' },
    matiz: { admin: 'Solo los ve: los carga y los cambia el superadmin' },
  },
  {
    id: 'finanzas.metas',
    grupo: 'Finanzas',
    texto: 'Fijar y seguir las metas mensuales',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'finanzas.exportar',
    grupo: 'Finanzas',
    texto: 'Exportar a Excel (CSV) la planilla, los gastos y las estadísticas',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'documentos.presupuestos',
    grupo: 'Documentos',
    texto: 'Armar presupuestos y descargarlos en PDF',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'documentos.comprobantes',
    grupo: 'Documentos',
    texto: 'Emitir comprobantes de pago en PDF',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'documentos.taller',
    grupo: 'Documentos',
    texto: 'Editar los datos del taller que salen en los PDF',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'inventario.ver',
    grupo: 'Inventario',
    texto: 'Ver el inventario',
    roles: { superadmin: 'si', admin: 'si', empleado: 'si' },
  },
  {
    id: 'inventario.usar',
    grupo: 'Inventario',
    texto: 'Registrar el uso de insumos',
    roles: { superadmin: 'si', admin: 'si', empleado: 'si' },
  },
  {
    id: 'inventario.gestionar',
    grupo: 'Inventario',
    texto: 'Crear insumos, cargar compras y ajustar el stock',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'inventario.recetas',
    grupo: 'Inventario',
    texto: 'Definir qué insumos usa cada servicio',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'inventario.consumo',
    grupo: 'Inventario',
    texto: 'Ver el consumo de insumos, la lista para comprar y los avisos de stock bajo',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
  {
    id: 'usuarios.gestionar',
    grupo: 'Usuarios',
    texto: 'Crear, editar, desactivar y eliminar usuarios del panel',
    roles: { superadmin: 'si', admin: 'parcial', empleado: 'no' },
    matiz: { admin: 'Solo empleados: crearlos, editarlos, desactivarlos y darlos de baja' },
  },
  {
    id: 'perfil.editar',
    grupo: 'Perfil',
    texto: 'Cambiar su propio nombre, foto y contraseña',
    roles: { superadmin: 'si', admin: 'si', empleado: 'si' },
  },
  {
    id: 'perfil.propio',
    grupo: 'Usuarios',
    texto: 'Ver y editar su propio perfil: nombre, foto de perfil y contraseña',
    roles: { superadmin: 'si', admin: 'si', empleado: 'si' },
  },
  {
    id: 'push.activar',
    grupo: 'Avisos',
    texto: 'Activar los avisos en su propio dispositivo (turnos nuevos y, para admin y superadmin, stock bajo)',
    roles: { superadmin: 'si', admin: 'si', empleado: 'si' },
  },
  {
    id: 'push.equipo',
    grupo: 'Avisos',
    texto: 'Recibir los avisos del encargado: lavado registrado sin monto y meta del mes cumplida',
    roles: { superadmin: 'si', admin: 'si', empleado: 'no' },
  },
] as const satisfies readonly Capacidad[];

export type CapacidadId = (typeof CAPACIDADES)[number]['id'];

/** Nivel de un rol en una capacidad. */
export function nivelDe(rol: Rol, id: CapacidadId): Nivel {
  const capacidad = CAPACIDADES.find((candidata) => candidata.id === id);
  if (capacidad === undefined) throw new RangeError(`Capacidad desconocida: ${id}`);
  return capacidad.roles[rol];
}

/** Registrar lavados de mostrador: todos los roles (el empleado, solo a su nombre). */
export function puedeRegistrarLavados(rol: Rol): boolean {
  return nivelDe(rol, 'lavados.registrar') !== 'no';
}

/** Anotar un lavado a nombre de otra persona del equipo (elegir el trabajador). El empleado, no. */
export function puedeAnotarLavadoDeOtro(rol: Rol): boolean {
  return nivelDe(rol, 'lavados.registrar') === 'si';
}

/** Minutos que tiene quien registró un lavado para deshacerlo él mismo. */
export const PLAZO_DESHACER_LAVADO_MINUTOS = 5;

/** Hasta cuándo (ISO 8601 UTC) quien registró un lavado lo puede deshacer: la creación + el plazo. */
export function deshacerLavadoHasta(createdAt: string): string {
  return new Date(Date.parse(createdAt) + PLAZO_DESHACER_LAVADO_MINUTOS * 60_000).toISOString();
}

/** Deshacer (borrar) cualquier lavado de mostrador, en cualquier momento: admin y superadmin. */
export function puedeDeshacerCualquierLavado(rol: Rol): boolean {
  return nivelDe(rol, 'lavados.deshacer') === 'si' || puedeBorrarTurnos(rol);
}

/**
 * ¿Puede `actorId` (con ese rol) deshacer este lavado ahora? 'si'; 'no' (no es suyo o su rol no puede); 'vencido'
 * (es suyo pero pasaron más de PLAZO_DESHACER_LAVADO_MINUTOS desde que lo registró). Que no tenga comprobante lo
 * verifica el repositorio al borrar.
 */
export function puedeDeshacerLavado(
  rol: Rol,
  actorId: string,
  lavado: { registradoPor: string | null; createdAt: string },
  now: Date,
): 'si' | 'no' | 'vencido' {
  if (puedeDeshacerCualquierLavado(rol)) return 'si';
  if (nivelDe(rol, 'lavados.deshacer') === 'no' || lavado.registradoPor !== actorId) return 'no';
  return now.getTime() <= Date.parse(deshacerLavadoHasta(lavado.createdAt)) ? 'si' : 'vencido';
}

export function puedeCambiarEstado(rol: Rol, estado: Estado): boolean {
  const nivel = nivelDe(rol, 'turnos.estado');
  return nivel === 'parcial' ? estado === 'completado' : nivel === 'si';
}

export function puedeReprogramar(rol: Rol): boolean {
  return nivelDe(rol, 'turnos.reprogramar') === 'si';
}

export function puedeBorrarTurnos(rol: Rol): boolean {
  return nivelDe(rol, 'turnos.borrar') === 'si';
}

/** Entrar a la gestión de usuarios (/api/admin/usuarios): superadmin y admin (este, solo sobre empleados). */
export function puedeGestionarUsuarios(rol: Rol): boolean {
  return nivelDe(rol, 'usuarios.gestionar') !== 'no';
}

/**
 * ¿Puede alguien con `rolActor` editar, desactivar o eliminar a un usuario con `rolObjetivo`? El superadmin, a
 * cualquiera; el admin ("parcial"), solo a empleados. Que no sea uno mismo ni esté dado de baja lo mira el servicio.
 */
export function puedeGestionarA(rolActor: Rol, rolObjetivo: Rol): boolean {
  const nivel = nivelDe(rolActor, 'usuarios.gestionar');
  return nivel === 'si' || (nivel === 'parcial' && rolObjetivo === 'empleado');
}

/** ¿Puede alguien con `rolActor` crear un usuario con `rolNuevo` o pasar a alguien a ese rol? Mismo criterio. */
export function puedeAsignarRol(rolActor: Rol, rolNuevo: Rol): boolean {
  return puedeGestionarA(rolActor, rolNuevo);
}

/**
 * Mi perfil: cambiar su propio nombre, foto y contraseña (/api/admin/perfil). Todos los roles. Ver la foto de OTRO
 * usuario es parte de la gestión de usuarios (puedeGestionarUsuarios).
 */
export function puedeEditarPerfil(rol: Rol): boolean {
  return nivelDe(rol, 'perfil.editar') === 'si';
}

export function puedeEditarCatalogo(rol: Rol): boolean {
  return nivelDe(rol, 'catalogo.editar') === 'si';
}

/**
 * "Editar disponibilidad" = cambiar el horario semanal y crear, cambiar o quitar días especiales. Verla (y ver los
 * cupos en la agenda): todos los roles.
 */
export function puedeEditarDisponibilidad(rol: Rol): boolean {
  return nivelDe(rol, 'disponibilidad.editar') === 'si';
}

/**
 * Ver las estadísticas completas (con importes y de todo el equipo) y, con ellas, los importes de cada turno
 * (`monto`). Las propias (GET /api/admin/estadisticas/mias) las puede ver cualquier rol.
 */
export function puedeVerEstadisticas(rol: Rol): boolean {
  return nivelDe(rol, 'estadisticas.completas') === 'si';
}

/**
 * Registrar el cobro de un trabajo completo: cargar el monto y elegir quién lo hizo. El empleado solo puede
 * completar un turno (queda como el trabajador, sin monto): para él esto es false.
 */
export function puedeRegistrarCobro(rol: Rol): boolean {
  return nivelDe(rol, 'cobro.registrar') === 'si';
}

/**
 * Corregir el monto y el trabajador de un turno que ya estaba completado, y cambiar la forma de pago y los servicios de
 * cualquier turno (PATCH /api/admin/bookings/:id con formaPago o servicioIds).
 */
export function puedeCorregirCobro(rol: Rol): boolean {
  return nivelDe(rol, 'cobro.corregir') === 'si';
}

/** Los importes (`monto`) los ven solo quienes ven las estadísticas completas: admin y superadmin. */
export function puedeVerImportes(rol: Rol): boolean {
  return puedeVerEstadisticas(rol);
}

/** Gastos del taller: verlos, cargarlos, corregirlos y borrarlos. El empleado nunca recibe gastos. */
export function puedeGestionarGastos(rol: Rol): boolean {
  return nivelDe(rol, 'finanzas.gastos') === 'si';
}

/** Metas mensuales: fijarlas y seguirlas. El empleado nunca recibe metas. */
export function puedeGestionarMetas(rol: Rol): boolean {
  return nivelDe(rol, 'finanzas.metas') === 'si';
}

/** Presupuestos y su PDF. */
export function puedeArmarPresupuestos(rol: Rol): boolean {
  return nivelDe(rol, 'documentos.presupuestos') === 'si';
}

/** Comprobantes de pago y su PDF. */
export function puedeEmitirComprobantes(rol: Rol): boolean {
  return nivelDe(rol, 'documentos.comprobantes') === 'si';
}

/** Ver y editar los datos del taller que salen en los PDF (GET y PUT /api/admin/taller). */
export function puedeEditarTaller(rol: Rol): boolean {
  return nivelDe(rol, 'documentos.taller') === 'si';
}

/** Ver el inventario (todos los roles; el empleado sin costos ni valores en pesos). */
export function puedeVerInventario(rol: Rol): boolean {
  return nivelDe(rol, 'inventario.ver') === 'si';
}

/** Registrar el uso (salidas) de insumos: todos los roles. */
export function puedeRegistrarUsoInsumos(rol: Rol): boolean {
  return nivelDe(rol, 'inventario.usar') === 'si';
}

/** Crear y editar insumos, cargar compras y ajustar el stock. */
export function puedeGestionarInventario(rol: Rol): boolean {
  return nivelDe(rol, 'inventario.gestionar') === 'si';
}

/**
 * Definir las recetas (PUT /api/admin/servicios/:id/receta). Verlas entra en inventario.ver: el empleado las ve, sin
 * costos (las recetas no llevan).
 */
export function puedeDefinirRecetas(rol: Rol): boolean {
  return nivelDe(rol, 'inventario.recetas') === 'si';
}

/**
 * El consumo de insumos (con costos), la lista para comprar, la campanita de stock bajo y su aviso push. Los avisos
 * push de stock bajo van solo a los dispositivos de quienes tienen esta capacidad.
 */
export function puedeVerConsumoInventario(rol: Rol): boolean {
  return nivelDe(rol, 'inventario.consumo') === 'si';
}

/** Los costos y valores en pesos del inventario los ven solo quienes gestionan el inventario (no el empleado). */
export function puedeVerCostosInventario(rol: Rol): boolean {
  return puedeGestionarInventario(rol);
}

/**
 * Mover un lavado de etapa: admin y superadmin, cualquiera; el empleado, los suyos (los que lavó o registró él).
 */
export function puedeCambiarEtapa(
  rol: Rol,
  actorId: string,
  lavado: { trabajador: { id: string } | null; registradoPor: string | null },
): boolean {
  const nivel = nivelDe(rol, 'lavados.etapa');
  if (nivel === 'si') return true;
  if (nivel === 'no') return false;
  return lavado.trabajador?.id === actorId || lavado.registradoPor === actorId;
}

/** Crear turnos desde el panel (con seña) y cargar o corregir la seña de un turno. */
export function puedeCrearTurnos(rol: Rol): boolean {
  return nivelDe(rol, 'turnos.crear') === 'si';
}

/** Ver los clientes inactivos (con su link de WhatsApp). */
export function puedeVerInactivos(rol: Rol): boolean {
  return nivelDe(rol, 'clientes.inactivos') === 'si';
}

/** Configurar la tarjeta de sellos y los días de inactividad. Verla: todos los roles. */
export function puedeConfigurarFidelizacion(rol: Rol): boolean {
  return nivelDe(rol, 'fidelizacion.configurar') === 'si';
}

/** Ver los gastos fijos (admin y superadmin): tienen importes. */
export function puedeVerGastosFijos(rol: Rol): boolean {
  return nivelDe(rol, 'finanzas.gastos_fijos') !== 'no';
}

/** Cargar, cambiar y borrar gastos fijos: solo el superadmin. */
export function puedeEditarGastosFijos(rol: Rol): boolean {
  return nivelDe(rol, 'finanzas.gastos_fijos') === 'si';
}

/** Ver la caja del día y cerrarla (un día que todavía no tiene cierre). */
export function puedeCerrarCaja(rol: Rol): boolean {
  return nivelDe(rol, 'caja.cerrar') === 'si';
}

/** Corregir o reabrir (borrar) un cierre de caja ya hecho. */
export function puedeReabrirCaja(rol: Rol): boolean {
  return nivelDe(rol, 'caja.reabrir') === 'si';
}

/** Subir y ver fotos de un lavado o turno: todos los roles (todos ven todos los turnos). */
export function puedeSubirFotos(rol: Rol): boolean {
  return nivelDe(rol, 'fotos.subir') === 'si';
}

/** Minutos que tiene quien subió una foto para borrarla él mismo. */
export const PLAZO_BORRAR_FOTO_MINUTOS = 5;

/** ¿Puede borrar esta foto ahora? Admin y superadmin, siempre; el empleado, la suya hasta 5 minutos después. */
export function puedeBorrarFoto(rol: Rol, actorId: string, foto: { creadaPor: string | null; createdAt: string }, now: Date): boolean {
  const nivel = nivelDe(rol, 'fotos.borrar');
  if (nivel === 'si') return true;
  if (nivel === 'no' || foto.creadaPor !== actorId) return false;
  return now.getTime() <= Date.parse(foto.createdAt) + PLAZO_BORRAR_FOTO_MINUTOS * 60_000;
}

/** Ver y editar el propio perfil (nombre, foto y contraseña): todos los roles, solo el suyo. */
export function puedeEditarPerfilPropio(rol: Rol): boolean {
  return nivelDe(rol, 'perfil.propio') === 'si';
}

/** Exportar a CSV la planilla, los gastos y las estadísticas (llevan importes). */
export function puedeExportar(rol: Rol): boolean {
  return nivelDe(rol, 'finanzas.exportar') === 'si';
}

/** Recibir los avisos push del encargado (lavado sin monto, meta cumplida). */
export function recibeAvisosDeEquipo(rol: Rol): boolean {
  return nivelDe(rol, 'push.equipo') === 'si';
}

/**
 * El turno tal como lo ve ese rol: el empleado nunca recibe importes: ni el monto, ni el precio de lista de cada
 * servicio, ni el descuento (ni su motivo), ni el monto de la seña, ni el saldo (siempre null, aunque el turno los
 * tenga). Se aplica a TODA respuesta del panel que devuelva turnos (listado, agenda, lavados, PATCH, historial).
 */
export function vistaDeTurno(rol: Rol, booking: Booking): Booking {
  if (puedeVerImportes(rol)) return booking;
  return {
    ...booking,
    monto: null,
    servicios: booking.servicios.map((servicio) => ({ ...servicio, precioLista: null })),
    descuento: null,
    descuentoMotivo: null,
    sena: booking.sena === null ? null : { ...booking.sena, monto: null },
    saldo: null,
  };
}
