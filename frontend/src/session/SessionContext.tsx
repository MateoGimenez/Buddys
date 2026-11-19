import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { alTerminarLaSesion, ApiError } from '../api/client';
import * as ep from '../api/endpoints';
import { desactivarAvisos } from '../lib/push';
import type { Permisos, Usuario } from '../api/types';

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'afuera'; aviso?: string }
  | { tipo: 'adentro'; usuario: Usuario; permisos: Permisos | null };

interface Sesion {
  estado: Estado;
  ingresar: (email: string, password: string) => Promise<void>;
  salir: () => Promise<void>;
  /** true si el rol tiene la capacidad (sí o parcial). Sin la tabla de permisos, cae a las reglas por rol. */
  puede: (capacidad: string) => boolean;
  /** Pone al día los datos del usuario logueado (nombre o foto cambiados desde Perfil). */
  actualizarUsuario: (cambio: Partial<Usuario>) => void;
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
  // Mejoras (contrato 2026-11-15, permisosAdminMejoras).
  'caja.cerrar',
  'finanzas.gastos_fijos',
  'finanzas.exportar',
  'turnos.crear',
]);

/** La foto de perfil es una URL firmada que vence: /me se vuelve a pedir este tiempo antes. */
const ANTES_DE_VENCER_MS = 5 * 60_000;
/** Nunca antes de esto (si el reloj del celular anda mal o ya venció). */
const REFRESCO_MINIMO_MS = 30_000;

/** Espera máxima para desuscribir los avisos al cerrar sesión: salir nunca se traba por esto. */
const ESPERA_AVISOS_MS = 3000;

async function desactivarAvisosAlSalir(): Promise<void> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      desactivarAvisos(),
      new Promise<void>((listo) => {
        reloj = setTimeout(listo, ESPERA_AVISOS_MS);
      }),
    ]);
  } catch {
    // Sin service worker, sin red o sin sesión: se sale igual.
  } finally {
    clearTimeout(reloj);
  }
}

function puedePorRol(usuario: Usuario, capacidad: string): boolean {
  if (capacidad === 'usuarios.gestionar' || capacidad === 'caja.reabrir') return usuario.rol === 'superadmin';
  if (SOLO_ENCARGADOS.has(capacidad)) return usuario.rol !== 'empleado';
  return true;
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
      // Los avisos de este celular son de esta persona: se sacan antes de cerrar (el DELETE necesita la sesión). Si
      // falla o tarda, se sale igual.
      await desactivarAvisosAlSalir();
      await ep.cerrarSesion();
    } finally {
      setEstado({ tipo: 'afuera' });
    }
  }, []);

  const actualizarUsuario = useCallback((cambio: Partial<Usuario>) => {
    setEstado((prev) => (prev.tipo === 'adentro' ? { ...prev, usuario: { ...prev.usuario, ...cambio } } : prev));
  }, []);

  // La URL de la foto vence (~1 h): si el panel queda abierto, se pide /me de nuevo un rato antes.
  const venceAvatar = estado.tipo === 'adentro' ? (estado.usuario.avatarVenceEl ?? null) : null;
  useEffect(() => {
    if (!venceAvatar) return;
    const vence = Date.parse(venceAvatar);
    if (Number.isNaN(vence)) return;
    const espera = Math.max(REFRESCO_MINIMO_MS, vence - Date.now() - ANTES_DE_VENCER_MS);
    const reloj = setTimeout(() => {
      ep.quienSoy()
        .then(({ usuario }) => {
          setEstado((prev) => (prev.tipo === 'adentro' && prev.usuario.id === usuario.id ? { ...prev, usuario } : prev));
        })
        .catch(() => {
          // Sin red: la foto deja de verse y quedan las iniciales; la sesión la maneja el cliente.
        });
    }, espera);
    return () => {
      clearTimeout(reloj);
    };
  }, [venceAvatar]);

  const puede = useCallback(
    (capacidad: string) => {
      if (estado.tipo !== 'adentro') return false;
      const cap = estado.permisos?.capacidades.find((c) => c.id === capacidad);
      if (!cap) return puedePorRol(estado.usuario, capacidad);
      return cap.roles[estado.usuario.rol] !== 'no';
    },
    [estado],
  );

  const valor = useMemo(() => ({ estado, ingresar, salir, puede, actualizarUsuario }), [estado, ingresar, salir, puede, actualizarUsuario]);
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
