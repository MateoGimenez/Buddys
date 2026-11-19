import type { NivelPermiso } from '../api/types';
import { useSesion } from '../session/SessionContext';

// Respaldo si la tabla de permisos no llegó (o es de un backend anterior que no trae la capacidad): lo mismo que dice
// la matriz del backend (permisosAdminMejoras) para las capacidades de caja, gastos fijos, turnos y exportar.
const POR_ROL: Record<string, Record<'superadmin' | 'admin' | 'empleado', NivelPermiso>> = {
  'caja.cerrar': { superadmin: 'si', admin: 'si', empleado: 'no' },
  'caja.reabrir': { superadmin: 'si', admin: 'no', empleado: 'no' },
  'finanzas.gastos_fijos': { superadmin: 'si', admin: 'parcial', empleado: 'no' },
  'finanzas.exportar': { superadmin: 'si', admin: 'si', empleado: 'no' },
  'turnos.crear': { superadmin: 'si', admin: 'si', empleado: 'no' },
  'turnos.estado': { superadmin: 'si', admin: 'si', empleado: 'parcial' },
  'inventario.gestionar': { superadmin: 'si', admin: 'si', empleado: 'no' },
};

/**
 * Cuánto puede este rol con una capacidad: "si", "parcial" o "no". `puede()` de la sesión trata "parcial" como sí
 * (alcanza para mostrar una sección); esto distingue, por ejemplo, el admin que ve los gastos fijos pero no los cambia.
 */
export function useNivel(capacidad: string): NivelPermiso {
  const { estado } = useSesion();
  if (estado.tipo !== 'adentro') return 'no';
  const rol = estado.usuario.rol;
  const cap = estado.permisos?.capacidades.find((c) => c.id === capacidad);
  if (cap) return cap.roles[rol];
  return POR_ROL[capacidad]?.[rol] ?? (rol === 'empleado' ? 'no' : 'si');
}

/** true solo con nivel "si" (sin matices). */
export function usePuedeDelTodo(capacidad: string): boolean {
  return useNivel(capacidad) === 'si';
}

/** true con "si" o "parcial", pero con el respaldo de esta tabla (no el de la sesión) para las capacidades nuevas. */
export function usePuede(capacidad: string): boolean {
  return useNivel(capacidad) !== 'no';
}
