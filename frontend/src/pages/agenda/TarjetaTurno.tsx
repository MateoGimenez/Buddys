import { useState } from 'react';
import { mensajeDeError } from '../../api/client';
import { cambiarTurno, type TurnoAgenda } from '../../api/agenda';
import { Aviso, Boton, Confirmar } from '../../components/ui';
import { diaMes, NOMBRE_FRANJA, NOMBRE_PAGO, NOMBRE_VEHICULO, nombresDelTurno, pesos } from '../../lib/format';
import { Completar } from './Completar';
import { franjaDeAgenda, NOMBRE_ESTADO } from './datos';
import { EditarSena } from './EditarSena';

type Abierto = 'completar' | 'sena' | null;

/**
 * Un turno de la agenda. Quien ve importes ve la seña, el total y el saldo; el empleado ve que dejó seña y cómo, sin
 * ningún monto, y lo puede marcar terminado.
 */
export function TarjetaTurno({
  turno,
  veImportes,
  cancela,
  gestionaSena,
  onCambio,
}: {
  turno: TurnoAgenda;
  veImportes: boolean;
  /** Puede cancelar (turnos.estado completo). */
  cancela: boolean;
  /** Puede cargar o corregir la seña (turnos.crear y ve importes). */
  gestionaSena: boolean;
  onCambio: (t: TurnoAgenda | null, aviso: string) => void;
}) {
  const [abierto, setAbierto] = useState<Abierto>(null);
  const [confirmando, setConfirmando] = useState<'cancelar' | 'terminar' | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = turno;
  const abiertoTurno = t.estado === 'pendiente' || t.estado === 'confirmado';
  const sena = t.sena ?? null;

  const cambiarEstado = async (estado: 'cancelado' | 'completado') => {
    setOcupado(true);
    setError(null);
    try {
      const { booking } = await cambiarTurno(t.id, { estado });
      setConfirmando(null);
      onCambio(booking, estado === 'cancelado' ? `Turno de ${t.nombre} cancelado.` : `Turno de ${t.nombre} terminado.`);
    } catch (err) {
      setConfirmando(null);
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <li className="hoja turno" data-estado={t.estado}>
      <div className="turno-cabeza">
        <span className="turno-franja">{NOMBRE_FRANJA[franjaDeAgenda(t)]}</span>
        <h3 className="turno-nombre">{t.nombre}</h3>
        <span className={`etiqueta turno-estado turno-estado-${t.estado}`}>{NOMBRE_ESTADO[t.estado]}</span>
      </div>
      <p className="turno-servicios">{nombresDelTurno(t)}</p>
      <p className="turno-detalle">
        {NOMBRE_VEHICULO[t.vehiculoTipo]}
        {t.vehiculoModelo ? ` · ${t.vehiculoModelo}` : ''}
        {t.telefono ? (
          <>
            {' · '}
            <a href={`tel:${t.telefono.replace(/[^\d+]/g, '')}`}>{t.telefono}</a>
          </>
        ) : null}
      </p>

      {sena ? (
        <p className="turno-sena">
          {veImportes && sena.monto !== null ? `Seña ${pesos(sena.monto)}` : 'Dejó seña'} · {sena.formaPago ? `${NOMBRE_PAGO[sena.formaPago]} · ` : ''}{diaMes(sena.fecha)}
        </p>
      ) : null}
      {veImportes && t.estado === 'completado' && t.monto !== null ? (
        <dl className="saldo saldo-hecho">
          <div>
            <dt>Total</dt>
            <dd>{pesos(t.monto)}</dd>
          </div>
          {sena?.monto ? (
            <div>
              <dt>Seña</dt>
              <dd>{pesos(sena.monto)}</dd>
            </div>
          ) : null}
          {t.saldo !== null ? (
            <div className="saldo-final">
              <dt>Saldo</dt>
              <dd>{pesos(t.saldo)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {t.comentario ? <p className="turno-nota">{t.comentario}</p> : null}
      {t.notasInternas ? <p className="turno-nota">{t.notasInternas}</p> : null}

      {error ? <Aviso>{error}</Aviso> : null}

      {abierto === 'completar' ? (
        <Completar
          turno={t}
          onCancelar={() => { setAbierto(null); }}
          onListo={(nuevo) => {
            setAbierto(null);
            const saldo = nuevo.saldo ?? null;
            onCambio(nuevo, saldo !== null && nuevo.sena ? `Turno completado. Saldo a cobrar: ${pesos(saldo)}.` : 'Turno completado.');
          }}
        />
      ) : abierto === 'sena' ? (
        <EditarSena
          turno={t}
          onCancelar={() => { setAbierto(null); }}
          onListo={(nuevo) => {
            setAbierto(null);
            onCambio(nuevo, nuevo ? 'Seña guardada.' : 'Seña quitada.');
          }}
        />
      ) : abiertoTurno ? (
        <div className="copia-acciones">
          {veImportes ? (
            <Boton chico variante="primario" onClick={() => { setAbierto('completar'); }}>
              Completar
            </Boton>
          ) : (
            <Boton chico variante="primario" onClick={() => { setConfirmando('terminar'); }}>
              Marcar terminado
            </Boton>
          )}
          {gestionaSena ? (
            <Boton chico variante="secundario" onClick={() => { setAbierto('sena'); }}>
              {sena ? 'Seña' : 'Cargar seña'}
            </Boton>
          ) : null}
          {cancela ? (
            <Boton chico variante="fantasma" className="btn-texto-peligro" onClick={() => { setConfirmando('cancelar'); }}>
              Cancelar turno
            </Boton>
          ) : null}
        </div>
      ) : null}

      <Confirmar
        abierto={confirmando === 'cancelar'}
        titulo={`¿Cancelar el turno de ${t.nombre}?`}
        confirmar="Sí, cancelarlo"
        ocupado={ocupado}
        onConfirmar={() => void cambiarEstado('cancelado')}
        onCancelar={() => { setConfirmando(null); }}
      >
        {sena ? 'La seña queda registrada. Si se la devolviste, quitala desde "Seña" antes de cancelar.' : 'Sale de la agenda.'}
      </Confirmar>
      <Confirmar
        abierto={confirmando === 'terminar'}
        titulo="¿Marcar el turno como terminado?"
        confirmar="Sí, terminado"
        variante="primario"
        ocupado={ocupado}
        onConfirmar={() => void cambiarEstado('completado')}
        onCancelar={() => { setConfirmando(null); }}
      >
        El cobro lo carga un encargado.
      </Confirmar>
    </li>
  );
}
