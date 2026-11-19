import { ChevronDown, Plus, X } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../../api/client';
import * as ep from '../../api/endpoints';
import { guardarReceta, MAX_RENGLONES_RECETA, receta, type InsumoDeReceta, type Receta, type RenglonReceta } from '../../api/recetas';
import type { Insumo, Servicio, VehiculoTipo } from '../../api/types';
import { Aviso, Boton, Campo, Cargando, Selector, Vacio } from '../../components/ui';
import { decimalDesdeTexto, NOMBRE_VEHICULO, numero } from '../../lib/format';
import { useCarga } from '../../lib/useCarga';
import { cantidad, NOMBRE_UNIDAD } from './unidades';

/**
 * Qué insumos usa cada servicio. Con esto, al registrar un lavado o completar un turno el stock se descuenta solo
 * (y se devuelve si se deshace). Todos lo ven; lo cambia quien gestiona el inventario.
 */
export function Recetas({ insumos, gestiona }: { insumos: Insumo[]; gestiona: boolean }) {
  const [catalogo, recargar] = useCarga(() => ep.servicios().then((r) => r.servicios.filter((s) => s.activo)), []);
  return (
    <section className="hoja bloque recetas" aria-labelledby="recetas-titulo">
      <h2 id="recetas-titulo" className="bloque-titulo">
        Qué usa cada servicio
      </h2>
      <p className="nota-chica">
        Al registrar un lavado se descuenta solo lo que usa cada servicio. Si no alcanza, se descuenta lo que hay: nunca frena el
        lavado.
      </p>
      {catalogo.estado === 'error' ? (
        <Aviso titulo="No pudimos cargar los servicios" accion={<Boton onClick={recargar}>Reintentar</Boton>}>
          {catalogo.mensaje}
        </Aviso>
      ) : null}
      {!catalogo.datos ? (
        catalogo.estado === 'cargando' ? <Cargando texto="Cargando los servicios…" /> : null
      ) : (
        <ul className="lista-simple">
          {catalogo.datos.map((s) => (
            <ServicioReceta key={s.id} servicio={s} insumos={insumos} gestiona={gestiona} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ServicioReceta({ servicio, insumos, gestiona }: { servicio: Servicio; insumos: Insumo[]; gestiona: boolean }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <li className="fila-simple receta">
      <button
        type="button"
        className="receta-cabeza"
        aria-expanded={abierto}
        onClick={() => {
          setAbierto(!abierto);
        }}
      >
        <span className="fila-simple-titulo">{servicio.nombre}</span>
        <ChevronDown aria-hidden size={20} className="receta-flecha" />
      </button>
      {abierto ? <DetalleReceta servicio={servicio} insumos={insumos} gestiona={gestiona} /> : null}
    </li>
  );
}

function porVehiculo(i: InsumoDeReceta, vehiculos: VehiculoTipo[]): string {
  const extra: string[] = [];
  const otros: [VehiculoTipo, number | null][] = [
    ['suv', i.cantidadSuv],
    ['pickup', i.cantidadPickup],
    ['moto', i.cantidadMoto],
  ];
  for (const [v, c] of otros) {
    if (c !== null && vehiculos.includes(v)) extra.push(`${NOMBRE_VEHICULO[v]} ${numero(c)}`);
  }
  return extra.length ? ` (${extra.join(', ')})` : '';
}

function DetalleReceta({ servicio, insumos, gestiona }: { servicio: Servicio; insumos: Insumo[]; gestiona: boolean }) {
  const [carga, recargar, actualizar] = useCarga(() => receta(servicio.id), [servicio.id]);
  const [editando, setEditando] = useState(false);
  const [guardada, setGuardada] = useState(false);

  if (carga.estado === 'error' && !carga.datos) {
    return (
      <Aviso titulo="No pudimos cargar lo que usa" accion={<Boton chico onClick={recargar}>Reintentar</Boton>}>
        {carga.mensaje}
      </Aviso>
    );
  }
  if (!carga.datos) return <Cargando />;
  const r = carga.datos;

  if (editando) {
    return (
      <EditarReceta
        servicio={servicio}
        actual={r}
        insumos={insumos}
        onCancelar={() => { setEditando(false); }}
        onListo={(nueva) => {
          actualizar(() => nueva);
          setEditando(false);
          setGuardada(true);
        }}
      />
    );
  }

  return (
    <div className="receta-cuerpo">
      {guardada ? <p className="nota-ok" role="status">Guardado: desde ahora se descuenta solo.</p> : null}
      {r.insumos.length === 0 ? (
        <Vacio titulo="No descuenta ningún insumo">{gestiona ? 'Agregá lo que se usa en cada lavado de este servicio.' : null}</Vacio>
      ) : (
        <ul className="receta-insumos">
          {r.insumos.map((i) => (
            <li key={i.insumoId}>
              <strong>{i.nombre}</strong>: {cantidad(i.cantidad, i.unidad)} por {servicio.vehiculos.includes('auto') ? 'auto' : 'lavado'}
              {porVehiculo(i, servicio.vehiculos)}
              {i.bajoStock ? <span className="etiqueta etiqueta-alerta">Queda poco</span> : null}
            </li>
          ))}
        </ul>
      )}
      {gestiona ? (
        <Boton chico variante="secundario" onClick={() => { setGuardada(false); setEditando(true); }}>
          {r.insumos.length ? 'Cambiar lo que usa' : 'Agregar insumos'}
        </Boton>
      ) : null}
    </div>
  );
}

interface Renglon {
  clave: number;
  insumoId: string;
  cantidad: string;
  suv: string;
  pickup: string;
  moto: string;
}

const textoDe = (n: number | null) => (n === null ? '' : numero(n));

function EditarReceta({
  servicio,
  actual,
  insumos,
  onListo,
  onCancelar,
}: {
  servicio: Servicio;
  actual: Receta;
  insumos: Insumo[];
  onListo: (r: Receta) => void;
  onCancelar: () => void;
}) {
  const activos = insumos.filter((i) => i.activo);
  const [renglones, setRenglones] = useState<Renglon[]>(() =>
    actual.insumos.map((i, n) => ({
      clave: n,
      insumoId: i.insumoId,
      cantidad: numero(i.cantidad),
      suv: textoDe(i.cantidadSuv),
      pickup: textoDe(i.cantidadPickup),
      moto: textoDe(i.cantidadMoto),
    })),
  );
  const [siguiente, setSiguiente] = useState(actual.insumos.length);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const otrosVehiculos = (['suv', 'pickup', 'moto'] as const).filter((v) => servicio.vehiculos.includes(v));

  const cambiar = (clave: number, cambio: Partial<Renglon>) => {
    setRenglones((rs) => rs.map((r) => (r.clave === clave ? { ...r, ...cambio } : r)));
  };

  const agregar = () => {
    const libre = activos.find((i) => !renglones.some((r) => r.insumoId === i.id));
    setRenglones([...renglones, { clave: siguiente, insumoId: libre?.id ?? '', cantidad: '', suv: '', pickup: '', moto: '' }]);
    setSiguiente(siguiente + 1);
  };

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const locales: Record<string, string> = {};
    const cuerpo: RenglonReceta[] = [];
    const vistos = new Set<string>();
    for (const r of renglones) {
      if (!r.insumoId) {
        locales[`${String(r.clave)}.insumo`] = 'Elegí un insumo.';
        continue;
      }
      if (vistos.has(r.insumoId)) locales[`${String(r.clave)}.insumo`] = 'Este insumo ya está en la lista.';
      vistos.add(r.insumoId);
      const c = decimalDesdeTexto(r.cantidad);
      if (Number.isNaN(c) || c <= 0) locales[`${String(r.clave)}.cantidad`] = 'Escribí cuánto se usa, por ejemplo 0,25.';
      const extra = (texto: string, campo: string): number | null => {
        if (!texto.trim()) return null;
        const n = decimalDesdeTexto(texto);
        if (Number.isNaN(n) || n <= 0) locales[`${String(r.clave)}.${campo}`] = 'Un número mayor a 0, o vacío.';
        return n;
      };
      cuerpo.push({
        insumoId: r.insumoId,
        cantidad: c,
        cantidadSuv: extra(r.suv, 'suv'),
        cantidadPickup: extra(r.pickup, 'pickup'),
        cantidadMoto: extra(r.moto, 'moto'),
      });
    }
    setErrores(locales);
    if (Object.keys(locales).length) return;
    setGuardando(true);
    setError(null);
    try {
      onListo(await guardarReceta(servicio.id, cuerpo));
    } catch (err) {
      if (err instanceof ApiError && err.fields?.insumos) setError(err.fields.insumos);
      else setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="formulario receta-editor" onSubmit={(e) => void guardar(e)} noValidate aria-label={`Lo que usa ${servicio.nombre}`}>
      {error ? <Aviso>{error}</Aviso> : null}
      {activos.length === 0 ? <Aviso tipo="info">Primero cargá los insumos del inventario.</Aviso> : null}
      {renglones.length === 0 ? <p className="nota-chica">No descuenta nada. Agregá un insumo.</p> : null}
      {renglones.map((r, n) => {
        const ins = activos.find((i) => i.id === r.insumoId);
        const unidad = ins ? NOMBRE_UNIDAD[ins.unidad][1] : '';
        return (
          <fieldset key={r.clave} className="receta-renglon">
            <legend className="solo-lectores">Insumo {n + 1}</legend>
            <Selector
              etiqueta="Insumo"
              value={r.insumoId}
              onChange={(e) => {
                cambiar(r.clave, { insumoId: e.target.value });
              }}
              error={errores[`${String(r.clave)}.insumo`]}
            >
              <option value="">Elegí…</option>
              {activos.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre}
                </option>
              ))}
            </Selector>
            <Campo
              etiqueta={`Cuánto por ${servicio.vehiculos.includes('auto') ? 'auto' : 'lavado'}${unidad ? ` (${unidad})` : ''}`}
              inputMode="decimal"
              value={r.cantidad}
              onChange={(e) => {
                cambiar(r.clave, { cantidad: e.target.value });
              }}
              error={errores[`${String(r.clave)}.cantidad`]}
            />
            {otrosVehiculos.length ? (
              <details className="plegable receta-vehiculos" open={Boolean(r.suv || r.pickup || r.moto)}>
                <summary>
                  <span>Distinto según el vehículo</span>
                  <ChevronDown aria-hidden size={20} className="plegable-flecha" />
                </summary>
                <div className="plegable-cuerpo">
                  <p className="nota-chica">Vacío = lo mismo que {servicio.vehiculos.includes('auto') ? 'un auto' : 'arriba'}.</p>
                  <div className="fila-campos">
                    {otrosVehiculos.map((v) => (
                      <Campo
                        key={v}
                        etiqueta={NOMBRE_VEHICULO[v]}
                        inputMode="decimal"
                        value={r[v]}
                        onChange={(e) => {
                          cambiar(r.clave, { [v]: e.target.value });
                        }}
                        error={errores[`${String(r.clave)}.${v}`]}
                      />
                    ))}
                  </div>
                </div>
              </details>
            ) : null}
            <Boton
              chico
              variante="fantasma"
              className="btn-texto-peligro receta-quitar"
              icono={<X aria-hidden size={16} />}
              onClick={() => {
                setRenglones(renglones.filter((x) => x.clave !== r.clave));
              }}
            >
              Sacar{ins ? ` ${ins.nombre}` : ''}
            </Boton>
          </fieldset>
        );
      })}
      <div className="fila-botones">
        {renglones.length < MAX_RENGLONES_RECETA && activos.length ? (
          <Boton chico variante="secundario" icono={<Plus aria-hidden size={16} />} onClick={agregar} className="receta-agregar">
            Agregar insumo
          </Boton>
        ) : null}
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>
          Guardar
        </Boton>
      </div>
    </form>
  );
}
