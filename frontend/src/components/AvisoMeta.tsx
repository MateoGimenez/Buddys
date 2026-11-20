import { Check, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as ep from '../api/endpoints';
import type { MetaDeHoy } from '../api/types';
import { AVISO_META_MS, marcarAvisoMetaVisto, yaSeVioAvisoMeta } from '../lib/avisoMeta';
import { useSesion } from '../session/SessionContext';

/** Lo que tarda en irse (la animación de salida); con movimiento reducido es instantáneo igual. */
const SALIDA_MS = 200;

type Lavados = NonNullable<MetaDeHoy['lavados']>;

/**
 * La meta de lavados de hoy del equipo, como un talón chico que entra arriba al abrir la app: "12 de 20 lavados" con una
 * barra que se llena de 0 al avance. Se va sola a los 3 s; el puntero encima, el foco adentro o un toque la pausan;
 * tiene "Cerrar". Si no hay meta de hoy, o la API falla, no aparece nada.
 */
export function AvisoMeta() {
  const { puede } = useSesion();
  const habilitado = puede('metas.hoy');
  const [lavados, setLavados] = useState<Lavados | null>(null);
  const [estado, setEstado] = useState<'visible' | 'saliendo' | 'cerrado'>('visible');
  const [lleno, setLleno] = useState(false);
  const [pausado, setPausado] = useState(false);
  const restante = useRef(AVISO_META_MS);
  const desde = useRef(0);

  useEffect(() => {
    if (!habilitado || yaSeVioAvisoMeta()) return;
    let vivo = true;
    ep.metaDeHoy()
      .then((r) => {
        if (!vivo || r.lavados === null) return;
        marcarAvisoMetaVisto();
        setLavados(r.lavados);
      })
      .catch(() => {
        // Sin meta a la vista: no hay nada que avisar.
      });
    return () => {
      vivo = false;
    };
  }, [habilitado]);

  // La barra arranca vacía y se llena en el cuadro siguiente (así la transición se ve).
  useEffect(() => {
    if (!lavados) return;
    const cuadro = requestAnimationFrame(() => {
      setLleno(true);
    });
    return () => {
      cancelAnimationFrame(cuadro);
    };
  }, [lavados]);

  const cerrar = useCallback(() => {
    setEstado('saliendo');
  }, []);

  useEffect(() => {
    if (estado !== 'saliendo') return;
    const t = setTimeout(() => {
      setEstado('cerrado');
    }, SALIDA_MS);
    return () => {
      clearTimeout(t);
    };
  }, [estado]);

  // El reloj de 3 s: corre mientras no esté pausado y guarda lo que le queda al pausarse.
  useEffect(() => {
    if (!lavados || estado !== 'visible' || pausado) return;
    desde.current = Date.now();
    const t = setTimeout(cerrar, restante.current);
    return () => {
      clearTimeout(t);
      restante.current = Math.max(0, restante.current - (Date.now() - desde.current));
    };
  }, [lavados, estado, pausado, cerrar]);

  if (!lavados || estado === 'cerrado') return null;

  const { hechos, objetivo, mesCumplido } = lavados;
  const llego = mesCumplido || hechos >= objetivo;
  const fraccion = mesCumplido || objetivo === 0 ? 1 : Math.min(1, hechos / objetivo);
  const titulo = mesCumplido ? '¡Ya cumplieron la meta del mes!' : llego ? '¡Llegaron a la meta de hoy!' : 'Meta de hoy';
  const detalle = mesCumplido
    ? `Hoy van ${String(hechos)} ${hechos === 1 ? 'lavado' : 'lavados'}.`
    : `${String(hechos)} de ${String(objetivo)} lavados`;

  return (
    <div
      className="aviso-meta"
      data-estado={estado}
      data-llego={llego ? '' : undefined}
      role="status"
      aria-live="polite"
      onPointerEnter={() => {
        setPausado(true);
      }}
      onPointerLeave={() => {
        setPausado(false);
      }}
      onPointerDown={() => {
        setPausado(true);
      }}
      onFocus={() => {
        setPausado(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPausado(false);
      }}
    >
      <div className="aviso-meta-cuerpo">
        <p className="aviso-meta-titulo">{titulo}</p>
        <p className="aviso-meta-cifra">{detalle}</p>
        {mesCumplido ? null : (
          <span className="aviso-meta-pista" aria-hidden>
            <span className="aviso-meta-relleno" style={{ transform: `scaleX(${String(lleno ? fraccion : 0)})` }} />
          </span>
        )}
      </div>
      {llego ? (
        <span className="aviso-meta-sello" aria-hidden>
          <Check size={20} strokeWidth={3} />
        </span>
      ) : null}
      <button type="button" className="aviso-meta-cerrar" aria-label="Cerrar el aviso de la meta" onClick={cerrar}>
        <X aria-hidden size={18} />
      </button>
    </div>
  );
}
