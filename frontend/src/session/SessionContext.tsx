import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { alTerminarLaSesion, ApiError } from '../api/client';
import * as ep from '../api/endpoints';
import type { NivelPermiso, Permisos, Usuario } from '../api/types';

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'afuera'; aviso?: string }
  | { tipo: 'adentro'; usuario: Usuario; permisos: Permisos | null };

interface Sesion {
  estado: Estado;
  ingresar: (email: string, password: string) => Promise<void>;
  salir: () => Promise<void>;
  /** Cambia los datos del usuario de la sesión sin recargar (después de guardar Mi perfil: nombre y foto). */
  actualizarUsuario: (cambio: Partial<Pick<Usuario, 'nombre' | 'fotoVersion'>>) => void;
  /** true si el rol tiene la capacidad (sí o parcial). Sin la tabla de permisos, cae a las reglas por rol. */
  puede: (capacidad: string) => boolean;
  /** 'si', 'parcial' o 'no' para el rol de la sesión (para los matices de un 'parcial'). */
  nivel: (capacidad: string) => NivelPermiso;
}

const SesionContext = createContext<Sesion | null>(null);

// Respaldo si GET /api/admin/permisos falla: lo mismo que dice la matriz del backend.
const SOLO_ENCARGADOS = new Set([
  'turnos.reprogramar',
  'turnos.borrar',
  'cobro.corregir',
  'catalogo.editar',
  'disponibilidad.editar',
  'estadisticas.completas',
  'finanzas.gastos',
  'finanzas.metas',
  'documentos.presupuestos',
  'documentos.comprobantes',
  'documentos.taller',
  'inventario.gestionar',
]);

function nivelPorRol(usuario: Usuario, capacidad: string): NivelPermiso {
  // Equipo: el superadmin gestiona a todos; el admin, solo a los empleados.
  if (capacidad === 'usuarios.gestionar') return usuario.rol === 'superadmin' ? 'si' : usuario.rol === 'admin' ? 'parcial' : 'no';
  if (SOLO_ENCARGADOS.has(capacidad)) return usuario.rol !== 'empleado' ? 'si' : 'no';
  return 'si';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });

  const entrarCon = useCallback(async (usuario: Usuario) => {
    let tabla: Permisos | null = null;
    try {
      tabla = await ep.permisos();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === 'NO_ACCESS')) throw err;
    }
    setEstado({ tipo: 'adentro', usuario, permisos: tabla });
  }, []);

  useEffect(() => {
    let vivo = true;
    ep.quienSoy()
      .then(async ({ usuario }) => {
        if (vivo) await entrarCon(usuario);
      })
      .catch((err: unknown) => {
        if (!vivo) return;
        const aviso =
          err instanceof ApiError && (err.status === 401 || err.code === 'NO_ACCESS')
            ? undefined
            : err instanceof ApiError
              ? err.message
              : undefined;
        setEstado(aviso ? { tipo: 'afuera', aviso } : { tipo: 'afuera' });
      });
    return () => {
      vivo = false;
    };
  }, [entrarCon]);

  useEffect(
    () =>
      alTerminarLaSesion(() => {
        setEstado({ tipo: 'afuera', aviso: 'Tu sesión terminó. Volvé a ingresar.' });
      }),
    [],
  );

  const ingresar = useCallback(
    async (email: string, password: string) => {
      const { usuario } = await ep.login(email, password);
      await entrarCon(usuario);
    },
    [entrarCon],
  );

  const salir = useCallback(async () => {
    try {
      await ep.cerrarSesion();
    } finally {
      setEstado({ tipo: 'afuera' });
    }
  }, []);

  const actualizarUsuario = useCallback((cambio: Partial<Pick<Usuario, 'nombre' | 'fotoVersion'>>) => {
    setEstado((e) => (e.tipo === 'adentro' ? { ...e, usuario: { ...e.usuario, ...cambio } } : e));
  }, []);

  const nivel = useCallback(
    (capacidad: string): NivelPermiso => {
      if (estado.tipo !== 'adentro') return 'no';
      const cap = estado.permisos?.capacidades.find((c) => c.id === capacidad);
      if (!cap) return nivelPorRol(estado.usuario, capacidad);
      return cap.roles[estado.usuario.rol];
    },
    [estado],
  );

  const puede = useCallback((capacidad: string) => nivel(capacidad) !== 'no', [nivel]);

  const valor = useMemo(
    () => ({ estado, ingresar, salir, actualizarUsuario, puede, nivel }),
    [estado, ingresar, salir, actualizarUsuario, puede, nivel],
  );
  return <SesionContext.Provider value={valor}>{children}</SesionContext.Provider>;
}

export function useSesion(): Sesion {
  const ctx = useContext(SesionContext);
  if (!ctx) throw new Error('useSesion fuera de SessionProvider');
  return ctx;
}

/** El usuario logueado (solo dentro del panel). */
export function useUsuario(): Usuario {
  const { estado } = useSesion();
  if (estado.tipo !== 'adentro') throw new Error('useUsuario sin sesión');
  return estado.usuario;
}

/** ¿Este rol ve importes? (el empleado nunca). */
export function useVeImportes(): boolean {
  return useSesion().puede('estadisticas.completas');
}
