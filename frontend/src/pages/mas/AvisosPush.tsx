import { Bell, BellOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { mensajeDeError } from '../../api/client';
import { estadoPush } from '../../api/push';
import { Aviso, Boton } from '../../components/ui';
import { activarAvisos, desactivarAvisos, permisoActual, soportePush, suscripcionActual } from '../../lib/push';
import { useCarga } from '../../lib/useCarga';
import { useSesion } from '../../session/SessionContext';

type Estado = 'mirando' | 'activos' | 'apagados';

/**
 * Avisos en este celular: qué avisan, el interruptor y qué hacer si el permiso está bloqueado o es un iPhone sin el
 * panel instalado. Si el servidor no tiene los avisos configurados, no aparece.
 */
export function AvisosPush() {
  const { puede } = useSesion();
  const [servidor] = useCarga(() => estadoPush(), []);
  const soporte = soportePush();
  const [estado, setEstado] = useState<Estado>('mirando');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bloqueado, setBloqueado] = useState(() => soporte.tipo === 'si' && permisoActual() === 'denied');

  useEffect(() => {
    if (soporte.tipo !== 'si') return;
    let vigente = true;
    suscripcionActual()
      .then((s) => {
        if (vigente) setEstado(s ? 'activos' : 'apagados');
      })
      .catch(() => {
        if (vigente) setEstado('apagados');
      });
    return () => {
      vigente = false;
    };
  }, [soporte.tipo]);

  if (!servidor.datos?.disponible || !servidor.datos.clavePublica) return null;
  const clave = servidor.datos.clavePublica;
  const equipo = puede('push.equipo');

  const cambiar = async (activar: boolean) => {
    setOcupado(true);
    setError(null);
    try {
      if (activar) await activarAvisos(clave);
      else await desactivarAvisos();
      setEstado(activar ? 'activos' : 'apagados');
    } catch (err) {
      if (err instanceof Error && err.name === 'PermisoDenegado') setBloqueado(true);
      else setError(err instanceof Error && err.name === 'SinServiceWorker' ? err.message : mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="hoja bloque avisos-push" aria-labelledby="push-titulo">
      <h2 id="push-titulo" className="bloque-titulo">
        Avisos en este celular
      </h2>
      <ul className="push-lista">
        <li>Cuando entra un turno nuevo por la web.</li>
        {equipo ? (
          <>
            <li>Cuando alguien registra un lavado sin monto, para completarlo con el cliente todavía acá.</li>
            <li>Cuando se cumple la meta del mes.</li>
          </>
        ) : null}
      </ul>
      <p className="nota-chica">Nunca llevan datos del cliente ni importes.</p>

      {soporte.tipo === 'ios-sin-instalar' ? (
        <Aviso tipo="info" titulo="En iPhone, primero instalá el panel">
          Tocá Compartir y después "Agregar a inicio". Abrí el panel desde ese ícono y volvé acá para activar los avisos
          (hace falta iOS 16.4 o más nuevo).
        </Aviso>
      ) : soporte.tipo === 'no' ? (
        <Aviso tipo="info" titulo="Este navegador no recibe avisos">
          Probá desde Chrome en Android o con el panel instalado.
        </Aviso>
      ) : bloqueado ? (
        <Aviso tipo="info" titulo="Los avisos están bloqueados">
          Para activarlos, tocá el candado al lado de la dirección (o en Ajustes del celular → Notificaciones), permití las
          notificaciones del panel y volvé a esta pantalla.
        </Aviso>
      ) : estado === 'mirando' ? null : (
        <>
          <p className="push-estado" role="status">
            {estado === 'activos' ? 'Activados en este celular.' : 'Apagados en este celular.'}
          </p>
          <Boton
            variante={estado === 'activos' ? 'secundario' : 'primario'}
            cargando={ocupado}
            icono={estado === 'activos' ? <BellOff aria-hidden size={20} /> : <Bell aria-hidden size={20} />}
            onClick={() => void cambiar(estado !== 'activos')}
          >
            {estado === 'activos' ? 'Desactivar avisos' : 'Activar avisos'}
          </Boton>
        </>
      )}
      {error ? <Aviso titulo="No se pudo cambiar">{error}</Aviso> : null}
    </section>
  );
}
