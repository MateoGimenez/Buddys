import { Plus } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../api/client';
import * as ep from '../api/endpoints';
import { UNIDADES, type Insumo, type MovimientoNuevo, type Unidad } from '../api/types';
import { Aviso, Boton, Campo, Cargando, Encabezado, Selector, Vacio } from '../components/ui';
import { decimalDesdeTexto, enteroDesdeTexto, miles, numero, pesos } from '../lib/format';
import { useCarga } from '../lib/useCarga';
import { useSesion } from '../session/SessionContext';

const NOMBRE_UNIDAD: Record<Unidad, [string, string]> = {
  unidad: ['unidad', 'unidades'],
  litro: ['litro', 'litros'],
  ml: ['ml', 'ml'],
  kg: ['kg', 'kg'],
  g: ['g', 'g'],
  par: ['par', 'pares'],
  caja: ['caja', 'cajas'],
};

function cantidad(n: number, u: Unidad): string {
  return `${numero(n)} ${NOMBRE_UNIDAD[u][n === 1 ? 0 : 1]}`;
}

export function Insumos() {
  const { puede } = useSesion();
  const gestiona = puede('inventario.gestionar');
  const [carga, recargar, actualizar] = useCarga(() => ep.insumos(), []);
  const [creando, setCreando] = useState(false);

  return (
    <>
      <Encabezado titulo="Insumos">
        {gestiona && !creando ? (
          <Boton variante="primario" chico icono={<Plus aria-hidden size={18} />} onClick={() => { setCreando(true); }}>
            Nuevo insumo
          </Boton>
        ) : null}
      </Encabezado>
      {creando ? <NuevoInsumo onListo={() => { setCreando(false); recargar(); }} onCancelar={() => { setCreando(false); }} /> : null}

      {carga.estado === 'error' ? <Aviso titulo="No pudimos cargar los insumos" accion={<Boton onClick={recargar}>Reintentar</Boton>}>{carga.mensaje}</Aviso> : null}
      {!carga.datos ? (carga.estado === 'cargando' ? <Cargando /> : null) : (
        <>
          {carga.datos.bajoStock > 0 ? (
            <Aviso tipo="error" titulo={`${carga.datos.bajoStock} ${carga.datos.bajoStock === 1 ? 'insumo está' : 'insumos están'} por acabarse`}>
              Están primeros en la lista.
            </Aviso>
          ) : null}
          {gestiona && carga.datos.valorTotal !== null ? (
            <p className="total-linea"><span>Valor en stock</span><strong>{pesos(carga.datos.valorTotal)}</strong></p>
          ) : null}
          {carga.datos.insumos.length === 0 ? (
            <Vacio titulo="Todavía no hay insumos">{gestiona ? 'Cargá shampoo, ceras, paños… y anotá lo que se usa.' : 'Un encargado tiene que cargarlos primero.'}</Vacio>
          ) : (
            <ul className="lista-hojas">
              {carga.datos.insumos.map((i) => (
                <FilaInsumo
                  key={i.id}
                  insumo={i}
                  gestiona={gestiona}
                  onCambio={(nuevo) => {
                    actualizar((d) => ({ ...d, insumos: d.insumos.map((x) => (x.id === nuevo.id ? nuevo : x)) }));
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

type Accion = 'uso' | 'compra' | 'ajuste';

function FilaInsumo({ insumo, gestiona, onCambio }: { insumo: Insumo; gestiona: boolean; onCambio: (i: Insumo) => void }) {
  const [accion, setAccion] = useState<Accion | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  return (
    <li className="hoja fila-hoja" data-alerta={insumo.bajoStock ? '' : undefined}>
      <div className="fila-hoja-cabeza">
        <h2 className="fila-hoja-titulo">{insumo.nombre}</h2>
        {insumo.bajoStock ? <span className="etiqueta etiqueta-alerta">Queda poco</span> : null}
      </div>
      <p className="stock">
        <strong>{cantidad(insumo.stock, insumo.unidad)}</strong>
        {insumo.stockMinimo > 0 ? <span> · mínimo {numero(insumo.stockMinimo)}</span> : null}
        {insumo.categoria ? <span> · {insumo.categoria}</span> : null}
      </p>
      {hecho ? <p className="nota-ok" role="status">{hecho}</p> : null}
      {accion ? (
        <Movimiento
          insumo={insumo}
          accion={accion}
          onListo={(i, texto) => { setAccion(null); setHecho(texto); onCambio(i); }}
          onCancelar={() => { setAccion(null); }}
        />
      ) : (
        <div className="copia-acciones">
          <Boton chico variante="secundario" onClick={() => { setAccion('uso'); setHecho(null); }}>Anotar uso</Boton>
          {gestiona ? (
            <>
              <Boton chico variante="fantasma" onClick={() => { setAccion('compra'); setHecho(null); }}>Compra</Boton>
              <Boton chico variante="fantasma" onClick={() => { setAccion('ajuste'); setHecho(null); }}>Contar stock</Boton>
            </>
          ) : null}
        </div>
      )}
    </li>
  );
}

const TITULO_ACCION: Record<Accion, string> = { uso: 'Cuánto se usó', compra: 'Cuánto se compró', ajuste: 'Cuánto hay contado' };

function Movimiento({ insumo, accion, onListo, onCancelar }: { insumo: Insumo; accion: Accion; onListo: (i: Insumo, texto: string) => void; onCancelar: () => void }) {
  const [cant, setCant] = useState('');
  const [costo, setCosto] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const n = decimalDesdeTexto(cant);
    const campo = accion === 'ajuste' ? 'stockReal' : 'cantidad';
    if (Number.isNaN(n) || (accion !== 'ajuste' && n <= 0)) {
      setErrores({ [campo]: 'Escribí un número, por ejemplo 1,5.' });
      return;
    }
    let mov: MovimientoNuevo;
    if (accion === 'uso') mov = { tipo: 'uso', cantidad: n };
    else if (accion === 'ajuste') mov = { tipo: 'ajuste', stockReal: n };
    else {
      const c = enteroDesdeTexto(costo);
      mov = { tipo: 'compra', cantidad: n, ...(c ? { costoTotal: c } : {}), ...(proveedor.trim() ? { proveedor: proveedor.trim() } : {}) };
    }
    setGuardando(true);
    setError(null);
    setErrores({});
    try {
      const { insumo: nuevo } = await ep.moverInsumo(insumo.id, mov);
      const texto =
        accion === 'uso' ? `Anotado: se usaron ${cantidad(n, insumo.unidad)}.` : accion === 'compra' ? `Compra anotada: +${cantidad(n, insumo.unidad)}.` : 'Stock actualizado.';
      onListo(nuevo, texto);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  const campo = accion === 'ajuste' ? 'stockReal' : 'cantidad';
  return (
    <form className="formulario" onSubmit={(e) => void guardar(e)} noValidate>
      {error && !errores[campo] ? <Aviso>{error}</Aviso> : null}
      <Campo
        etiqueta={`${TITULO_ACCION[accion]} (${NOMBRE_UNIDAD[insumo.unidad][1]})`}
        inputMode="decimal"
        autoFocus
        value={cant}
        onChange={(e) => { setCant(e.target.value); }}
        error={errores[campo]}
      />
      {accion === 'compra' ? (
        <div className="fila-campos">
          <Campo etiqueta="Costo total (opcional)" prefijo="$" inputMode="numeric" value={costo} onChange={(e) => { setCosto(miles(e.target.value)); }} error={errores.costoTotal} ayuda="Si lo cargás, queda como gasto de insumos." />
          <Campo etiqueta="Proveedor (opcional)" value={proveedor} maxLength={80} onChange={(e) => { setProveedor(e.target.value); }} error={errores.proveedor} />
        </div>
      ) : null}
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>Guardar</Boton>
      </div>
    </form>
  );
}

function NuevoInsumo({ onListo, onCancelar }: { onListo: () => void; onCancelar: () => void }) {
  const [nombre, setNombre] = useState('');
  const [unidad, setUnidad] = useState<Unidad>('litro');
  const [stock, setStock] = useState('');
  const [minimo, setMinimo] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const locales: Record<string, string> = {};
    if (!nombre.trim()) locales.nombre = 'Poné el nombre del insumo.';
    const s = stock.trim() ? decimalDesdeTexto(stock) : 0;
    const m = minimo.trim() ? decimalDesdeTexto(minimo) : 0;
    if (Number.isNaN(s)) locales.stockInicial = 'Escribí un número, por ejemplo 5 o 2,5.';
    if (Number.isNaN(m)) locales.stockMinimo = 'Escribí un número, por ejemplo 1.';
    setErrores(locales);
    if (Object.keys(locales).length) return;
    setGuardando(true);
    setError(null);
    try {
      await ep.crearInsumo({ nombre: nombre.trim(), unidad, ...(s ? { stockInicial: s } : {}), ...(m ? { stockMinimo: m } : {}) });
      onListo();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="hoja formulario" onSubmit={(e) => void guardar(e)} noValidate>
      <h2 className="bloque-titulo">Nuevo insumo</h2>
      {error ? <Aviso>{error}</Aviso> : null}
      <Campo etiqueta="Nombre" value={nombre} maxLength={80} onChange={(e) => { setNombre(e.target.value); }} error={errores.nombre} />
      <Selector etiqueta="Se mide en" value={unidad} onChange={(e) => { setUnidad(e.target.value as Unidad); }} error={errores.unidad}>
        {UNIDADES.map((u) => (
          <option key={u} value={u}>{NOMBRE_UNIDAD[u][1]}</option>
        ))}
      </Selector>
      <div className="fila-campos">
        <Campo etiqueta="Cuánto hay hoy" inputMode="decimal" value={stock} onChange={(e) => { setStock(e.target.value); }} error={errores.stockInicial} />
        <Campo etiqueta="Avisar cuando quede" inputMode="decimal" value={minimo} onChange={(e) => { setMinimo(e.target.value); }} error={errores.stockMinimo} />
      </div>
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>Crear insumo</Boton>
      </div>
    </form>
  );
}
