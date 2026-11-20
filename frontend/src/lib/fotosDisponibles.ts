// ¿Las fotos están prendidas en el servidor? Si no, el panel no las ofrece. Se pregunta una vez por sesión de la app
// (con el listado de un lavado cualquiera).
import { useEffect, useState } from 'react';
import { fotosDelLavado } from '../api/fotos';

let disponibles: boolean | null = null;

/** Para los tests: vuelve a preguntar. */
export function olvidarDisponibilidadFotos(): void {
  disponibles = null;
}

/** true si están prendidas; null mientras pregunta; false si están apagadas o no se pudo saber. */
export function useFotosDisponibles(lavadoParaPreguntar: string | null): boolean | null {
  const [valor, setValor] = useState<boolean | null>(null);
  useEffect(() => {
    if (disponibles !== null || !lavadoParaPreguntar) return;
    let vigente = true;
    fotosDelLavado(lavadoParaPreguntar)
      .then((r) => {
        disponibles = r.disponible;
        if (vigente) setValor(r.disponible);
      })
      .catch(() => {
        if (vigente) setValor(false);
      });
    return () => {
      vigente = false;
    };
  }, [lavadoParaPreguntar]);
  return disponibles ?? valor;
}
