import { Pencil, Plus } from 'lucide-react';
import { useId, useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../api/client';
import * as ep from '../api/endpoints';
import { VEHICULOS, type Servicio, type VehiculoTipo } from '../api/types';
import { AreaTexto, Aviso, Boton, Campo, Cargando, Encabezado, Vacio } from '../components/ui';
import {
  CAMPO_PRECIO,
  CATEGORIAS_SERVICIO,
  NOMBRE_VEHICULO,
  duracionPara,
  enteroDesdeTexto,
  miles,
  pesos,
  porCategoria,
  precioPara,
  slug,
} from '../lib/format';
import { useCarga } from '../lib/useCarga';
import { useSesion } from '../session/SessionContext';

export function Servicios() {
  const { puede } = useSesion();
  const edita = puede('catalogo.editar');
  const [carga, recargar, actualizar] = useCarga(() => ep.servicios().then((r) => r.servicios), []);
  const [creando, setCreando] = useState(false);

  const reemplazar = (s: Servicio) => {
    actualizar((lista) => lista.map((x) => (x.id === s.id ? s : x)));
  };
  const categorias = categoriasConocidas(carga.datos ?? []);

  return (
    <>
      <Encabezado titulo="Servicios">
        {edita && !creando ? (
          <Boton variante="primario" chico icono={<Plus aria-hidden size={18} />} onClick={() => { setCreando(true); }}>
            Nuevo servicio
          </Boton>
        ) : null}
      </Encabezado>
      {!edita ? <p className="nota-chica">Solo lectura: los servicios los cambia un encargado.</p> : null}

      {creando ? (
        <NuevoServicio
          categorias={categorias}
          onListo={() => { setCreando(false); recargar(); }}
          onCancelar={() => { setCreando(false); }}
        />
      ) : null}

      {carga.estado === 'error' ? (
        <Aviso titulo="No pudimos cargar los servicios" accion={<Boton onClick={recargar}>Reintentar</Boton>}>{carga.mensaje}</Aviso>
      ) : null}
      {!carga.datos ? (carga.estado === 'cargando' ? <Cargando /> : null) : carga.datos.length === 0 ? (
        <Vacio titulo="Todavía no hay servicios">{edita ? 'Creá el primero con “Nuevo servicio”.' : ''}</Vacio>
      ) : (
        porCategoria(carga.datos).map((g) => (
          <section key={g.categoria} className="categoria" aria-labelledby={`cat-${slug(g.categoria)}`}>
            <h2 id={`cat-${slug(g.categoria)}`} className="categoria-titulo">
              {g.categoria}
              <span className="categoria-cuenta">{g.items.length}</span>
            </h2>
            <ul className="lista-hojas">
              {g.items.map((s) => (
                <FilaServicio key={s.id} servicio={s} edita={edita} categorias={categorias} onCambio={reemplazar} />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

/** Las categorías de siempre más las que ya tenga el catálogo, para sugerirlas al escribir. */
function categoriasConocidas(servicios: Servicio[]): string[] {
  const extra = servicios.map((s) => s.categoria?.trim()).filter((c): c is string => !!c);
  return [...new Set([...CATEGORIAS_SERVICIO, ...extra])];
}

function FilaServicio({ servicio, edita, categorias, onCambio }: { servicio: Servicio; edita: boolean; categorias: string[]; onCambio: (s: Servicio) => void }) {
  const [editando, setEditando] = useState(false);
  return (
    <li className="hoja fila-hoja" data-inactivo={servicio.activo ? undefined : ''}>
      <div className="fila-hoja-cabeza">
        <h3 className="fila-hoja-titulo">{servicio.nombre}</h3>
        {servicio.destacado ? <span className="etiqueta">Frecuente</span> : null}
        {!servicio.activo ? <span className="etiqueta etiqueta-apagada">Inactivo</span> : null}
      </div>
      <p className="fila-hoja-texto">{servicio.resumen}</p>
      {editando ? (
        <EditarServicio
          servicio={servicio}
          categorias={categorias}
          onListo={(s) => { setEditando(false); onCambio(s); }}
          onCancelar={() => { setEditando(false); }}
        />
      ) : (
        <>
          <dl className="precios">
            {VEHICULOS.map((v) => {
              const ofrece = servicio.vehiculos.includes(v);
              const precio = precioPara(servicio, v);
              const duracion = duracionPara(servicio, v);
              return (
                <div key={v} data-no-ofrece={ofrece ? undefined : ''}>
                  <dt>{NOMBRE_VEHICULO[v]}</dt>
                  <dd>{!ofrece ? 'No se ofrece' : !edita ? 'Se ofrece' : precio === null ? 'Consultá' : pesos(precio)}</dd>
                  {ofrece && duracion ? <dd className="precios-duracion">{duracion}</dd> : null}
                </div>
              );
            })}
          </dl>
          {edita ? (
            <Boton chico variante="fantasma" icono={<Pencil aria-hidden size={18} />} onClick={() => { setEditando(true); }}>
              Editar
            </Boton>
          ) : null}
        </>
      )}
    </li>
  );
}

function textoPrecio(n: number | null): string {
  return n === null ? '' : miles(String(n));
}

function CampoCategoria({ valor, onCambio, categorias, error }: { valor: string; onCambio: (v: string) => void; categorias: string[]; error?: string | undefined }) {
  const listaId = useId();
  return (
    <>
      <Campo
        etiqueta="Categoría"
        list={listaId}
        autoComplete="off"
        maxLength={40}
        value={valor}
        onChange={(e) => { onCambio(e.target.value); }}
        error={error}
        ayuda="Agrupa los servicios en Registrar. Vacía = “Otros”."
      />
      <datalist id={listaId}>
        {categorias.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}

function EditarServicio({ servicio, categorias, onListo, onCancelar }: { servicio: Servicio; categorias: string[]; onListo: (s: Servicio) => void; onCancelar: () => void }) {
  const [precios, setPrecios] = useState<Record<VehiculoTipo, string>>(() => ({
    auto: textoPrecio(servicio.precioDesde),
    suv: textoPrecio(servicio.precioDesdeSuv),
    pickup: textoPrecio(servicio.precioDesdePickup),
    moto: textoPrecio(servicio.precioDesdeMoto),
  }));
  const [categoria, setCategoria] = useState(servicio.categoria ?? '');
  const [vehiculos, setVehiculos] = useState<VehiculoTipo[]>(servicio.vehiculos);
  const [activo, setActivo] = useState(servicio.activo);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const vehId = useId();

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!vehiculos.length) {
      setErrores({ vehiculos: 'Elegí al menos un vehículo.' });
      return;
    }
    setGuardando(true);
    setError(null);
    setErrores({});
    try {
      const { servicio: s } = await ep.editarServicio(servicio.id, {
        precioDesde: enteroDesdeTexto(precios.auto),
        precioDesdeSuv: enteroDesdeTexto(precios.suv),
        precioDesdePickup: enteroDesdeTexto(precios.pickup),
        precioDesdeMoto: enteroDesdeTexto(precios.moto),
        categoria: categoria.trim() || null,
        vehiculos: VEHICULOS.filter((v) => vehiculos.includes(v)),
        activo,
      });
      onListo(s);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="formulario" onSubmit={(e) => void guardar(e)} noValidate>
      {error ? <Aviso>{error}</Aviso> : null}
      <CampoCategoria valor={categoria} onCambio={setCategoria} categorias={categorias} error={errores.categoria} />
      <fieldset className="grupo-checks" aria-describedby={errores.vehiculos ? vehId : undefined}>
        <legend>Se ofrece para</legend>
        {VEHICULOS.map((v) => (
          <label key={v} className="check">
            <input
              type="checkbox"
              checked={vehiculos.includes(v)}
              onChange={(e) => {
                setVehiculos((prev) => (e.target.checked ? [...prev, v] : prev.filter((x) => x !== v)));
              }}
            />
            {NOMBRE_VEHICULO[v]}
          </label>
        ))}
        {errores.vehiculos ? <p className="campo-error" id={vehId}>{errores.vehiculos}</p> : null}
      </fieldset>
      <div className="fila-campos">
        {VEHICULOS.filter((v) => vehiculos.includes(v)).map((v) => (
          <Campo
            key={v}
            etiqueta={`Precio ${NOMBRE_VEHICULO[v]}`}
            prefijo="$"
            inputMode="numeric"
            value={precios[v]}
            onChange={(e) => { setPrecios((p) => ({ ...p, [v]: miles(e.target.value) })); }}
            error={errores[CAMPO_PRECIO[v]]}
            ayuda="Vacío = Consultá."
          />
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={activo} onChange={(e) => { setActivo(e.target.checked); }} />
        Activo (aparece para registrar lavados)
      </label>
      {errores.activo || errores.destacado ? <p className="campo-error">{errores.activo ?? errores.destacado}</p> : null}
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>Guardar</Boton>
      </div>
    </form>
  );
}

function NuevoServicio({ categorias, onListo, onCancelar }: { categorias: string[]; onListo: () => void; onCancelar: () => void }) {
  const [nombre, setNombre] = useState('');
  const [resumen, setResumen] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [categoria, setCategoria] = useState('');
  const [precio, setPrecio] = useState('');
  const [vehiculos, setVehiculos] = useState<VehiculoTipo[]>([...VEHICULOS]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const locales: Record<string, string> = {};
    if (!nombre.trim()) locales.nombre = 'Poné el nombre del servicio.';
    if (!resumen.trim()) locales.resumen = 'Escribí una línea que diga qué incluye.';
    if (!vehiculos.length) locales.vehiculos = 'Elegí al menos un vehículo.';
    const id = slug(nombre);
    if (nombre.trim() && !id) locales.nombre = 'El nombre tiene que tener letras o números.';
    setErrores(locales);
    if (Object.keys(locales).length) return;
    setGuardando(true);
    setError(null);
    try {
      await ep.crearServicio({
        id,
        nombre: nombre.trim(),
        resumen: resumen.trim(),
        descripcion: descripcion.trim() || resumen.trim(),
        categoria: categoria.trim() || null,
        precioDesde: enteroDesdeTexto(precio),
        vehiculos: VEHICULOS.filter((v) => vehiculos.includes(v)),
      });
      onListo();
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        const f = { ...err.fields };
        if (f.id && !f.nombre) f.nombre = f.id;
        setErrores(f);
      }
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="hoja formulario" onSubmit={(e) => void guardar(e)} noValidate>
      <h2 className="bloque-titulo">Nuevo servicio</h2>
      {error ? <Aviso>{error}</Aviso> : null}
      <Campo etiqueta="Nombre" value={nombre} maxLength={80} onChange={(e) => { setNombre(e.target.value); }} error={errores.nombre} />
      <Campo etiqueta="En una línea, qué incluye" value={resumen} maxLength={200} onChange={(e) => { setResumen(e.target.value); }} error={errores.resumen} />
      <AreaTexto etiqueta="Descripción (opcional)" value={descripcion} maxLength={1500} onChange={(e) => { setDescripcion(e.target.value); }} error={errores.descripcion} />
      <CampoCategoria valor={categoria} onCambio={setCategoria} categorias={categorias} error={errores.categoria} />
      <fieldset className="grupo-checks">
        <legend>Se ofrece para</legend>
        {VEHICULOS.map((v) => (
          <label key={v} className="check">
            <input type="checkbox" checked={vehiculos.includes(v)} onChange={(e) => { setVehiculos((p) => (e.target.checked ? [...p, v] : p.filter((x) => x !== v))); }} />
            {NOMBRE_VEHICULO[v]}
          </label>
        ))}
        {errores.vehiculos ? <p className="campo-error">{errores.vehiculos}</p> : null}
      </fieldset>
      <Campo etiqueta="Precio para auto" prefijo="$" inputMode="numeric" value={precio} onChange={(e) => { setPrecio(miles(e.target.value)); }} error={errores.precioDesde} ayuda="Los de SUV, pick-up y moto se cargan después con “Editar”. Vacío = Consultá." />
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>Crear servicio</Boton>
      </div>
    </form>
  );
}
