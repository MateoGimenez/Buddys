import type { Rol, UsuarioEquipo } from '../api/types';
import { paraBuscar } from './format';

export type FiltroRol = 'todos' | Rol;
export type FiltroEstado = 'vigentes' | 'activos' | 'inactivos' | 'baja' | 'todos';

export const OPCIONES_ROL: { valor: FiltroRol; texto: string }[] = [
  { valor: 'todos', texto: 'Todos' },
  { valor: 'empleado', texto: 'Empleados' },
  { valor: 'admin', texto: 'Admins' },
  { valor: 'superadmin', texto: 'Superadmins' },
];

export const OPCIONES_ESTADO: { valor: FiltroEstado; texto: string }[] = [
  { valor: 'vigentes', texto: 'Activos e inactivos' },
  { valor: 'activos', texto: 'Activos' },
  { valor: 'inactivos', texto: 'Inactivos' },
  { valor: 'baja', texto: 'Dados de baja' },
  { valor: 'todos', texto: 'Todos' },
];

function cumpleEstado(u: UsuarioEquipo, filtro: FiltroEstado): boolean {
  const deBaja = u.eliminadoAt !== null;
  switch (filtro) {
    case 'vigentes':
      return !deBaja;
    case 'activos':
      return !deBaja && u.activo;
    case 'inactivos':
      return !deBaja && !u.activo;
    case 'baja':
      return deBaja;
    case 'todos':
      return true;
  }
}

/** Filtra el equipo en la UI (es chico): texto en nombre o email, sin mayúsculas ni acentos; rol y estado. */
export function filtrarEquipo(usuarios: UsuarioEquipo[], texto: string, rol: FiltroRol, estado: FiltroEstado): UsuarioEquipo[] {
  const buscado = paraBuscar(texto);
  return usuarios.filter(
    (u) =>
      (rol === 'todos' || u.rol === rol) &&
      cumpleEstado(u, estado) &&
      (!buscado || paraBuscar(`${u.nombre ?? ''} ${u.email ?? ''}`).includes(buscado)),
  );
}
