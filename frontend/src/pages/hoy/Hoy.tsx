import { AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { lavadosEnCurso } from '../../api/etapas';
import * as ep from '../../api/endpoints';
import type { Etapa, MetaActual, PlanillaDelDia, Turno } from '../../api/types';
import { EtapaAuto } from '../../components/EtapaAuto';
import { usePuedeCambiarEtapa } from '../../lib/usePuedeCambiarEtapa';
import { Aviso, Boton, Cargando, Encabezado, Vacio } from '../../components/ui';
import { NOMBRE_ETAPA } from '../../lib/etapa';
import { NOMBRE_VEHICULO, fechaLarga, hoy, nombresDelTurno, pesos } from '../../lib/format';
import { useCarga } from '../../lib/useCarga';
import { useSesion } from '../../session/SessionContext';
import { Cifra } from '../planilla/Resumen';

/** Cada cuánto se pone al día sola (otros mueven autos y registran lavados). */
const CADA_MS = 45_000;

function useAlDia(recargar: () => void) {
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') recargar();
    }, CADA_MS);
    const alVolver = () => {
      if (document.visibilityState === 'visible') recargar();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [recargar]);
}

/**
 * Hoy: la primera pantalla del encargado. Lo cobrado contra lo que pide la meta, los autos que están en el
 * lavadero, lo que falta cargar, quién lavó más y si algo se está terminando. Pensada para leerse de un vistazo.
 */
export function Hoy() {
  const { puede } = useSesion();
  const hoyAR = hoy();
  const conMeta = puede('finanzas.metas');
  const conStock = puede('inventario.ver');
  const [dia, recargarDia] = useCarga(() => ep.planilla(hoyAR), [hoyAR]);
  const [meta, recargarMeta] = useCarga(() => (conMeta ? ep.metaActual() : Promise.resolve(null)), [conMeta]);
  const [curso, recargarCurso, actualizarCurso] = useCarga(() => lavadosEnCurso(), []);
  const [stock] = useCarga(() => (conStock ? ep.insumos() : Promise.resolve(null)), [conStock]);

  const recargarTodo = useCallback(() => {
    recargarDia();
    recargarMeta();
    recargarCurso();
  }, [recargarDia, recargarMeta, recargarCurso]);
  useAlDia(recargarTodo);

  const bajos = (stock.datos?.insumos ?? []).filter((i) => i.activo && i.bajoStock);

  return (
    <>
      <Encabezado titulo="Hoy" />
      <p className="encabezado-fecha">{fechaLarga(hoyAR)}</p>

      <div className="hoy">
        {dia.estado === 'error' && !dia.datos ? (
          <Aviso titulo="No pudimos cargar el día" accion={<Boton onClick={recargarDia}>Reintentar</Boton>}>
            {dia.mensaje}
          </Aviso>
        ) : !dia.datos ? (
          <Cargando texto="Cargando el día…" />
        ) : (
          <Caja dia={dia.datos} meta={meta.datos ?? null} conMeta={conMeta} />
        )}

        {bajos.length ? (
          <Aviso
            tipo="info"
            titulo={bajos.length === 1 ? 'Se está terminando un insumo' : `Se están terminando ${String(bajos.length)} insumos`}
            accion={
              <Link to="/insumos" className="btn btn-fantasma btn-chico">
                Ver insumos
              </Link>
            }
          >
            {bajos
              .slice(0, 4)
              .map((i) => i.nombre)
              .join(', ')}
            {bajos.length > 4 ? ` y ${String(bajos.length - 4)} más` : ''}.
          </Aviso>
        ) : null}

        <section className="hoja bloque" aria-labelledby="hoy-curso">
          <div className="bloque-cabeza">
            <h2 id="hoy-curso" className="bloque-titulo">
              En el lavadero ahora
            </h2>
            {curso.datos ? <ResumenEtapas resumen={curso.datos.resumen} /> : null}
          </div>
          {curso.estado === 'error' && !curso.datos ? (
            <Aviso titulo="No pudimos ver los autos en curso" accion={<Boton chico onClick={recargarCurso}>Reintentar</Boton>}>
              {curso.mensaje}
            </Aviso>
          ) : !curso.datos ? (
            <Cargando texto="Cargando los autos…" />
          ) : curso.datos.lavados.length === 0 ? (
            <Vacio
              titulo="No hay autos esperando ni lavándose"
              accion={
                <Link to="/registrar" className="btn btn-secundario">
                  <Plus aria-hidden size={20} />
                  Anotar un auto
                </Link>
              }
            >
              Cuando anotes uno como "Recién llega", aparece acá hasta que se entregue.
            </Vacio>
          ) : (
            <EnCurso
              lavados={curso.datos.lavados}
              onCambio={(t) => {
                actualizarCurso((prev) => ({ ...prev, lavados: prev.lavados.map((l) => (l.id === t.id ? t : l)) }));
              }}
            />
          )}
        </section>

      </div>
    </>
  );
}

function Caja({ dia, meta, conMeta }: { dia: PlanillaDelDia; meta: MetaActual | null; conMeta: boolean }) {
  const { resumen } = dia;
  const cobrado = resumen.total ?? 0;
  const porDia = meta?.meta?.ingresosObjetivo ? meta.progreso.necesarioPorDia : null;
  const fraccion = porDia && porDia > 0 ? Math.min(1, cobrado / porDia) : null;
  return (
    <section className="hoja hoy-caja" aria-labelledby="hoy-cobrado">
      <div className="hoy-cobrado">
        <h2 id="hoy-cobrado" className="hoy-etiqueta">
          Cobrado hoy
        </h2>
        <p className="hoy-cifra">
          <Cifra valor={cobrado} formato={pesos} />
        </p>
      </div>
      {fraccion !== null && porDia ? (
        <div className="hoy-meta">
          <div
            className="progreso-pista"
            role="progressbar"
            aria-label="Lo cobrado hoy contra lo que pide la meta por día"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fraccion * 100)}
          >
            <span style={{ inlineSize: `${String(fraccion * 100)}%` }} />
          </div>
          <p className="hoy-meta-texto">
            {cobrado >= porDia ? (
              <strong className="hoy-meta-ok">Ya está lo del día para la meta ({pesos(porDia)}).</strong>
            ) : (
              <>
                Faltan <strong>{pesos(porDia - cobrado)}</strong> para los {pesos(porDia)} por día que pide la meta.
              </>
            )}
          </p>
        </div>
      ) : conMeta && meta && !meta.meta ? (
        <p className="nota-chica">
          Este mes no tiene meta. <Link to="/numeros">Fijala en Números</Link> y acá vas a ver cuánto falta cada día.
        </p>
      ) : meta?.meta && meta.progreso.estado === 'cumplida' ? (
        <p className="hoy-meta-ok">¡La meta del mes ya está cumplida!</p>
      ) : null}
      <dl className="hoy-cuentas">
        <div>
          <dt>Lavados</dt>
          <dd>
            <Cifra valor={resumen.cantidad} />
          </dd>
        </div>
        {resumen.sinMonto > 0 ? (
          <div className="hoy-sin-monto">
            <dt>Sin monto</dt>
            <dd>
              <Link to="/planilla" className="hoy-enlace-alerta">
                <AlertTriangle aria-hidden size={18} />
                {resumen.sinMonto} para completar
                <ChevronRight aria-hidden size={18} />
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function ResumenEtapas({ resumen }: { resumen: Record<Exclude<Etapa, 'entregado'>, number> }) {
  const orden: Exclude<Etapa, 'entregado'>[] = ['espera', 'lavando', 'listo'];
  return (
    <ul className="hoy-etapas" aria-label="Cuántos autos hay en cada etapa">
      {orden.map((e) => (
        <li key={e} data-etapa={e}>
          <span className="hoy-etapas-n">{resumen[e]}</span> {NOMBRE_ETAPA[e]}
        </li>
      ))}
    </ul>
  );
}

function EnCurso({ lavados, onCambio }: { lavados: Turno[]; onCambio: (t: Turno) => void }) {
  const puedeEtapa = usePuedeCambiarEtapa();
  return (
    <ol className="hoy-autos">
      {lavados.map((l) => (
        <li key={l.id} className="copia hoy-auto" aria-label={`${nombresDelTurno(l)}, ${NOMBRE_VEHICULO[l.vehiculoTipo]}`}>
          <p className="copia-servicio">{nombresDelTurno(l)}</p>
          <p className="copia-detalle">
            {NOMBRE_VEHICULO[l.vehiculoTipo]}
            {l.vehiculoModelo ? ` · ${l.vehiculoModelo}` : ''}
            {l.nombre !== 'Cliente de mostrador' ? ` · ${l.nombre}` : ''}
            {l.registradoPor ? ` · ${l.registradoPor.nombre}` : ''}
          </p>
          <EtapaAuto lavado={l} puedeCambiar={puedeEtapa(l)} onCambio={onCambio} />
        </li>
      ))}
    </ol>
  );
}

