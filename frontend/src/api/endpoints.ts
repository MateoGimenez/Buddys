import { api, descargar, query } from './client';
import type {
  CambioServicio,
  CambioTurno,
  Comprobante,
  Estadisticas,
  FormaPago,
  Gasto,
  Insumo,
  ListaInsumos,
  MetaActual,
  MisTrabajos,
  MovimientoNuevo,
  NuevoGasto,
  NuevoInsumo,
  NuevoLavado,
  NuevoPresupuesto,
  NuevoServicio,
  NuevoUsuario,
  Permisos,
  PlanillaDelDia,
  Presupuesto,
  EstadoPresupuesto,
  Rol,
  Servicio,
  Trabajador,
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

// Lavados
export const registrarLavado = (datos: NuevoLavado) =>
  api<{ lavado: Turno }>('/api/admin/lavados', { method: 'POST', body: datos });
export const planilla = (fecha: string) => api<PlanillaDelDia>(`/api/admin/lavados${query({ fecha })}`);
export const corregirTurno = (id: string, cambio: CambioTurno) =>
  api<{ booking: Turno }>(`/api/admin/bookings/${encodeURIComponent(id)}`, { method: 'PATCH', body: cambio });
export const borrarTurno = (id: string) =>
  api<undefined>(`/api/admin/bookings/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const trabajadores = () => api<{ trabajadores: Trabajador[] }>('/api/admin/trabajadores');

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
