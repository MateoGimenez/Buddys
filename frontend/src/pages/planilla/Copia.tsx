import { Camera, FileDown, History, Pencil, Trash2 } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { mensajeDeError } from '../../api/client';
import * as ep from '../../api/endpoints';
import type { Turno } from '../../api/types';
import { EtapaAuto } from '../../components/EtapaAuto';
import { usePuedeCambiarEtapa } from '../../lib/usePuedeCambiarEtapa';
import { Fotos } from '../../components/Fotos';
import { Aviso, Boton, Confirmar } from '../../components/ui';
import { NOMBRE_PAGO, NOMBRE_VEHICULO, hora, nombresDelTurno, pesos, serie } from '../../lib/format';
import { rutaHistorial } from '../../lib/historial';
import { useSesion } from '../../session/SessionContext';
import { Corregir } from './Corregir';
import { EditarNota } from './EditarNota';
import { EmitirComprobante } from './EmitirComprobante';
import type { ListaProps } from './Lista';

const NOMBRE_MOSTRADOR = 'Cliente de mostrador';

type Modo = 'ver' | 'corregir' | 'comprobante' | 'nota' | 'fotos';

export function Copia({ lavado, numero, orden, nombresServicio, veImportes, corrige, borra, comprobantes, fotos, catalogo, onCambio, onBorrado }: ListaProps & { lavado: Turno; numero: number; orden: number }) {
  const { puede } = useSesion();
  const puedeEtapa = usePuedeCambiarEtapa();
  /** Si se tocó la etapa acá, queda a la vista aunque el auto ya se haya entregado (para "Deshacer"). */
  const [tocoEtapa, setTocoEtapa] = useState(false);
  const historial = puede('turnos.clientes') ? rutaHistorial(lavado) : null;
  const [modo, setModo] = useState<Modo>('ver');
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const servicio = nombresDelTurno(lavado, nombresServicio);
  const cliente = lavado.nombre !== NOMBRE_MOSTRADOR ? lavado.nombre : null;
  const tituloId = `copia-${lavado.id}`;

  const borrar = async () => {
    setBorrando(true);
    setError(null);
    try {
      await ep.borrarTurno(lavado.id);
      setConfirmando(false);
      onBorrado(lavado.id);
    } catch (err) {
      setConfirmando(false);
      setError(mensajeDeError(err));
    } finally {
      setBorrando(false);
    }
  };

  return (
    <li className="copia" aria-labelledby={tituloId} style={{ '--orden': orden } as CSSProperties}>
      <div className="copia-cabeza">
        <span className="copia-serie">
          <span aria-hidden>N° {serie(numero)}</span>
          <span className="solo-lectores">Lavado número {numero}</span>
        </span>
        <span className="copia-hora">{hora(lavado.createdAt)}</span>
        {veImportes ? (
          <span className={`copia-monto ${lavado.monto === null ? 'copia-monto-falta' : ''}`}>
            {lavado.monto === null ? 'Sin monto' : pesos(lavado.monto)}
          </span>
        ) : null}
      </div>
      <p className="copia-servicio" id={tituloId}>
        {servicio}
      </p>
      <p className="copia-detalle">
        {NOMBRE_VEHICULO[lavado.vehiculoTipo]}
        {lavado.vehiculoModelo ? ` · ${lavado.vehiculoModelo}` : ''}
        {cliente ? ` · ${cliente}` : ''}
        {lavado.formaPago ? (
          <span className="copia-pago">{NOMBRE_PAGO[lavado.formaPago]}</span>
        ) : corrige ? (
          <span className="copia-pago copia-pago-falta">Pago sin indicar</span>
        ) : null}
      </p>
      <p className="copia-registro">
        Registrado por: <strong>{registradoPor(lavado)}</strong>
        {lavado.origen === 'web' ? <span className="etiqueta">Turno web</span> : null}
        {lavado.origen === 'panel' ? <span className="etiqueta">Turno</span> : null}
      </p>
      {veImportes && lavado.descuento ? (
        <p className="copia-descuento">
          Descuento de {pesos(lavado.descuento)}
          {lavado.descuentoMotivo ? ` · ${lavado.descuentoMotivo}` : ''}
        </p>
      ) : null}
      {lavado.etapa && (lavado.etapa !== 'entregado' || tocoEtapa) ? (
        <EtapaAuto
          lavado={lavado}
          puedeCambiar={puedeEtapa(lavado)}
          onCambio={(t) => {
            setTocoEtapa(true);
            onCambio(t);
          }}
        />
      ) : null}
      {lavado.notasInternas ? <p className="copia-nota">{lavado.notasInternas}</p> : null}

      {error ? <Aviso>{error}</Aviso> : null}

      {modo === 'ver' ? (
        <div className="copia-acciones">
          {corrige ? (
            <Boton chico variante="fantasma" icono={<Pencil aria-hidden size={18} />} onClick={() => { setModo('corregir'); setError(null); }}>
              Corregir
            </Boton>
          ) : (
            <Boton chico variante="fantasma" icono={<Pencil aria-hidden size={18} />} onClick={() => { setModo('nota'); setError(null); }}>
              {lavado.notasInternas ? 'Editar nota' : 'Agregar nota'}
            </Boton>
          )}
          {fotos ? (
            <Boton chico variante="fantasma" icono={<Camera aria-hidden size={18} />} onClick={() => { setModo('fotos'); setError(null); }}>
              Fotos
            </Boton>
          ) : null}
          {historial ? (
            <Link to={historial} className="btn btn-fantasma btn-chico" viewTransition>
              <History aria-hidden size={18} />
              Cliente
            </Link>
          ) : null}
          {comprobantes && lavado.monto !== null ? (
            <Boton chico variante="fantasma" icono={<FileDown aria-hidden size={18} />} onClick={() => { setModo('comprobante'); setError(null); }}>
              Comprobante
            </Boton>
          ) : null}
          {borra ? (
            <Boton chico variante="fantasma" className="btn-texto-peligro" icono={<Trash2 aria-hidden size={18} />} onClick={() => { setConfirmando(true); }}>
              Borrar
            </Boton>
          ) : null}
        </div>
      ) : null}

      {modo === 'corregir' ? (
        <Corregir
          lavado={lavado}
          catalogo={catalogo}
          onListo={(t) => {
            setModo('ver');
            onCambio(t);
          }}
          onCancelar={() => { setModo('ver'); }}
        />
      ) : null}
      {modo === 'nota' ? (
        <EditarNota
          lavado={lavado}
          onListo={(t) => {
            setModo('ver');
            onCambio(t);
          }}
          onCancelar={() => { setModo('ver'); }}
        />
      ) : null}
      {modo === 'fotos' ? (
        <div className="copia-form">
          <Fotos lavadoId={lavado.id} />
          <div className="fila-botones">
            <Boton chico variante="fantasma" onClick={() => { setModo('ver'); }}>
              Cerrar fotos
            </Boton>
          </div>
        </div>
      ) : null}
      {modo === 'comprobante' ? <EmitirComprobante lavado={lavado} onCerrar={() => { setModo('ver'); }} /> : null}

      <Confirmar
        abierto={confirmando}
        titulo={`¿Borrar el lavado N° ${serie(numero)}?`}
        confirmar="Sí, borrarlo"
        ocupado={borrando}
        onConfirmar={() => void borrar()}
        onCancelar={() => { setConfirmando(false); }}
      >
        {servicio} · {NOMBRE_VEHICULO[lavado.vehiculoTipo]}. Deja de contar en la planilla y en las estadísticas. Los productos que usó vuelven al stock. No se puede deshacer.
      </Confirmar>
    </li>
  );
}

/**
 * Quién anotó el lavado. Los turnos viejos o de la web no tienen `registradoPor`: ahí se muestra quién lo hizo, y si
 * tampoco hay, "sin dato" (contrato 05). Nunca un ranking: solo el nombre en cada hoja.
 */
function registradoPor(lavado: Turno): string {
  return lavado.registradoPor?.nombre ?? lavado.trabajador?.nombre ?? 'sin dato';
}
