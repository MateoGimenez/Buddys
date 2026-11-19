import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as ep from '../api/endpoints';
import { alCambiarElStock } from '../lib/avisosStock';

/** Cada cuánto se vuelve a contar con la pestaña a la vista. */
const INTERVALO_CAMPANITA_MS = 60_000;

/** "3 insumos con stock bajo" (el texto del contrato). Sin dato todavía, un nombre que dice adónde lleva. */
function etiquetaCampanita(n: number | null): string {
  if (n === null) return 'Insumos para comprar';
  if (n === 0) return 'Ningún insumo con stock bajo';
  return `${String(n)} ${n === 1 ? 'insumo' : 'insumos'} con stock bajo`;
}

/**
 * Campanita de stock bajo, en la barra junto a la cuenta (solo para quien tiene `inventario.consumo`). Cuenta al
 * cargar, cada minuto mientras la pestaña está a la vista y al volver a ella; con la pestaña oculta no pide nada.
 * Si un pedido falla se queda con el último número (no es algo para interrumpir a nadie).
 */
export function Campanita() {
  const [cuantos, setCuantos] = useState<number | null>(null);
  // Solo vale la respuesta del último pedido: una lenta que llega tarde no pisa a una más nueva.
  const vuelta = useRef(0);

  useEffect(() => {
    let vivo = true;
    let reloj: ReturnType<typeof setInterval> | undefined;

    const contar = () => {
      if (document.visibilityState === 'hidden') return;
      const esta = ++vuelta.current;
      ep.alertasStock()
        .then((r) => {
          if (vivo && esta === vuelta.current) setCuantos(r.bajoStock);
        })
        .catch(() => {
          // Sin conexión o sin permiso: queda el último número.
        });
    };
    const arrancar = () => {
      clearInterval(reloj);
      reloj = setInterval(contar, INTERVALO_CAMPANITA_MS);
    };
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'hidden') {
        clearInterval(reloj);
        reloj = undefined;
      } else {
        contar();
        arrancar();
      }
    };

    if (document.visibilityState !== 'hidden') {
      contar();
      arrancar();
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    const dejar = alCambiarElStock(contar);
    return () => {
      vivo = false;
      clearInterval(reloj);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      dejar();
    };
  }, []);

  const hay = cuantos !== null && cuantos > 0;
  return (
    <Link
      to="/insumos?ver=comprar"
      className="campanita"
      aria-label={etiquetaCampanita(cuantos)}
      data-alerta={hay ? '' : undefined}
      viewTransition
    >
      <Bell aria-hidden size={22} strokeWidth={hay ? 2.4 : 2} />
      {hay ? (
        <span className="campanita-numero" aria-hidden>
          {cuantos > 99 ? '99+' : String(cuantos)}
        </span>
      ) : null}
    </Link>
  );
}
