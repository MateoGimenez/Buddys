// Fotos de perfil del equipo para mostrar al lado de cada nombre (ranking, equipo). Si la respuesta ya trae avatarUrl,
// se usa esa; si no, se cruza por id con GET /api/admin/trabajadores (solo encargados: el empleado no lo puede pedir y
// ve las iniciales de los demás). La foto propia sale siempre de la sesión. Las URL son firmadas y vencen (~1 h): la
// lista se guarda 45 minutos por sesión de la app.
import { useEffect, useState } from 'react';
import * as ep from '../api/endpoints';
import { useUsuario } from '../session/SessionContext';

const VIGENCIA_MS = 45 * 60_000;

let guardadas: { de: string; hasta: number; mapa: Map<string, string> } | null = null;
let enCurso: Promise<Map<string, string>> | null = null;

/** Para los tests y al cambiar de usuario: vuelve a preguntar. */
export function olvidarAvatares(): void {
  guardadas = null;
  enCurso = null;
}

function pedir(usuarioId: string): Promise<Map<string, string>> {
  if (guardadas?.de === usuarioId && guardadas.hasta > Date.now()) return Promise.resolve(guardadas.mapa);
  enCurso ??= ep
    .trabajadores()
    .then(({ trabajadores }) => {
      const mapa = new Map<string, string>();
      for (const t of trabajadores) if (t.avatarUrl) mapa.set(t.id, t.avatarUrl);
      guardadas = { de: usuarioId, hasta: Date.now() + VIGENCIA_MS, mapa };
      return mapa;
    })
    .finally(() => {
      enCurso = null;
    });
  return enCurso;
}

/** Devuelve una función id → URL de la foto (o null si no tiene o no se sabe). */
export function useAvatares(): (id: string | null | undefined, propia?: string | null) => string | null {
  const usuario = useUsuario();
  const consulta = usuario.rol !== 'empleado';
  const [mapa, setMapa] = useState<Map<string, string> | null>(() =>
    guardadas?.de === usuario.id && guardadas.hasta > Date.now() ? guardadas.mapa : null,
  );

  useEffect(() => {
    if (!consulta) return;
    let vigente = true;
    pedir(usuario.id)
      .then((m) => {
        if (vigente) setMapa(m);
      })
      .catch(() => {
        // Sin la lista se ven las iniciales.
      });
    return () => {
      vigente = false;
    };
  }, [consulta, usuario.id]);

  return (id, propia) => {
    if (propia) return propia;
    if (!id) return null;
    if (id === usuario.id) return usuario.avatarUrl ?? null;
    return mapa?.get(id) ?? null;
  };
}
