import { Camera, ClipboardList, CloudOff, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, mensajeDeError } from '../../api/client';
import * as ep from '../../api/endpoints';
import type { Trabajador } from '../../api/types';
import { Tilde } from '../../components/ElegirServicios';
import { Fotos } from '../../components/Fotos';
import { Aviso, Boton } from '../../components/ui';
import { NOMBRE_PAGO, NOMBRE_VEHICULO, pesos } from '../../lib/format';
import { useFotosDisponibles } from '../../lib/fotosDisponibles';
import { VENTANA_DESHACER_MS, type Registrado } from './registrado';

/* ------------------------------------------------------------------ Talón del lavado recién anotado */

export function Talon({
  registrado,
  veMonto,
  usuarioId,
  equipo,
  onCerrar,
}: {
  registrado: Registrado;
  veMonto: boolean;
  usuarioId: string;
  equipo: Trabajador[];
  onCerrar: () => void;
}) {
  const { envio } = registrado;
  const limite = envio.tipo === 'enviado' ? envio.deshacerLimite : 0;
  const [ahora, setAhora] = useState(() => Date.now());
  const [estado, setEstado] = useState<'listo' | 'deshaciendo' | 'deshecho'>('listo');
  const [ofrece, setOfrece] = useState(envio.tipo === 'enviado');
  const [error, setError] = useState<string | null>(null);
  // Traba sincrónica contra el doble toque en "Deshacer".
  const enCurso = useRef(false);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const ayudaId = useId();
  // Fotos de antes/después, opcionales, si están prendidas en el servidor.
  const fotosOk = useFotosDisponibles(envio.tipo === 'enviado' ? envio.id : null) === true;
  const [conFotos, setConFotos] = useState(false);

  const restanteMs = Math.max(0, limite - ahora);
  const vencido = restanteMs <= 0;
  const muestraDeshacer = ofrece && (estado === 'deshaciendo' || (estado === 'listo' && !vencido));

  useEffect(() => {
    if (!ofrece || estado !== 'listo' || vencido) return;
    const t = window.setInterval(() => {
      setAhora(Date.now());
    }, 200);
    return () => {
      window.clearInterval(t);
    };
  }, [ofrece, estado, vencido]);

  useEffect(() => {
    if (estado === 'deshecho') cerrarRef.current?.focus();
  }, [estado]);

  const deshacer = async () => {
    if (enCurso.current || envio.tipo !== 'enviado') return;
    enCurso.current = true;
    setEstado('deshaciendo');
    setError(null);
    try {
      await ep.deshacerLavado(envio.id);
      setEstado('deshecho');
    } catch (err) {
      setError(mensajeDeError(err));
      setEstado('listo');
      setAhora(Date.now());
      // Sin red se puede volver a probar mientras quede tiempo; cualquier otra respuesta es definitiva.
      if (!(err instanceof ApiError && err.code === 'NETWORK')) setOfrece(false);
    } finally {
      enCurso.current = false;
    }
  };

  const vehiculo = `${NOMBRE_VEHICULO[registrado.vehiculoTipo]}${registrado.vehiculoModelo ? ` ${registrado.vehiculoModelo}` : ''}`;
  const otro = registrado.trabajador && registrado.trabajador.id !== usuarioId ? registrado.trabajador : null;
  const quien = otro ? (equipo.find((t) => t.id === otro.id)?.nombre ?? otro.nombre) : null;

  if (estado === 'deshecho') {
    return (
      <div className="talon talon-borrado" role="status" aria-live="polite">
        <Trash2 aria-hidden size={22} className="talon-icono" />
        <div className="talon-cuerpo">
          <p className="talon-titulo">Lavado borrado</p>
          <p className="talon-detalle">
            {registrado.servicio} · {vehiculo}. Ya no cuenta en la planilla.
          </p>
        </div>
        <div className="talon-acciones">
          <Boton ref={cerrarRef} chico variante="fantasma" icono={<X aria-hidden size={18} />} onClick={onCerrar}>
            Cerrar
          </Boton>
        </div>
      </div>
    );
  }

  const enCola = envio.tipo === 'en-cola';
  const segundos = Math.ceil(restanteMs / 1000);
  return (
    <div className="talon" data-en-cola={enCola ? '' : undefined} role="status" aria-live="polite">
      {enCola ? (
        <CloudOff aria-hidden size={22} className="talon-icono" />
      ) : (
        <span className="talon-sello" aria-hidden>
          <Tilde size={20} className="talon-tilde" />
        </span>
      )}
      <div className="talon-cuerpo">
        <p className="talon-titulo">
          {enCola ? 'Guardado sin conexión' : registrado.etapa === 'espera' ? 'Auto anotado: queda En espera' : 'Lavado registrado'}
        </p>
        <p className="talon-detalle">
          {registrado.servicio} · {vehiculo}
          {registrado.formaPago ? ` · ${NOMBRE_PAGO[registrado.formaPago]}` : ''}
          {veMonto && registrado.montoCargado !== null ? ` · ${pesos(registrado.montoCargado)}` : ''}
          {veMonto && registrado.descuento > 0
            ? ` · descuento de ${pesos(registrado.descuento)}${registrado.descuentoMotivo ? ` (${registrado.descuentoMotivo})` : ''}`
            : ''}
          {quien ? ` · lo lavó ${quien}` : ''}
        </p>
        {enCola ? <p className="talon-cola">Se envía solo cuando vuelva la señal.</p> : null}
      </div>
      <div className="talon-acciones">
        {muestraDeshacer ? (
          <Boton
            chico
            variante="secundario"
            className="talon-deshacer"
            cargando={estado === 'deshaciendo'}
            icono={<Undo2 aria-hidden size={18} />}
            aria-describedby={ayudaId}
            onClick={() => void deshacer()}
          >
            {estado === 'deshaciendo' ? 'Deshaciendo…' : 'Deshacer'}
            {estado === 'listo' ? (
              <span className="talon-cuenta" aria-hidden>
                {segundos} s
              </span>
            ) : null}
          </Boton>
        ) : null}
        {fotosOk && !conFotos ? (
          <Boton
            chico
            variante="fantasma"
            icono={<Camera aria-hidden size={18} />}
            onClick={() => {
              setConFotos(true);
            }}
          >
            Fotos
          </Boton>
        ) : null}
        {enCola ? null : (
          <Link to="/planilla" className="btn btn-fantasma btn-chico" viewTransition>
            <ClipboardList aria-hidden size={18} />
            Ver planilla
          </Link>
        )}
      </div>
      {muestraDeshacer ? (
        <>
          <span id={ayudaId} className="solo-lectores">
            Si lo anotaste por error, tenés unos segundos para borrarlo.
          </span>
          <span className="talon-plazo" aria-hidden>
            <span style={{ transform: `scaleX(${String(Math.min(1, restanteMs / VENTANA_DESHACER_MS))})` }} />
          </span>
        </>
      ) : null}
      {conFotos && envio.tipo === 'enviado' ? (
        <div className="talon-fotos">
          <Fotos lavadoId={envio.id} titulo="Fotos (opcional)" />
        </div>
      ) : null}
      {error ? (
        <div className="talon-error">
          <Aviso titulo="No se pudo deshacer">{error}</Aviso>
        </div>
      ) : null}
    </div>
  );
}
