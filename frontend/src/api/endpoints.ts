import { api, descargar, query } from './client';
import type {
  AlertasStock,
  CambioReceta,
  CambioServicio,
  Consumo,
  CambioTurno,
  Comprobante,
  Estadisticas,
  FormaPago,
  Gasto,
  Insumo,
  LavadoRegistrado,
  ListaInsumos,
  MetaActual,
  MisTrabajos,
  Movimiento,
  MovimientoNuevo,
  NuevoGasto,
  NuevoInsumo,
  NuevoLavado,
  NuevoLavadoLegado,
  NuevoPresupuesto,
  NuevoServicio,
  NuevoUsuario,
  CambioPerfil,
  EstadoPush,
  Perfil,
  SuscripcionPush,
  ParaComprar,
  Permisos,
  Receta,
  ResultadoEliminar,
  PlanillaDelDia,
  Presupuesto,
  EstadoPresupuesto,
  Rol,
  Servicio,
  Turno,
  Usuario,
  UsuarioEquipo,
} from './types';

// Sesión
export const login = (email: string, password: string) =>
  api<{ usuario: Usuario }>('/api/auth/login', { method: 'POST', body: { email, password } });
export const quienSoy = () => api<{ usuario: Usuario }>('/api/auth/me');
export const cerrarSesion = () => api<undefined>('/api/auth/logout', { method: 'POST' });
export const permisos = () => api<Permisos>('/api/admin/permisos');

// Mi perfil
export const perfil = () => api<{ perfil: Perfil; fotosDisponibles: boolean }>('/api/admin/perfil');
export const editarPerfil = (cambio: CambioPerfil) =>
  api<{ perfil: Perfil }>('/api/admin/perfil', { method: 'PATCH', body: cambio });
/** La foto va como body binario, con el Content-Type del archivo (JPG, PNG o WebP; hasta 2 MB). */
export const subirFoto = (foto: Blob) => api<{ perfil: Perfil }>('/api/admin/perfil/foto', { method: 'PUT', archivo: foto });
export const quitarFoto = () => api<{ perfil: Perfil }>('/api/admin/perfil/foto', { method: 'DELETE' });
/** URL de la foto de alguien. `?v=` es la versión: cambia cuando cambia la foto (y deja que el navegador la guarde). */
export const urlFoto = (usuarioId: string, version: string) =>
  `/api/admin/usuarios/${encodeURIComponent(usuarioId)}/foto${query({ v: version })}`;

// Avisos push en este dispositivo (backend/README.md, "Avisos push")
export const estadoPush = () => api<EstadoPush>('/api/admin/push/estado');
export const suscribirPush = (s: SuscripcionPush) =>
  api<{ ok: true }>('/api/admin/push/suscripciones', { method: 'POST', body: s });
/** 204 también si el dispositivo no estaba guardado. */
export const desuscribirPush = (endpoint: string) =>
  api<undefined>('/api/admin/push/suscripciones', { method: 'DELETE', body: { endpoint } });

// Lavados
/** `NuevoLavadoLegado` solo para lo que había quedado en la cola sin conexión con un único servicioId. */
export const registrarLavado = (datos: NuevoLavado | NuevoLavadoLegado) =>
  api<LavadoRegistrado>('/api/admin/lavados', { method: 'POST', body: datos });
/** Deshacer un lavado recién registrado (quien lo anotó, dentro del plazo; o quien puede borrar turnos). 204. */
export const deshacerLavado = (id: string) =>
  api<undefined>(`/api/admin/lavados/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const planilla = (fecha: string) => api<PlanillaDelDia>(`/api/admin/lavados${query({ fecha })}`);
export const corregirTurno = (id: string, cambio: CambioTurno) =>
  api<{ booking: Turno }>(`/api/admin/bookings/${encodeURIComponent(id)}`, { method: 'PATCH', body: cambio });
export const borrarTurno = (id: string) =>
  api<undefined>(`/api/admin/bookings/${encodeURIComponent(id)}`, { method: 'DELETE' });

// Comprobantes
export const emitirComprobante = (turnoId: string, formaPago: FormaPago, notas?: string) =>
  api<{ comprobante: Comprobante }>(`/api/admin/bookings/${encodeURIComponent(turnoId)}/comprobante`, {
    method: 'POST',
    body: notas ? { formaPago, notas } : { formaPago },
  });
export const pdfComprobante = (id: string) => descargar(`/api/admin/comprobantes/${encodeURIComponent(id)}/pdf`);

// Estadísticas y metas
export const estadisticas = (desde: string, hasta: string) =>
  api<Estadisticas>(`/api/admin/estadisticas${query({ desde, hasta })}`);
export const misTrabajos = (desde: string, hasta: string) =>
  api<MisTrabajos>(`/api/admin/estadisticas/mias${query({ desde, hasta })}`);
export const metaActual = () => api<MetaActual>('/api/admin/metas/actual');
export const fijarMeta = (mes: string, meta: { ingresosObjetivo: number | null; trabajosObjetivo: number | null }) =>
  api<{ meta: { mes: string } }>(`/api/admin/metas/${encodeURIComponent(mes)}`, { method: 'PUT', body: meta });

// Servicios
export const servicios = () => api<{ servicios: Servicio[] }>('/api/admin/servicios');
export const crearServicio = (datos: NuevoServicio) =>
  api<{ servicio: Servicio }>('/api/admin/servicios', { method: 'POST', body: datos });
export const editarServicio = (id: string, cambio: CambioServicio) =>
  api<{ servicio: Servicio }>(`/api/admin/servicios/${encodeURIComponent(id)}`, { method: 'PATCH', body: cambio });

// Usuarios del equipo
export const usuarios = () => api<{ usuarios: UsuarioEquipo[]; gestionCuentas?: boolean }>('/api/admin/usuarios');
export const crearUsuario = (datos: NuevoUsuario) =>
  api<{ usuario: UsuarioEquipo }>('/api/admin/usuarios', { method: 'POST', body: datos });
export const editarUsuario = (
  id: string,
  cambio: Partial<{ rol: Rol; activo: boolean; nombre: string | null; password: string }>,
) => api<{ usuario: UsuarioEquipo }>(`/api/admin/usuarios/${encodeURIComponent(id)}`, { method: 'PATCH', body: cambio });
export const eliminarUsuario = (id: string) =>
  api<ResultadoEliminar>(`/api/admin/usuarios/${encodeURIComponent(id)}`, { method: 'DELETE' });

// Gastos
export const gastos = (desde: string, hasta: string) =>
  api<{ gastos: Gasto[]; total: number; suma: number }>(`/api/admin/gastos${query({ desde, hasta, limit: 100 })}`);
export const crearGasto = (datos: NuevoGasto) =>
  api<{ gasto: Gasto }>('/api/admin/gastos', { method: 'POST', body: datos });
export const borrarGasto = (id: string) =>
  api<undefined>(`/api/admin/gastos/${encodeURIComponent(id)}`, { method: 'DELETE' });

// Insumos
export const insumos = () => api<ListaInsumos>(`/api/admin/insumos${query({ limit: 100 })}`);
export const crearInsumo = (datos: NuevoInsumo) =>
  api<{ insumo: Insumo }>('/api/admin/insumos', { method: 'POST', body: datos });
export const moverInsumo = (id: string, mov: MovimientoNuevo) =>
  api<{ insumo: Insumo }>(`/api/admin/insumos/${encodeURIComponent(id)}/movimientos`, { method: 'POST', body: mov });
export const movimientosInsumo = (id: string) =>
  api<{ movimientos: Movimiento[]; total: number }>(`/api/admin/insumos/${encodeURIComponent(id)}/movimientos`);
/** Lo que pide la campanita (admin y superadmin): cuántos insumos están en el mínimo o debajo. */
export const alertasStock = () => api<AlertasStock>('/api/admin/insumos/alertas');
export const paraComprar = () => api<ParaComprar>('/api/admin/insumos/para-comprar');
export const consumo = (desde: string, hasta: string) => api<Consumo>(`/api/admin/consumo${query({ desde, hasta })}`);

// Recetas (contrato 06): verlas, todos los roles; cambiarlas, admin y superadmin.
export const recetas = () => api<{ recetas: Receta[] }>('/api/admin/recetas');
/** Reemplaza una variante de la receta (la general con `vehiculo: null`) y devuelve la receta entera del servicio. */
export const guardarReceta = (servicioId: string, cambio: CambioReceta) =>
  api<{ receta: Receta }>(`/api/admin/servicios/${encodeURIComponent(servicioId)}/receta`, { method: 'PUT', body: cambio });

// Presupuestos
export const presupuestos = () => api<{ presupuestos: Presupuesto[]; total: number }>(
  `/api/admin/presupuestos${query({ limit: 50 })}`,
);
export const crearPresupuesto = (datos: NuevoPresupuesto) =>
  api<{ presupuesto: Presupuesto }>('/api/admin/presupuestos', { method: 'POST', body: datos });
export const cambiarEstadoPresupuesto = (id: string, estado: EstadoPresupuesto) =>
  api<{ presupuesto: Presupuesto }>(`/api/admin/presupuestos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { estado },
  });
export const pdfPresupuesto = (id: string) => descargar(`/api/admin/presupuestos/${encodeURIComponent(id)}/pdf`);
