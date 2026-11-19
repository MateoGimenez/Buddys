// Respuestas de clientes, fidelización, etapas, descuentos, fotos y avisos para los tests. Todo sale del contrato del
// backend (backend/test/fixtures/respuestas-api.json, vía `fx`): solo se cambian los ids de Ana y Beto por los del
// frontend y, donde el test necesita "hoy", la fecha.
import type { ClienteInactivo, ConfigFidelizacion, HistorialCliente } from '../api/clientes';
import type { EnCurso } from '../api/etapas';
import type { ListaFotos, SubidaFirmada } from '../api/fotos';
import type { Insumo, MetaActual, Permisos, Rol, Turno, Usuario } from '../api/types';
import { ANA_ID, BETO_ID, fx, serviciosAdmin, trabajadores, usuarioAdmin, usuarioEmpleado, type RespuestaFalsa } from './fixtures';

const IDS: Record<string, string> = {
  '00000000-0000-4000-8000-000000000002': ANA_ID,
  '00000000-0000-4000-8000-000000000004': BETO_ID,
};

function cambiarIds<T>(v: T): T {
  return JSON.parse(JSON.stringify(v).replace(/"(00000000-0000-4000-8000-00000000000[24])"/g, (_, id: string) => `"${IDS[id] ?? id}"`)) as T;
}

function cuerpo<T>(clave: string): T {
  const r = fx[clave];
  if (!r) throw new Error(`Falta el fixture ${clave}`);
  return cambiarIds(r.body) as T;
}

/** Una respuesta del contrato tal cual (status y body), para errores. */
export function respuesta(clave: string): RespuestaFalsa {
  const r = fx[clave];
  if (!r) throw new Error(`Falta el fixture ${clave}`);
  return cambiarIds(r);
}

export const permisosDe = (rol: Rol): Permisos => ({ ...cuerpo<Permisos>('permisosAdminMejoras'), tuRol: rol });

/** Carla, encargada (admin). */
export const usuarioEncargada: Usuario = { ...usuarioAdmin, id: '00000000-0000-4000-8000-00000000c0c0', nombre: 'Carla', rol: 'admin' };
const USUARIO: Record<Rol, Usuario> = { superadmin: usuarioAdmin, admin: usuarioEncargada, empleado: usuarioEmpleado };

/** Las rutas de la sesión de un rol con la matriz de permisos de las mejoras. */
export function sesion(rol: Rol) {
  return {
    'GET /api/auth/me': { status: 200, body: { usuario: USUARIO[rol] } },
    'GET /api/admin/permisos': { status: 200, body: permisosDe(rol) },
    'GET /api/admin/servicios': { status: 200, body: serviciosAdmin() },
    'GET /api/admin/trabajadores':
      rol === 'empleado' ? respuesta('error403InactivosEmpleado') : { status: 200, body: trabajadores() },
  };
}

/* Clientes */
export const historialAdmin = () => cuerpo<HistorialCliente>('clienteHistorialTelefonoAdmin');
export const historialEmpleado = () => cuerpo<HistorialCliente>('clienteHistorialPatenteEmpleado');
export const busquedaPatente = () => cuerpo<{ bookings: Turno[]; total: number }>('busquedaPatente');
export const fidelizacionConfig = () => cuerpo<{ config: ConfigFidelizacion }>('fidelizacionGet');
export const fidelizacionGuardada = () => cuerpo<{ config: ConfigFidelizacion }>('fidelizacionPut');
export const inactivos = () => cuerpo<{ dias: number; clientes: ClienteInactivo[]; total: number }>('clientesInactivos');

/* Etapas */
export const lavadoEnEspera = () => cuerpo<{ lavado: Turno; deshacerHasta: string }>('lavadoCreaEnEspera');
export const lavadoListo = () => cuerpo<{ lavado: Turno }>('lavadoEtapaListo').lavado;
export const enCurso = (fecha: string): EnCurso => ({ ...cuerpo<EnCurso>('lavadosEnCurso'), fecha });

/* Descuentos */
export const lavadoConDescuento = () => cuerpo<{ lavado: Turno; deshacerHasta: string }>('lavadoConDescuento');
export const patchDescuento = () => cuerpo<{ booking: Turno }>('patchDescuento');

/* Fotos */
export const fotosLista = () => cuerpo<ListaFotos>('fotosLista');
export const fotoSubida = () => cuerpo<SubidaFirmada>('fotoSubida');

/* Hoy */
export const metaActual = () => cuerpo<MetaActual>('metasActual');
export function insumosConPocoStock() {
  const lista = cuerpo<{ insumos: Insumo[]; total: number; bajoStock: number; valorTotal: number | null }>('insumosAdmin');
  const primero = lista.insumos[0];
  if (primero) primero.bajoStock = true;
  return { ...lista, bajoStock: 1 };
}
