import { CloudOff, RefreshCw, UploadCloud, X } from 'lucide-react';
import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { descartarRechazados, useCola, useEnLinea, useEnviarCola } from '../lib/cola';
import { fechaCorta } from '../lib/format';
import { Boton } from './ui';

/**
 * Estado de la señal arriba del contenido: "Sin conexión", los lavados que esperan para salir, los que la API
 * rechazó al reenviarlos y el aviso de versión nueva. Si todo está en orden no ocupa lugar.
 */
export function Senal({ usuarioId }: { usuarioId: string }) {
  useEnviarCola(usuarioId);
  const enLinea = useEnLinea();
  const { pendientes, rechazados } = useCola(usuarioId);

  return (
    <>
      {!enLinea || pendientes.length ? (
        <div className="senal" role="status">
          {!enLinea ? (
            <span className="senal-ficha senal-sin-red">
              <CloudOff aria-hidden size={18} />
              Sin conexión
            </span>
          ) : null}
          {pendientes.length ? (
            <span className="senal-ficha senal-pendiente">
              <UploadCloud aria-hidden size={18} className="senal-latido" />
              {pendientes.length === 1 ? '1 lavado por enviar' : `${pendientes.length} lavados por enviar`}
            </span>
          ) : null}
        </div>
      ) : null}

      {rechazados.length ? (
        <div className="aviso aviso-error" role="alert">
          <div className="aviso-cuerpo">
            <p className="aviso-titulo">
              {rechazados.length === 1
                ? 'Un lavado guardado sin conexión no se pudo registrar'
                : `${rechazados.length} lavados guardados sin conexión no se pudieron registrar`}
            </p>
            <ul className="senal-rechazos">
              {rechazados.map((r) => (
                <li key={r.idLocal}>
                  <strong>
                    {r.servicio}, {fechaCorta(r.fecha)}:
                  </strong>{' '}
                  {r.mensaje}
                </li>
              ))}
            </ul>
            <p>Volvé a anotarlo{rechazados.length === 1 ? '' : 's'} desde Registrar si hace falta.</p>
          </div>
          <div className="aviso-accion">
            <Boton chico variante="fantasma" icono={<X aria-hidden size={18} />} onClick={descartarRechazados}>
              Entendido
            </Boton>
          </div>
        </div>
      ) : null}

      <VersionNueva />
    </>
  );
}

function VersionNueva() {
  const {
    needRefresh: [hayNueva],
    updateServiceWorker,
  } = useRegisterSW();
  const [actualizando, setActualizando] = useState(false);
  if (!hayNueva) return null;
  return (
    <div className="aviso aviso-info version-nueva" role="status">
      <RefreshCw aria-hidden size={20} className="aviso-icono" />
      <div className="aviso-cuerpo">
        <p className="aviso-titulo">Hay una versión nueva</p>
      </div>
      <div className="aviso-accion">
        <Boton
          chico
          variante="primario"
          cargando={actualizando}
          onClick={() => {
            setActualizando(true);
            void updateServiceWorker(true);
          }}
        >
          Actualizar
        </Boton>
      </div>
    </div>
  );
}
