import { ArrowRight, MessageCircle, Undo2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { mensajeDeError } from '../api/client';
import { cambiarEtapa } from '../api/etapas';
import { ETAPAS, type Etapa, type Turno } from '../api/types';
import { ACCION_ETAPA, NOMBRE_ETAPA, etapaSiguiente, tiempoDesde } from '../lib/etapa';
import { Aviso, Boton } from './ui';

/** Cada 30 s, para que "hace 12 min" se mantenga al día sin redibujar de más. */
function useAhora(activo: boolean): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!activo) return;
    const t = window.setInterval(() => {
      setAhora(Date.now());
    }, 30_000);
    return () => {
      window.clearInterval(t);
    };
  }, [activo]);
  return ahora;
}

/**
 * Dónde está el auto: En espera → Lavando → Listo → Entregado. Un toque lo pasa a la etapa que sigue y queda
 * "Deshacer" para volver al paso anterior. Con el auto listo y teléfono del cliente, "Avisar por WhatsApp".
 */
export function EtapaAuto({
  lavado,
  puedeCambiar,
  onCambio,
}: {
  lavado: Turno;
  puedeCambiar: boolean;
  onCambio: (t: Turno) => void;
}) {
  const etapa = lavado.etapa;
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** La etapa de antes del último toque, para "Deshacer". */
  const [anterior, setAnterior] = useState<Etapa | null>(null);
  const enCurso = useRef(false);
  const ahora = useAhora(etapa !== null && etapa !== 'entregado');
  const estadoId = useId();
  if (!etapa) return null;

  const siguiente = etapaSiguiente(etapa);
  const hace = tiempoDesde(lavado.etapaDesde, ahora);

  const mover = async (hacia: Etapa, deshaciendo: boolean) => {
    if (enCurso.current) return;
    enCurso.current = true;
    setOcupado(true);
    setError(null);
    try {
      const { lavado: nuevo } = await cambiarEtapa(lavado.id, hacia);
      setAnterior(deshaciendo ? null : etapa);
      onCambio(nuevo);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      enCurso.current = false;
      setOcupado(false);
    }
  };

  const iActual = ETAPAS.indexOf(etapa);
  return (
    <div className="etapa" data-etapa={etapa}>
      <ol className="etapa-pasos" aria-label="Etapas del auto">
        {ETAPAS.map((e, i) => (
          <li
            key={e}
            className="etapa-paso"
            data-hecho={i < iActual ? '' : undefined}
            data-actual={i === iActual ? '' : undefined}
            aria-current={i === iActual ? 'step' : undefined}
          >
            <span className="etapa-punto" aria-hidden />
            <span className="etapa-nombre">{NOMBRE_ETAPA[e]}</span>
          </li>
        ))}
      </ol>
      <p className="etapa-estado" id={estadoId} role="status">
        <strong>{NOMBRE_ETAPA[etapa]}</strong>
        {hace && etapa !== 'entregado' ? <span className="etapa-hace"> · {hace}</span> : null}
      </p>
      {error ? <Aviso titulo="No se cambió la etapa">{error}</Aviso> : null}
      {puedeCambiar || (etapa === 'listo' && lavado.whatsappListo) ? (
        <div className="etapa-acciones">
          {puedeCambiar && siguiente && etapa !== 'entregado' ? (
            <Boton
              variante={etapa === 'listo' ? 'secundario' : 'primario'}
              className="etapa-avanzar"
              cargando={ocupado}
              icono={<ArrowRight aria-hidden size={20} />}
              aria-describedby={estadoId}
              onClick={() => void mover(siguiente, false)}
            >
              {ACCION_ETAPA[etapa]}
            </Boton>
          ) : null}
          {etapa === 'listo' && lavado.whatsappListo ? (
            <a className="btn btn-primario etapa-whatsapp" href={lavado.whatsappListo} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden size={20} />
              Avisar por WhatsApp
            </a>
          ) : null}
          {puedeCambiar && anterior ? (
            <Boton
              chico
              variante="fantasma"
              icono={<Undo2 aria-hidden size={18} />}
              disabled={ocupado}
              onClick={() => void mover(anterior, true)}
            >
              Deshacer: volver a {NOMBRE_ETAPA[anterior]}
            </Boton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
