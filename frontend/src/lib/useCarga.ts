import { useCallback, useEffect, useRef, useState } from 'react';
import { mensajeDeError } from '../api/client';

export type Carga<T> =
  | { estado: 'cargando'; datos: T | null }
  | { estado: 'listo'; datos: T }
  | { estado: 'error'; datos: T | null; mensaje: string };

interface Resultado<T> {
  clave: string;
  datos: T | null;
  error: string | null;
}

/**
 * Carga datos con una función que depende de `claves` (valores simples). Mantiene los datos anteriores mientras
 * recarga (sin parpadeo) y descarta respuestas viejas si las claves cambiaron.
 */
export function useCarga<T>(
  cargar: () => Promise<T>,
  claves: readonly (string | number | boolean | null)[],
): [Carga<T>, () => void, (actualizar: (prev: T) => T) => void] {
  const [vuelta, setVuelta] = useState(0);
  const [resultado, setResultado] = useState<Resultado<T> | null>(null);
  const clave = JSON.stringify([...claves, vuelta]);
  const cargarRef = useRef(cargar);
  useEffect(() => {
    cargarRef.current = cargar;
  });

  useEffect(() => {
    let vigente = true;
    cargarRef
      .current()
      .then((datos) => {
        if (vigente) setResultado({ clave, datos, error: null });
      })
      .catch((err: unknown) => {
        if (vigente) setResultado((prev) => ({ clave, datos: prev?.datos ?? null, error: mensajeDeError(err) }));
      });
    return () => {
      vigente = false;
    };
  }, [clave]);

  const recargar = useCallback(() => {
    setVuelta((v) => v + 1);
  }, []);

  const actualizar = useCallback((fn: (prev: T) => T) => {
    setResultado((prev) => (prev?.datos == null ? prev : { ...prev, datos: fn(prev.datos) }));
  }, []);

  let carga: Carga<T>;
  const datos = resultado?.datos ?? null;
  if (resultado?.clave !== clave) carga = { estado: 'cargando', datos };
  else if (resultado.error !== null) carga = { estado: 'error', datos, mensaje: resultado.error };
  else if (datos === null) carga = { estado: 'cargando', datos };
  else carga = { estado: 'listo', datos };

  return [carga, recargar, actualizar];
}
