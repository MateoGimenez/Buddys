// Respuestas de las mejoras de finanzas, caja, agenda e insumos para los tests. Todo sale del contrato del backend
// (backend/test/fixtures/respuestas-api.json, vía `fx` de fixtures.ts): no hay respuestas escritas a mano, solo se
// cambia la fecha cuando el test necesita "hoy".
import type { CajaDelDia, Cierre, GastoFijo } from '../api/finanzas';
import type { Receta } from '../api/recetas';
import type { Movimiento } from '../api/recetas';
import type { Permisos, Rol, Turno, Usuario } from '../api/types';
import { fx, serviciosAdmin, trabajadores, usuarioAdmin, usuarioEmpleado, type RespuestaFalsa } from './fixtures';

function cuerpo<T>(clave: string): T {
  const r = fx[clave];
  if (!r) throw new Error(`Falta el fixture ${clave}`);
  return structuredClone(r.body) as T;
}

export function resp(clave: string): RespuestaFalsa {
  const r = fx[clave];
  if (!r) throw new Error(`Falta el fixture ${clave}`);
  return structuredClone(r);
}

/** La matriz de permisos completa de las mejoras, vista por un rol. */
export const permisosMejoras = (rol: Rol): Permisos => ({ ...cuerpo<Permisos>('permisosAdminMejoras'), tuRol: rol });

/** Carla, encargada (admin): Ana con otro rol (los fixtures del backend no traen un login de admin). */
export const usuarioEncargado: Usuario = { ...usuarioAdmin, id: '00000000-0000-4000-8000-00000000c0c0', nombre: 'Carla', rol: 'admin' };

const USUARIO: Record<Rol, Usuario> = { superadmin: usuarioAdmin, admin: usuarioEncargado, empleado: usuarioEmpleado };

/** Las rutas de la sesión de un rol, con la matriz de permisos nueva. */
export function sesionMejoras(rol: Rol) {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: USUARIO[rol] } },
    'GET /api/admin/permisos': { status: 200, body: permisosMejoras(rol) },
    'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
    'GET /api/admin/trabajadores': rol === 'empleado' ? { status: 403, body: resp('error403CajaEmpleado').body } : { status: 200, body: trabajadores() },
  };
}

/* Caja */
export const cajaAbierta = (fecha: string): CajaDelDia => ({ ...cuerpo<CajaDelDia>('cajaAbierta'), fecha });
export const cierreDe = (fecha: string): Cierre => ({ ...cuerpo<{ cierre: Cierre }>('cajaCierra').cierre, fecha });
export const cajaCerrada = (fecha: string, cambios: Partial<Cierre> = {}): CajaDelDia => {
  const c = cuerpo<CajaDelDia>('cajaCerrada');
  return { ...c, fecha, cierre: { ...(c.cierre as Cierre), fecha, ...cambios } };
};
export const cierres = (fecha: string) => {
  const c = cuerpo<{ cierres: Cierre[]; total: number }>('cajaCierres');
  return { ...c, cierres: c.cierres.map((x) => ({ ...x, fecha })) };
};

/* Gastos fijos */
export const gastosFijosLista = () => cuerpo<{ gastosFijos: GastoFijo[]; totalMensual: number }>('gastosFijosLista');
export const gastoFijoCreado = () => cuerpo<{ gastoFijo: GastoFijo }>('gastoFijoCrea');

/* Turnos con seña */
export const turnoConSena = () => cuerpo<{ turno: Turno }>('turnoConSenaCrea').turno;
export const turnoConSenaEmpleado = () => (cuerpo<{ turnos: Turno[] }>('turnoConSenaEmpleadoLista').turnos[0] as Turno);
export const turnoCompletado = () => cuerpo<{ booking: Turno }>('turnoCompletaConSena').booking;

/* Insumos */
export const recetaGet = () => cuerpo<Receta>('recetaGet');
export const recetaPut = () => cuerpo<Receta>('recetaPut');
export const movimientosAutomaticos = () => cuerpo<{ movimientos: Movimiento[]; total: number }>('movimientosAutomaticos');
export const insumosAdmin = () => cuerpo<{ insumos: unknown[] }>('insumosAdmin');
