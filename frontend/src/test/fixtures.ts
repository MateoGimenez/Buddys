// Respuestas de la API para los tests. Todo sale de respuestas REALES del backend:
//  - backend/test/fixtures/respuestas-api.json: el contrato del backend (permisos, servicios, trabajadores, errores).
//  - ./respuestas-reales.json: lo que ese contrato no trae (login, /me, refresh, logout, lavados, planilla, 401, 415,
//    403 de origen). Se generó con la app de test del backend (createTestContext sobre PGlite, "ahora" fijo el
//    2026-10-16 12:00 en La Rioja) y los ids de Ana (superadmin) y Beto (empleado) se fijaron a ANA_ID y BETO_ID.
//    Si cambia el backend, hay que regenerarlo igual (no escribir respuestas a mano).
import contrato from '../../../backend/test/fixtures/respuestas-api.json';
import reales from './respuestas-reales.json';
import type { Permisos, PlanillaDelDia, Servicio, Trabajador, Turno, Usuario } from '../api/types';

export interface RespuestaFalsa {
  status: number;
  body?: unknown;
}

export const fx = contrato as unknown as Record<string, { status: number; body: unknown }>;
export const real = reales as unknown as Record<string, RespuestaFalsa>;

function cuerpo<T>(clave: string): T {
  const r = fx[clave];
  if (!r) throw new Error(`Falta el fixture ${clave}`);
  return structuredClone(r.body) as T;
}

function respuesta(clave: string): RespuestaFalsa {
  const r = real[clave];
  if (!r) throw new Error(`Falta la respuesta real ${clave}`);
  return structuredClone(r);
}

function cuerpoReal<T>(clave: string): T {
  return respuesta(clave).body as T;
}

export const ANA_ID = '00000000-0000-4000-8000-00000000a0a0';
export const BETO_ID = '00000000-0000-4000-8000-00000000b0b0';

export const usuarioAdmin: Usuario = cuerpoReal<{ usuario: Usuario }>('loginAdmin').usuario;
export const usuarioEmpleado: Usuario = cuerpoReal<{ usuario: Usuario }>('meEmpleado').usuario;

export const permisosAdmin = (): Permisos => ({ ...cuerpo<Permisos>('permisosAdmin'), tuRol: 'superadmin' });
export const permisosEmpleado = (): Permisos => cuerpo<Permisos>('permisosEmpleado');

/** Catálogo del contrato, con pulido solo para auto (para probar el filtro por vehículo) y precios cargados. */
export function serviciosAdmin(): { servicios: Servicio[] } {
  const r = cuerpo<{ servicios: Servicio[] }>('serviciosAdmin');
  for (const s of r.servicios) {
    if (s.id === 'lavado-basico') {
      s.precioDesde = 12000;
      s.precioDesdeCamioneta = 15000;
    }
    if (s.id === 'pulido') s.vehiculos = ['auto'];
    if (s.id === 'restauracion-opticas') s.activo = false;
  }
  return r;
}

/** Ana y Beto, como los devuelve GET /api/admin/trabajadores. */
export const trabajadores = () => cuerpoReal<{ trabajadores: Trabajador[] }>('trabajadoresAdmin');

/** Un lavado real (POST /api/admin/lavados del admin) como base. */
function turnoBase(): Turno {
  return cuerpoReal<{ lavado: Turno }>('lavadoAdminMinimo').lavado;
}

export function lavado(cambios: Partial<Turno>): Turno {
  return { ...turnoBase(), ...cambios };
}

export function planillaAdmin(fecha: string): PlanillaDelDia {
  return {
    fecha,
    lavados: [
      lavado({ id: 'l1', servicioId: 'lavado-basico', monto: 12000, franja: 'manana', trabajador: { id: BETO_ID, nombre: 'Beto' }, vehiculoModelo: 'Gol AB123CD' }),
      lavado({ id: 'l2', servicioId: 'pulido', monto: 60000, franja: 'manana', trabajador: { id: ANA_ID, nombre: 'Ana' } }),
      lavado({ id: 'l3', servicioId: 'lavado-premium', monto: null, franja: 'tarde', trabajador: { id: BETO_ID, nombre: 'Beto' }, nombre: 'Juan Pérez' }),
    ],
    resumen: {
      cantidad: 3,
      total: 72000,
      sinMonto: 1,
      porTrabajador: [
        { trabajador: { id: BETO_ID, nombre: 'Beto' }, cantidad: 2, total: 12000 },
        { trabajador: { id: ANA_ID, nombre: 'Ana' }, cantidad: 1, total: 60000 },
      ],
    },
  };
}

/** Lo mismo que ve el empleado: la API manda monto y total en null (sinMonto sí viene). */
export function planillaEmpleado(fecha: string): PlanillaDelDia {
  const p = planillaAdmin(fecha);
  return {
    ...p,
    lavados: p.lavados.map((l) => ({ ...l, monto: null })),
    resumen: { ...p.resumen, total: null, porTrabajador: p.resumen.porTrabajador.map((r) => ({ ...r, total: null })) },
  };
}

export const errores = {
  sinSesion: respuesta('meSinSesion'),
  vencida: respuesta('lavadosVencida'),
  refrescoFallido: respuesta('refreshSinSesion'),
  credenciales: respuesta('loginMal'),
  validacionLavado: respuesta('lavadoValidacion'),
  lavadoFuturo: respuesta('lavadoFuturo'),
  servicioNoOfrecido: fx.error400ReservaServicioNoOfrecido as RespuestaFalsa,
  prohibidoEmpleado: respuesta('lavadoEmpleadoOtro'),
  trabajadorInvalido: fx.error400TrabajadorInexistente as RespuestaFalsa,
} satisfies Record<string, RespuestaFalsa>;
