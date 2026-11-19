import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { caja, cierresDeCaja, type Cierre } from '../../api/finanzas';
import { Aviso, Boton, Cargando, Encabezado } from '../../components/ui';
import { fechaLarga, hoy, pesos, sumarDias } from '../../lib/format';
import { usePuedeDelTodo } from '../../lib/nivel';
import { useCarga } from '../../lib/useCarga';
import { Arqueo } from './Arqueo';
import { CierreHecho } from './CierreHecho';
import { conteoDe } from './datos';
import { Historial } from './Historial';

/** Hasta cuántos días atrás se puede cerrar o mirar una caja (lo limita el backend). */
const DIAS_ATRAS = 366;

/**
 * Cierre de caja con arqueo: lo contado por forma de pago contra lo esperado (lavados de mostrador, señas cobradas y
 * saldos de turnos del día). Admin y superadmin cierran; corregir o reabrir un cierre, solo el superadmin.
 */
export function PantallaCaja() {
  const hoyAR = hoy();
  const [params] = useSearchParams();
  const [fechaElegida, setFechaElegida] = useState<string | null>(() => {
    const f = params.get('fecha');
    return f && /^\d{4}-\d{2}-\d{2}$/.test(f) && f < hoyAR && f >= sumarDias(hoyAR, -DIAS_ATRAS) ? f : null;
  });
  const fecha = fechaElegida ?? hoyAR;
  const minimo = sumarDias(hoyAR, -DIAS_ATRAS);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [recien, setRecien] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<string | null>(null);
  const setFecha = (f: string) => {
    setFechaElegida(f >= hoyAR ? null : f < minimo ? minimo : f);
    setCorrigiendo(false);
    setRecien(null);
    setConflicto(null);
  };
  const reabre = usePuedeDelTodo('caja.reabrir');
  const [dia, recargar] = useCarga(() => caja(fecha), [fecha]);
  const [historial, recargarHistorial] = useCarga(() => cierresDeCaja(), []);

  const datos = dia.datos?.fecha === fecha ? dia.datos : null;

  const alCerrar = (c: Cierre) => {
    setConflicto(null);
    setRecien(corrigiendo ? 'Cierre corregido.' : `Caja del ${fechaLarga(c.fecha)} cerrada.`);
    setCorrigiendo(false);
    recargar();
    recargarHistorial();
  };

  return (
    <>
      <Encabezado titulo="Cierre de caja">
        <div className="navegador-fecha">
          <Boton
            chico
            variante="fantasma"
            aria-label="Día anterior"
            icono={<ChevronLeft aria-hidden size={20} />}
            disabled={fecha <= minimo}
            onClick={() => {
              setFecha(sumarDias(fecha, -1));
            }}
          />
          <label className="navegador-fecha-campo">
            <span className="solo-lectores">Fecha de la caja</span>
            <input
              type="date"
              value={fecha}
              min={minimo}
              max={hoyAR}
              onChange={(e) => {
                if (e.target.value) setFecha(e.target.value);
              }}
            />
          </label>
          <Boton
            chico
            variante="fantasma"
            aria-label="Día siguiente"
            icono={<ChevronRight aria-hidden size={20} />}
            disabled={fecha >= hoyAR}
            onClick={() => {
              setFecha(sumarDias(fecha, 1));
            }}
          />
          {fecha !== hoyAR ? (
            <Boton
              chico
              variante="fantasma"
              onClick={() => {
                setFecha(hoyAR);
              }}
            >
              Hoy
            </Boton>
          ) : null}
        </div>
      </Encabezado>
      <p className="encabezado-fecha">{fecha === hoyAR ? `Hoy, ${fechaLarga(fecha)}` : fechaLarga(fecha)}</p>

      {recien ? <Aviso tipo="ok" titulo={recien} /> : null}
      {conflicto ? <Aviso titulo="La caja ya estaba cerrada">{conflicto}</Aviso> : null}
      {dia.estado === 'error' ? (
        <Aviso titulo="No pudimos cargar la caja" accion={<Boton onClick={recargar}>Reintentar</Boton>}>
          {dia.mensaje}
        </Aviso>
      ) : null}
      {!datos && dia.estado === 'cargando' ? <Cargando texto="Cargando la caja…" /> : null}

      {datos ? (
        <div className="caja-pantalla" aria-busy={dia.estado === 'cargando'}>
          <section className="hoja caja-esperado" aria-labelledby="esperado-titulo">
            <h2 id="esperado-titulo" className="caja-esperado-titulo">
              Tendría que haber
            </h2>
            <p className="caja-esperado-total">{pesos(datos.esperado.total)}</p>
            <p className="nota-chica">Lavados del día, señas cobradas y saldos de turnos completados.</p>
            {datos.esperado.sinIndicar > 0 && !datos.cierre ? (
              <p className="caja-esperado-aviso">
                {pesos(datos.esperado.sinIndicar)} sin forma de pago.{' '}
                <Link to="/planilla">Cargala en la planilla</Link> antes de cerrar, así entra en el arqueo.
              </p>
            ) : null}
          </section>

          {datos.cierre && !corrigiendo ? (
            <CierreHecho
              cierre={datos.cierre}
              esperadoAhora={datos.esperado}
              reabre={reabre}
              onCorregir={() => {
                setRecien(null);
                setCorrigiendo(true);
              }}
              onReabierta={() => {
                setRecien('Caja reabierta: la podés volver a contar.');
                recargar();
                recargarHistorial();
              }}
            />
          ) : (
            <Arqueo
              key={`${fecha}-${corrigiendo ? 'corrige' : 'nuevo'}`}
              fecha={fecha}
              esperado={datos.esperado}
              corrigiendo={corrigiendo}
              {...(corrigiendo && datos.cierre ? { inicial: conteoDe(datos.cierre), notaInicial: datos.cierre.nota } : {})}
              {...(corrigiendo
                ? {
                    onCancelar: () => {
                      setCorrigiendo(false);
                    },
                  }
                : {})}
              onListo={alCerrar}
              onYaCerrada={(m) => {
                setCorrigiendo(false);
                setRecien(null);
                setConflicto(m);
                recargar();
                recargarHistorial();
              }}
            />
          )}
        </div>
      ) : null}

      <Historial carga={historial} recargar={recargarHistorial} fechaActual={fecha} onElegir={setFecha} />
    </>
  );
}
