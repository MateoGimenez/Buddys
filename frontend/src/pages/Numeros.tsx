import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../api/client';
import * as ep from '../api/endpoints';
import type { Cifras, Estadisticas, MetaActual, MisTrabajos } from '../api/types';
import { Aviso, Boton, Campo, Cargando, Encabezado, Segmentado, Vacio } from '../components/ui';
import {
  diaMes,
  enteroDesdeTexto,
  hoy,
  mesAnterior,
  miles,
  nombreMes,
  pesos,
  porcentaje,
  primeroDelMes,
  ultimoDelMes,
} from '../lib/format';
import { useCarga } from '../lib/useCarga';
import { useSesion } from '../session/SessionContext';

type Periodo = 'mes' | 'mes-pasado' | 'anio' | 'otro';

function rangoDe(periodo: Periodo, hoyAR: string, otro: { desde: string; hasta: string }) {
  if (periodo === 'mes') return { desde: primeroDelMes(hoyAR), hasta: hoyAR };
  if (periodo === 'mes-pasado') {
    const fin = mesAnterior(hoyAR);
    return { desde: primeroDelMes(fin), hasta: ultimoDelMes(fin) };
  }
  if (periodo === 'anio') return { desde: `${hoyAR.slice(0, 4)}-01-01`, hasta: hoyAR };
  return otro;
}

function ElegirPeriodo({ periodo, setPeriodo, otro, setOtro, hoyAR }: { periodo: Periodo; setPeriodo: (p: Periodo) => void; otro: { desde: string; hasta: string }; setOtro: (o: { desde: string; hasta: string }) => void; hoyAR: string }) {
  return (
    <div className="periodo">
      <Segmentado
        leyenda="Período"
        leyendaOculta
        nombre="periodo"
        valor={periodo}
        onCambio={setPeriodo}
        opciones={[
          { valor: 'mes', etiqueta: 'Este mes' },
          { valor: 'mes-pasado', etiqueta: 'Mes pasado' },
          { valor: 'anio', etiqueta: 'Este año' },
          { valor: 'otro', etiqueta: 'Otras fechas' },
        ]}
      />
      {periodo === 'otro' ? (
        <div className="fila-campos">
          <Campo etiqueta="Desde" type="date" max={hoyAR} value={otro.desde} onChange={(e) => { if (e.target.value) setOtro({ ...otro, desde: e.target.value }); }} />
          <Campo etiqueta="Hasta" type="date" max={hoyAR} value={otro.hasta} onChange={(e) => { if (e.target.value) setOtro({ ...otro, hasta: e.target.value }); }} />
        </div>
      ) : null}
    </div>
  );
}

export function Numeros() {
  const { puede } = useSesion();
  const hoyAR = hoy();
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [otro, setOtro] = useState({ desde: primeroDelMes(hoyAR), hasta: hoyAR });
  const rango = rangoDe(periodo, hoyAR, otro);
  const completas = puede('estadisticas.completas');

  return (
    <>
      <Encabezado titulo={completas ? 'Números del lavadero' : 'Tus lavados'} />
      <ElegirPeriodo periodo={periodo} setPeriodo={setPeriodo} otro={otro} setOtro={setOtro} hoyAR={hoyAR} />
      {completas ? <Completas desde={rango.desde} hasta={rango.hasta} metas={puede('finanzas.metas')} /> : <Propias desde={rango.desde} hasta={rango.hasta} />}
    </>
  );
}

/* ---------------------------------------------------------------- Empleado: sus lavados, sin importes */

function Propias({ desde, hasta }: { desde: string; hasta: string }) {
  const [carga, recargar] = useCarga(() => ep.misTrabajos(desde, hasta), [desde, hasta]);
  if (carga.estado === 'error' && !carga.datos)
    return <Aviso titulo="No pudimos cargar tus números" accion={<Boton onClick={recargar}>Reintentar</Boton>}>{carga.mensaje}</Aviso>;
  if (!carga.datos) return <Cargando />;
  const d: MisTrabajos = carga.datos;
  return (
    <div className="numeros" aria-busy={carga.estado === 'cargando'}>
      {carga.estado === 'error' ? <Aviso>{carga.mensaje}</Aviso> : null}
      <section className="hoja bloque">
        <h2 className="bloque-titulo">
          {d.completados} {d.completados === 1 ? 'lavado' : 'lavados'} entre el {diaMes(d.rango.desde)} y el {diaMes(d.rango.hasta)}
        </h2>
        {d.completados === 0 ? (
          <Vacio titulo="Todavía no hay lavados a tu nombre en este período">Cuando registres uno, va a aparecer acá.</Vacio>
        ) : (
          <Barras
            titulo="Lavados por día"
            puntos={d.serie.map((p) => ({ clave: p.clave, valor: p.completados }))}
            formato={(v) => `${v}`}
          />
        )}
      </section>
      {d.porServicio.length ? (
        <section className="hoja bloque">
          <h2 className="bloque-titulo">Por servicio</h2>
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Servicio</th>
                <th scope="col" className="num">Lavados</th>
              </tr>
            </thead>
            <tbody>
              {d.porServicio.map((s) => (
                <tr key={s.servicioId}>
                  <td>{s.nombre}</td>
                  <td className="num">{s.completados}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Encargados: con importes */

function variacion(actual: number, anterior: number): string | null {
  if (anterior === 0) return null;
  const v = (actual - anterior) / Math.abs(anterior);
  const signo = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${signo}${porcentaje(Math.abs(v))}`;
}

function FilaResumen({ nombre, c }: { nombre: string; c: { actual: Cifras; anterior: Cifras } }) {
  const vIng = variacion(c.actual.ingresos, c.anterior.ingresos);
  return (
    <tr>
      <th scope="row">{nombre}</th>
      <td className="num">{c.actual.completados}</td>
      <td className="num">
        {pesos(c.actual.ingresos)}
        {vIng ? <span className={`variacion ${c.actual.ingresos >= c.anterior.ingresos ? 'sube' : 'baja'}`}>{vIng}</span> : null}
      </td>
      <td className={`num ${c.actual.ganancia < 0 ? 'negativo' : ''}`}>{pesos(c.actual.ganancia)}</td>
    </tr>
  );
}

function Completas({ desde, hasta, metas }: { desde: string; hasta: string; metas: boolean }) {
  const [carga, recargar] = useCarga(() => ep.estadisticas(desde, hasta), [desde, hasta]);

  return (
    <div className="numeros" aria-busy={carga.estado === 'cargando'}>
      {metas ? <Meta /> : null}
      {carga.estado === 'error' ? (
        <Aviso titulo="No pudimos cargar las estadísticas" accion={<Boton onClick={recargar}>Reintentar</Boton>}>
          {carga.mensaje}
        </Aviso>
      ) : null}
      {!carga.datos ? carga.estado === 'cargando' ? <Cargando /> : null : <Tablero e={carga.datos} />}
    </div>
  );
}

function Tablero({ e }: { e: Estadisticas }) {
  const p = e.periodo;
  const lider = e.porTrabajador[0];
  return (
    <>
      <section className="hoja bloque" aria-labelledby="t-resumen">
        <h2 id="t-resumen" className="bloque-titulo">
          Al día de hoy
        </h2>
        <div className="tabla-scroll">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col"><span className="solo-lectores">Período</span></th>
                <th scope="col" className="num">Lavados</th>
                <th scope="col" className="num">Ingresos</th>
                <th scope="col" className="num">Ganancia</th>
              </tr>
            </thead>
            <tbody>
              <FilaResumen nombre="Hoy" c={e.resumen.hoy} />
              <FilaResumen nombre="Este mes" c={e.resumen.mes} />
              <FilaResumen nombre="Este año" c={e.resumen.anio} />
            </tbody>
          </table>
        </div>
        <p className="nota-chica">La variación compara con el mismo tramo del período anterior. Ganancia = ingresos − gastos.</p>
      </section>

      <section className="hoja bloque" aria-labelledby="t-periodo">
        <h2 id="t-periodo" className="bloque-titulo">
          Del {diaMes(e.rango.desde)} al {diaMes(e.rango.hasta)}
        </h2>
        <dl className="cifras-periodo">
          <div><dt>Lavados</dt><dd>{p.completados}</dd></div>
          <div><dt>Ingresos</dt><dd>{pesos(p.ingresos)}</dd></div>
          <div><dt>Gastos</dt><dd>{pesos(p.gastos)}</dd></div>
          <div><dt>Ganancia</dt><dd className={p.gananciaNeta < 0 ? 'negativo' : ''}>{pesos(p.gananciaNeta)}</dd></div>
          <div><dt>Ticket promedio</dt><dd>{p.ticketPromedio === null ? '—' : pesos(p.ticketPromedio)}</dd></div>
          {p.completadosSinMonto > 0 ? (
            <div><dt>Sin monto cargado</dt><dd className="cifra-alerta">{p.completadosSinMonto}</dd></div>
          ) : null}
        </dl>
        {p.completados === 0 && p.gastos === 0 ? (
          <Vacio titulo="No hay movimiento en estas fechas">Probá con otro período.</Vacio>
        ) : (
          <Barras
            titulo={e.granularidad === 'dia' ? 'Ingresos por día' : 'Ingresos por mes'}
            puntos={e.serie.map((s) => ({ clave: s.clave, valor: s.ingresos }))}
            formato={pesos}
          />
        )}
      </section>

      <section className="hoja bloque" aria-labelledby="t-equipo">
        <h2 id="t-equipo" className="bloque-titulo">Ranking del equipo</h2>
        {e.porTrabajador.length === 0 ? (
          <Vacio titulo="Nadie completó lavados en este período" />
        ) : (
          <ol className="ranking-lista">
            {e.porTrabajador.map((t, i) => (
              <li key={t.id ?? 'sin-asignar'} className="ranking-fila" data-primero={i === 0 ? '' : undefined}>
                <span className="ranking-puesto">{i + 1}</span>
                <span className="ranking-nombre">{t.nombre}</span>
                <span className="ranking-barra" aria-hidden>
                  <span style={{ inlineSize: `${lider?.completados ? Math.max(6, Math.round((t.completados / lider.completados) * 100)) : 0}%` }} />
                </span>
                <span className="ranking-cantidad">{t.completados} {t.completados === 1 ? 'lavado' : 'lavados'}</span>
                <span className="ranking-total">{pesos(t.ingresos)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="hoja bloque" aria-labelledby="t-servicios">
        <h2 id="t-servicios" className="bloque-titulo">Por servicio</h2>
        <div className="tabla-scroll">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Servicio</th>
                <th scope="col" className="num">Lavados</th>
                <th scope="col" className="num">Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {e.porServicio.map((s) => (
                <tr key={s.servicioId}>
                  <td>{s.nombre}</td>
                  <td className="num">{s.completados}</td>
                  <td className="num">{pesos(s.ingresos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- Barras (SVG simple, una serie) */

function Barras({ titulo, puntos, formato }: { titulo: string; puntos: { clave: string; valor: number }[]; formato: (v: number) => string }) {
  const max = Math.max(1, ...puntos.map((p) => p.valor));
  const mejor = puntos.reduce<{ clave: string; valor: number } | null>((acc, p) => (!acc || p.valor > acc.valor ? p : acc), null);
  const etiqueta = (clave: string) => (clave.length === 7 ? nombreMes(clave).split(' ')[0] ?? clave : diaMes(clave));
  return (
    <figure className="barras">
      <figcaption>
        {titulo}
        {mejor && mejor.valor > 0 ? <span className="barras-mejor"> · mejor: {etiqueta(mejor.clave)}, {formato(mejor.valor)}</span> : null}
      </figcaption>
      <div className="barras-area" role="img" aria-label={`${titulo}. Máximo ${formato(max)}.`}>
        {puntos.map((p) => (
          <span key={p.clave} className="grafico-col" title={`${etiqueta(p.clave)}: ${formato(p.valor)}`}>
            <span className="grafico-relleno" style={{ blockSize: `${(p.valor / max) * 100}%` }} />
          </span>
        ))}
      </div>
      <div className="barras-eje" aria-hidden>
        <span>{puntos[0] ? etiqueta(puntos[0].clave) : ''}</span>
        <span>{puntos.at(-1) ? etiqueta(puntos.at(-1)?.clave ?? '') : ''}</span>
      </div>
    </figure>
  );
}

/* ---------------------------------------------------------------- Meta del mes */

const ESTADO_META: Record<MetaActual['progreso']['estado'], string> = {
  'sin-meta': 'Sin meta',
  cumplida: 'Cumplida',
  adelantado: 'Adelantados',
  'en-ritmo': 'En ritmo',
  atrasado: 'Atrasados',
};

function Meta() {
  const [carga, recargar] = useCarga(() => ep.metaActual(), []);
  const [editando, setEditando] = useState(false);

  if (carga.estado === 'error' && !carga.datos) return <Aviso titulo="No pudimos cargar la meta del mes" accion={<Boton onClick={recargar}>Reintentar</Boton>}>{carga.mensaje}</Aviso>;
  if (!carga.datos) return <Cargando />;
  const { mes, meta, progreso } = carga.datos;

  return (
    <section className="hoja bloque meta" aria-labelledby="t-meta">
      <div className="bloque-cabeza">
        <h2 id="t-meta" className="bloque-titulo">Meta de {nombreMes(mes)}</h2>
        {meta ? <span className={`estado-meta estado-${progreso.estado}`}>{ESTADO_META[progreso.estado]}</span> : null}
      </div>
      {editando ? (
        <FormMeta mes={mes} actual={meta} onListo={() => { setEditando(false); recargar(); }} onCancelar={() => { setEditando(false); }} />
      ) : meta ? (
        <>
          {meta.ingresosObjetivo !== null ? (
            <Progreso etiqueta="Ingresos" actual={pesos(progreso.ingresos)} objetivo={pesos(meta.ingresosObjetivo)} fraccion={progreso.porcentajeIngresos ?? 0} />
          ) : null}
          {meta.trabajosObjetivo !== null ? (
            <Progreso etiqueta="Lavados" actual={String(progreso.trabajos)} objetivo={String(meta.trabajosObjetivo)} fraccion={progreso.porcentajeTrabajos ?? 0} />
          ) : null}
          <p className="nota-chica">
            Quedan {progreso.diasDeAtencionRestantes} de {progreso.diasDeAtencionTotales} días de atención.
            {progreso.necesarioPorDia !== null && progreso.necesarioPorDia > 0 ? ` Hacen falta ${pesos(progreso.necesarioPorDia)} por día.` : ''}
            {progreso.proyeccionIngresos !== null ? ` A este ritmo cerrás el mes en ${pesos(progreso.proyeccionIngresos)}.` : ''}
          </p>
          <Boton chico variante="fantasma" onClick={() => { setEditando(true); }}>Cambiar meta</Boton>
        </>
      ) : (
        <Vacio titulo="Este mes no tiene meta" accion={<Boton variante="primario" onClick={() => { setEditando(true); }}>Fijar meta</Boton>}>
          Poné cuánto querés facturar o cuántos lavados hacer, y seguí el ritmo día a día.
        </Vacio>
      )}
    </section>
  );
}

function Progreso({ etiqueta, actual, objetivo, fraccion }: { etiqueta: string; actual: string; objetivo: string; fraccion: number }) {
  return (
    <div className="progreso">
      <div className="progreso-texto">
        <span>{etiqueta}</span>
        <span>
          <strong>{actual}</strong> de {objetivo} ({porcentaje(fraccion)})
        </span>
      </div>
      <div className="progreso-pista" role="progressbar" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraccion * 100)}>
        <span style={{ inlineSize: `${Math.min(100, fraccion * 100)}%` }} />
      </div>
    </div>
  );
}

function FormMeta({ mes, actual, onListo, onCancelar }: { mes: string; actual: MetaActual['meta']; onListo: () => void; onCancelar: () => void }) {
  const [ingresos, setIngresos] = useState(actual?.ingresosObjetivo ? miles(String(actual.ingresosObjetivo)) : '');
  const [trabajos, setTrabajos] = useState(actual?.trabajosObjetivo ? String(actual.trabajosObjetivo) : '');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    setErrores({});
    try {
      await ep.fijarMeta(mes, { ingresosObjetivo: enteroDesdeTexto(ingresos), trabajosObjetivo: enteroDesdeTexto(trabajos) });
      onListo();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="formulario" onSubmit={(e) => void guardar(e)} noValidate>
      {error ? <Aviso>{error}</Aviso> : null}
      <Campo etiqueta="Ingresos del mes" prefijo="$" inputMode="numeric" value={ingresos} onChange={(e) => { setIngresos(miles(e.target.value)); }} error={errores.ingresosObjetivo} ayuda="Vacío = sin objetivo de ingresos." />
      <Campo etiqueta="Lavados del mes" inputMode="numeric" value={trabajos} onChange={(e) => { setTrabajos(e.target.value.replace(/\D/g, '')); }} error={errores.trabajosObjetivo} />
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>Guardar meta</Boton>
      </div>
    </form>
  );
}
