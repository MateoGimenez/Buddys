import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../api/client';
import * as ep from '../api/endpoints';
import { CATEGORIAS_GASTO, type CategoriaGasto, type Gasto } from '../api/types';
import { Aviso, Boton, Campo, Cargando, Confirmar, Encabezado, Selector, Vacio } from '../components/ui';
import { diaMes, enteroDesdeTexto, hoy, miles, nombreMes, pesos, primeroDelMes, sumarDias, ultimoDelMes } from '../lib/format';
import { useCarga } from '../lib/useCarga';

const NOMBRE_CATEGORIA: Record<CategoriaGasto, string> = {
  insumos: 'Insumos',
  herramientas: 'Herramientas',
  alquiler: 'Alquiler',
  servicios: 'Servicios (luz, agua, internet)',
  sueldos: 'Sueldos',
  publicidad: 'Publicidad',
  mantenimiento: 'Mantenimiento',
  impuestos: 'Impuestos',
  otros: 'Otros',
};

export function Gastos() {
  const hoyAR = hoy();
  const [mes, setMes] = useState(primeroDelMes(hoyAR));
  const desde = mes;
  const hasta = ultimoDelMes(mes);
  const [carga, recargar] = useCarga(() => ep.gastos(desde, hasta), [desde, hasta]);
  const [creando, setCreando] = useState(false);
  const esMesActual = mes === primeroDelMes(hoyAR);

  return (
    <>
      <Encabezado titulo="Gastos">
        {!creando ? (
          <Boton variante="primario" chico icono={<Plus aria-hidden size={18} />} onClick={() => { setCreando(true); }}>
            Cargar gasto
          </Boton>
        ) : null}
      </Encabezado>

      <div className="navegador-fecha">
        <Boton chico variante="fantasma" aria-label="Mes anterior" icono={<ChevronLeft aria-hidden size={20} />} onClick={() => { setMes(primeroDelMes(sumarDias(mes, -1))); }} />
        <span className="navegador-mes">{nombreMes(mes)}</span>
        <Boton chico variante="fantasma" aria-label="Mes siguiente" icono={<ChevronRight aria-hidden size={20} />} disabled={esMesActual} onClick={() => { setMes(sumarDias(ultimoDelMes(mes), 1)); }} />
      </div>

      {creando ? <NuevoGasto hoyAR={hoyAR} onListo={() => { setCreando(false); recargar(); }} onCancelar={() => { setCreando(false); }} /> : null}

      {carga.estado === 'error' ? <Aviso titulo="No pudimos cargar los gastos" accion={<Boton onClick={recargar}>Reintentar</Boton>}>{carga.mensaje}</Aviso> : null}
      {!carga.datos ? (carga.estado === 'cargando' ? <Cargando /> : null) : (
        <section className="hoja bloque" aria-busy={carga.estado === 'cargando'}>
          <p className="total-linea">
            <span>Total del mes</span>
            <strong>{pesos(carga.datos.suma)}</strong>
          </p>
          {carga.datos.gastos.length === 0 ? (
            <Vacio titulo="No hay gastos cargados este mes">Cargá alquiler, insumos o lo que se pague, así la ganancia de Números da bien.</Vacio>
          ) : (
            <ul className="lista-simple">
              {carga.datos.gastos.map((g) => (
                <FilaGasto key={g.id} g={g} onBorrado={recargar} />
              ))}
            </ul>
          )}
          {carga.datos.total > carga.datos.gastos.length ? (
            <p className="nota-chica">Se muestran los {carga.datos.gastos.length} más recientes de {carga.datos.total}.</p>
          ) : null}
        </section>
      )}
    </>
  );
}

function FilaGasto({ g, onBorrado }: { g: Gasto; onBorrado: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const borrar = async () => {
    setBorrando(true);
    try {
      await ep.borrarGasto(g.id);
      setConfirmando(false);
      onBorrado();
    } catch (err) {
      setConfirmando(false);
      setError(mensajeDeError(err));
    } finally {
      setBorrando(false);
    }
  };

  return (
    <li className="fila-simple">
      <div className="fila-simple-principal">
        <span className="fila-simple-titulo">{g.descripcion}</span>
        <span className="fila-simple-monto">{pesos(g.monto)}</span>
      </div>
      <p className="fila-simple-detalle">
        {diaMes(g.fecha)} · {NOMBRE_CATEGORIA[g.categoria]}
        {g.proveedor ? ` · ${g.proveedor}` : ''}
        {g.origen === 'inventario' ? ' · desde Insumos' : ''}
      </p>
      {error ? <Aviso>{error}</Aviso> : null}
      {g.origen === 'manual' ? (
        <Boton chico variante="fantasma" className="btn-texto-peligro" icono={<Trash2 aria-hidden size={16} />} onClick={() => { setConfirmando(true); }}>
          Borrar
        </Boton>
      ) : null}
      <Confirmar
        abierto={confirmando}
        titulo="¿Borrar este gasto?"
        confirmar="Sí, borrarlo"
        ocupado={borrando}
        onConfirmar={() => void borrar()}
        onCancelar={() => { setConfirmando(false); }}
      >
        {g.descripcion}, {pesos(g.monto)}. No se puede deshacer.
      </Confirmar>
    </li>
  );
}

function NuevoGasto({ hoyAR, onListo, onCancelar }: { hoyAR: string; onListo: () => void; onCancelar: () => void }) {
  const [fecha, setFecha] = useState(hoyAR);
  const [categoria, setCategoria] = useState<CategoriaGasto>('insumos');
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const n = enteroDesdeTexto(monto);
    const locales: Record<string, string> = {};
    if (!descripcion.trim()) locales.descripcion = 'Escribí qué se pagó.';
    if (!n) locales.monto = 'Poné el monto (mayor a 0).';
    setErrores(locales);
    if (Object.keys(locales).length || !n) return;
    setGuardando(true);
    setError(null);
    try {
      await ep.crearGasto({ fecha, categoria, descripcion: descripcion.trim(), monto: n, proveedor: proveedor.trim() || null });
      onListo();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="hoja formulario" onSubmit={(e) => void guardar(e)} noValidate>
      <h2 className="bloque-titulo">Cargar gasto</h2>
      {error ? <Aviso>{error}</Aviso> : null}
      <Campo etiqueta="Qué se pagó" value={descripcion} maxLength={120} onChange={(e) => { setDescripcion(e.target.value); }} error={errores.descripcion} />
      <div className="fila-campos">
        <Campo etiqueta="Monto" prefijo="$" inputMode="numeric" value={monto} onChange={(e) => { setMonto(miles(e.target.value)); }} error={errores.monto} />
        <Campo etiqueta="Fecha" type="date" max={hoyAR} value={fecha} onChange={(e) => { if (e.target.value) setFecha(e.target.value); }} error={errores.fecha} />
      </div>
      <Selector etiqueta="Categoría" value={categoria} onChange={(e) => { setCategoria(e.target.value as CategoriaGasto); }} error={errores.categoria}>
        {CATEGORIAS_GASTO.map((c) => (
          <option key={c} value={c}>{NOMBRE_CATEGORIA[c]}</option>
        ))}
      </Selector>
      <Campo etiqueta="Proveedor (opcional)" value={proveedor} maxLength={80} onChange={(e) => { setProveedor(e.target.value); }} error={errores.proveedor} />
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>Guardar gasto</Boton>
      </div>
    </form>
  );
}
