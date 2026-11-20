import { Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../api/client';
import * as ep from '../api/endpoints';
import {
  MAX_CANTIDAD_RECETA,
  MAX_RENGLONES_RECETA,
  VEHICULOS,
  type Insumo,
  type Receta,
  type RenglonReceta,
  type Servicio,
  type Unidad,
  type VehiculoTipo,
} from '../api/types';
import { NOMBRE_UNIDAD, NOMBRE_VEHICULO, cantidadConUnidad, decimalDesdeTexto, paraBuscar } from '../lib/format';
import { numeroParaCampo } from '../lib/compras';
import { useCarga } from '../lib/useCarga';
import { Aviso, Boton, Campo } from './ui';

/* La receta de un servicio: la general y una por cada vehículo que el servicio ofrece. Cada variante es una pestaña y
   se guarda por separado (PUT /api/admin/servicios/:id/receta reemplaza solo esa). Quien no puede editar la ve igual,
   en solo lectura y sin costos (la receta no trae ninguno). */

type Clave = 'general' | VehiculoTipo;

interface Renglon {
  /** Para el key de React: el id del insumo en los guardados; uno propio en los nuevos. */
  llave: string;
  texto: string;
  insumoId: string | null;
  unidad: Unidad | null;
  cantidad: string;
}

let proximaLlave = 1;

function renglonDe(r: RenglonReceta): Renglon {
  return { llave: r.insumoId, texto: r.nombre, insumoId: r.insumoId, unidad: r.unidad, cantidad: numeroParaCampo(r.cantidad) };
}

function renglonVacio(): Renglon {
  return { llave: `nuevo-${String(proximaLlave++)}`, texto: '', insumoId: null, unidad: null, cantidad: '' };
}

function renglonesDe(receta: Receta | undefined, clave: Clave): RenglonReceta[] {
  if (!receta) return [];
  return clave === 'general' ? receta.general : (receta.porVehiculo[clave] ?? []);
}

/** Lo que importa para saber si hay cambios sin guardar (los renglones vacíos no cuentan). */
function firma(renglones: { insumoId: string | null; texto: string; cantidad: string }[]): string {
  return JSON.stringify(
    renglones
      .filter((r) => r.texto.trim() || r.cantidad.trim())
      .map((r) => [r.insumoId ?? paraBuscar(r.texto), decimalDesdeTexto(r.cantidad)]),
  );
}

function nombreClave(clave: Clave): string {
  return clave === 'general' ? 'General' : NOMBRE_VEHICULO[clave];
}

export function BloqueReceta({
  servicio,
  receta,
  edita,
  onGuardada,
  onPendientes,
}: {
  servicio: Servicio;
  receta: Receta | undefined;
  edita: boolean;
  onGuardada?: (r: Receta) => void;
  /** Avisa si alguna pestaña tiene cambios sin guardar (para no perderlos al cerrar la edición). */
  onPendientes?: (hay: boolean) => void;
}) {
  const claves: Clave[] = ['general', ...VEHICULOS.filter((v) => servicio.vehiculos.includes(v))];
  const [elegida, setElegida] = useState<Clave>('general');
  const [borradores, setBorradores] = useState<Partial<Record<Clave, Renglon[]>>>({});
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const titulo = `${id}-titulo`;
  const insumos = useCarga(() => (edita ? ep.insumos().then((r) => r.insumos) : Promise.resolve([] as Insumo[])), [edita])[0];

  const renglones = (c: Clave): Renglon[] => borradores[c] ?? renglonesDe(receta, c).map(renglonDe);
  const sinGuardar = (c: Clave) => borradores[c] !== undefined && firma(renglones(c)) !== firma(renglonesDe(receta, c).map(renglonDe));
  const hayPendientes = edita && claves.some(sinGuardar);
  const avisarRef = useRef(onPendientes);
  useEffect(() => {
    avisarRef.current = onPendientes;
  });
  useEffect(() => {
    avisarRef.current?.(hayPendientes);
  }, [hayPendientes]);

  const elegir = (i: number) => {
    const c = claves[i];
    if (!c) return;
    setElegida(c);
    tabsRef.current[i]?.focus();
  };

  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    const actual = claves.indexOf(elegida);
    let i: number | null = null;
    if (e.key === 'ArrowRight') i = (actual + 1) % claves.length;
    else if (e.key === 'ArrowLeft') i = (actual - 1 + claves.length) % claves.length;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = claves.length - 1;
    if (i !== null) {
      e.preventDefault();
      elegir(i);
    }
  };

  return (
    <section className="receta" aria-labelledby={edita ? titulo : undefined} aria-label={edita ? undefined : `Receta de ${servicio.nombre}`}>
      {/* En lectura va dentro del plegable "Receta": el título ya está en el resumen. */}
      {edita ? (
        <div className="receta-cabeza">
          <h4 id={titulo} className="receta-titulo">Receta</h4>
          <p className="nota-chica">Lo que se descuenta del stock en cada lavado. Cada pestaña se guarda por separado.</p>
        </div>
      ) : null}
      <div className="receta-tabs" role="tablist" aria-label={`Receta de ${servicio.nombre}`} onKeyDown={alTeclear}>
        {claves.map((c, i) => {
          const n = renglones(c).filter((r) => r.texto.trim()).length;
          const pendiente = edita && sinGuardar(c);
          return (
            <button
              key={c}
              ref={(el) => { tabsRef.current[i] = el; }}
              type="button"
              role="tab"
              id={`${id}-tab-${c}`}
              aria-selected={c === elegida}
              tabIndex={c === elegida ? 0 : -1}
              className="receta-tab"
              onClick={() => { setElegida(c); }}
            >
              {nombreClave(c)}
              {n > 0 ? (
                <>
                  <span className="receta-tab-cuenta" aria-hidden>{n}</span>
                  <span className="solo-lectores">, {n === 1 ? '1 insumo' : `${String(n)} insumos`}</span>
                </>
              ) : null}
              {pendiente ? <span className="receta-tab-pendiente"><span className="solo-lectores">, sin guardar</span></span> : null}
            </button>
          );
        })}
      </div>
      {claves.map((c) => (
        <div
          key={c}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${c}`}
          hidden={c !== elegida}
          // En lectura el panel no tiene nada enfocable: se puede llegar a él con Tab para leerlo.
          tabIndex={!edita && c === elegida ? 0 : undefined}
          className="receta-panel"
        >
          {edita ? (
            <VarianteEditable
              servicio={servicio}
              clave={c}
              renglones={renglones(c)}
              insumos={insumos.datos}
              errorInsumos={insumos.estado === 'error' ? insumos.mensaje : null}
              pendiente={sinGuardar(c)}
              onCambio={(r) => { setBorradores((b) => ({ ...b, [c]: r })); }}
              onGuardada={(nueva) => {
                setBorradores((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== c)));
                onGuardada?.(nueva);
              }}
            />
          ) : (
            <VarianteLectura servicio={servicio} clave={c} renglones={renglonesDe(receta, c)} />
          )}
        </div>
      ))}
    </section>
  );
}

function ayudaVariante(servicio: Servicio, clave: Clave): string {
  if (clave === 'general') {
    return servicio.vehiculos.length > 1
      ? 'Se usa para cualquier vehículo que no tenga una receta propia.'
      : 'Se usa en cada lavado de este servicio.';
  }
  return `Si queda vacía, para ${NOMBRE_VEHICULO[clave]} se usa la general.`;
}

function VarianteLectura({ servicio, clave, renglones }: { servicio: Servicio; clave: Clave; renglones: RenglonReceta[] }) {
  if (!renglones.length) {
    return <p className="receta-vacia">{clave === 'general' ? 'Todavía no tiene receta general.' : `Usa la general: ${NOMBRE_VEHICULO[clave]} no tiene receta propia.`}</p>;
  }
  return (
    <>
      <ul className="receta-lista">
        {renglones.map((r) => (
          <li key={r.insumoId}>
            <span>{r.nombre}</span>
            <strong>{cantidadConUnidad(r.cantidad, r.unidad)}</strong>
          </li>
        ))}
      </ul>
      <p className="nota-chica">{ayudaVariante(servicio, clave)}</p>
    </>
  );
}

function VarianteEditable({
  servicio,
  clave,
  renglones,
  insumos,
  errorInsumos,
  pendiente,
  onCambio,
  onGuardada,
}: {
  servicio: Servicio;
  clave: Clave;
  renglones: Renglon[];
  insumos: Insumo[] | null;
  errorInsumos: string | null;
  pendiente: boolean;
  onCambio: (r: Renglon[]) => void;
  onGuardada: (r: Receta) => void;
}) {
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardada, setGuardada] = useState(false);
  const listaId = useId();
  const nombre = clave === 'general' ? 'la receta general' : `la receta de ${NOMBRE_VEHICULO[clave]}`;

  const cambiar = (i: number, cambio: Partial<Renglon>) => {
    setGuardada(false);
    onCambio(renglones.map((r, j) => (j === i ? { ...r, ...cambio } : r)));
  };

  const elegirInsumo = (i: number, texto: string) => {
    const buscado = paraBuscar(texto);
    const encontrado = insumos?.find((x) => paraBuscar(x.nombre) === buscado);
    const previo = renglones[i];
    // Un insumo que ya estaba (aunque hoy esté inactivo y no venga en la lista) conserva su id si no se tocó el nombre.
    const mismo = !!previo?.insumoId && paraBuscar(previo.texto) === buscado && !encontrado;
    cambiar(i, {
      texto,
      insumoId: encontrado?.id ?? (mismo ? previo.insumoId : null),
      unidad: encontrado?.unidad ?? (mismo ? previo.unidad : null),
    });
  };

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const locales: Record<string, string> = {};
    const enviados: number[] = [];
    const items: { insumoId: string; cantidad: number }[] = [];
    const vistos = new Set<string>();
    renglones.forEach((r, i) => {
      if (!r.texto.trim() && !r.cantidad.trim()) return;
      if (!r.insumoId) locales[`${String(i)}.insumo`] = r.texto.trim() ? 'Elegí un insumo de la lista.' : 'Elegí qué insumo se usa.';
      else if (vistos.has(r.insumoId)) locales[`${String(i)}.insumo`] = 'Ese insumo ya está más arriba: sumá la cantidad ahí.';
      const n = decimalDesdeTexto(r.cantidad);
      if (Number.isNaN(n) || n <= 0) locales[`${String(i)}.cantidad`] = 'Escribí cuánto se usa, por ejemplo 50 o 0,5.';
      else if (n > MAX_CANTIDAD_RECETA) locales[`${String(i)}.cantidad`] = 'Tiene que ser como mucho 99.999.';
      else if (Math.round(n * 100) !== n * 100) locales[`${String(i)}.cantidad`] = 'Usá hasta 2 decimales.';
      if (r.insumoId) vistos.add(r.insumoId);
      if (r.insumoId && !Number.isNaN(n)) {
        enviados.push(i);
        items.push({ insumoId: r.insumoId, cantidad: n });
      }
    });
    setErrores(locales);
    setError(null);
    setGuardada(false);
    if (Object.keys(locales).length) return;
    setGuardando(true);
    try {
      const { receta } = await ep.guardarReceta(servicio.id, { vehiculo: clave === 'general' ? null : clave, items });
      setGuardando(false);
      setGuardada(true);
      onGuardada(receta);
    } catch (err) {
      // El backend numera los renglones que recibió (items.N.campo): se pasan al renglón de la pantalla. Lo que no es
      // de un renglón (el vehículo, la lista entera) va arriba, en lugar del mensaje general.
      const deRenglon: Record<string, string> = {};
      const sueltos: string[] = [];
      if (err instanceof ApiError && err.fields) {
        for (const [k, v] of Object.entries(err.fields)) {
          const m = /^items\.(\d+)\.(insumoId|cantidad)$/.exec(k);
          const fila = m ? enviados[Number(m[1])] : undefined;
          if (m && fila !== undefined) deRenglon[`${String(fila)}.${m[2] === 'insumoId' ? 'insumo' : 'cantidad'}`] = v;
          else sueltos.push(v);
        }
      }
      setErrores(deRenglon);
      setError(sueltos.length ? sueltos.join(' ') : Object.keys(deRenglon).length ? null : mensajeDeError(err));
      setGuardando(false);
    }
  };

  const llenos = renglones.filter((r) => r.texto.trim() || r.cantidad.trim()).length;
  return (
    <form className="formulario receta-form" onSubmit={(e) => void guardar(e)} noValidate>
      <p className="nota-chica">{ayudaVariante(servicio, clave)}</p>
      {errorInsumos ? <Aviso titulo="No pudimos cargar los insumos">{errorInsumos} Igual podés quitar renglones y guardar.</Aviso> : null}
      {error ? <Aviso>{error}</Aviso> : null}
      {renglones.length === 0 ? (
        <p className="receta-vacia">{clave === 'general' ? 'Sin insumos todavía.' : `Sin receta propia: ${NOMBRE_VEHICULO[clave]} usa la general.`}</p>
      ) : (
        <ol className="receta-renglones">
          {renglones.map((r, i) => {
            const unidad = r.unidad ? NOMBRE_UNIDAD[r.unidad][1] : null;
            const n = i + 1;
            return (
              <li key={r.llave} className="receta-renglon">
                <Campo
                  className="receta-insumo"
                  etiqueta={`Insumo ${String(n)}`}
                  list={listaId}
                  autoComplete="off"
                  enterKeyHint="next"
                  placeholder="Buscá por nombre"
                  value={r.texto}
                  maxLength={80}
                  onChange={(e) => { elegirInsumo(i, e.target.value); }}
                  error={errores[`${String(i)}.insumo`]}
                />
                <Campo
                  className="receta-cantidad"
                  etiqueta={unidad ? `Cantidad (${unidad})` : 'Cantidad'}
                  inputMode="decimal"
                  value={r.cantidad}
                  onChange={(e) => { cambiar(i, { cantidad: e.target.value }); }}
                  error={errores[`${String(i)}.cantidad`]}
                />
                <Boton
                  chico
                  variante="fantasma"
                  className="receta-quitar"
                  aria-label={r.texto.trim() ? `Quitar ${r.texto.trim()}` : `Quitar insumo ${String(n)}`}
                  icono={<X aria-hidden size={20} />}
                  onClick={() => {
                    setErrores({});
                    setGuardada(false);
                    onCambio(renglones.filter((_, j) => j !== i));
                  }}
                />
              </li>
            );
          })}
        </ol>
      )}
      <datalist id={listaId}>
        {(insumos ?? []).map((x) => (
          <option key={x.id} value={x.nombre} label={x.categoria ? `${x.categoria} · ${NOMBRE_UNIDAD[x.unidad][1]}` : NOMBRE_UNIDAD[x.unidad][1]} />
        ))}
      </datalist>
      {renglones.length < MAX_RENGLONES_RECETA ? (
        <Boton
          chico
          variante="fantasma"
          className="receta-agregar"
          icono={<Plus aria-hidden size={18} />}
          onClick={() => {
            setGuardada(false);
            onCambio([...renglones, renglonVacio()]);
          }}
        >
          Agregar insumo
        </Boton>
      ) : (
        <p className="nota-chica">Llegaste al máximo de {MAX_RENGLONES_RECETA} insumos.</p>
      )}
      <div className="receta-guardar">
        <p className={guardada ? 'nota-ok' : 'nota-chica'} role="status">
          {guardada ? 'Receta guardada.' : pendiente ? 'Hay cambios sin guardar.' : ''}
        </p>
        <Boton type="submit" variante="primario" cargando={guardando}>
          {llenos === 0 && pendiente ? `Borrar ${nombre}` : `Guardar ${nombre}`}
        </Boton>
      </div>
    </form>
  );
}
