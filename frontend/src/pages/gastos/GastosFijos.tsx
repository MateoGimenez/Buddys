import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../../api/client';
import * as ep from '../../api/endpoints';
import { borrarGastoFijo, crearGastoFijo, editarGastoFijo, gastosFijos, type CambioGastoFijo, type GastoFijo } from '../../api/finanzas';
import { CATEGORIAS_GASTO, type CategoriaGasto, type Trabajador } from '../../api/types';
import { Aviso, Boton, Campo, Cargando, Confirmar, Selector, Vacio } from '../../components/ui';
import { enteroDesdeTexto, hoy, miles, nombreMes, pesos } from '../../lib/format';
import { usePuedeDelTodo } from '../../lib/nivel';
import { useCarga } from '../../lib/useCarga';
import { NOMBRE_CATEGORIA } from './categorias';

/**
 * Gastos fijos mensuales (sueldos, alquiler, servicios): cuentan enteros el día 1 de cada mes de vigencia, en Números
 * (gastos y ganancia) y en el CSV de gastos. El admin los ve; cargarlos o cambiarlos, solo el superadmin.
 */
export function GastosFijos() {
  const gestiona = usePuedeDelTodo('finanzas.gastos_fijos');
  const [carga, recargar] = useCarga(() => gastosFijos(), []);
  const [equipo] = useCarga(() => (gestiona ? ep.trabajadores().then((r) => r.trabajadores) : Promise.resolve([])), [gestiona]);
  const [creando, setCreando] = useState(false);
  const mesActual = hoy().slice(0, 7);

  return (
    <section className="hoja bloque fijos" aria-labelledby="fijos-titulo">
      <div className="bloque-cabeza">
        <h2 id="fijos-titulo" className="bloque-titulo">
          Gastos fijos
        </h2>
        {gestiona && !creando ? (
          <Boton chico variante="secundario" icono={<Plus aria-hidden size={18} />} onClick={() => { setCreando(true); }}>
            Nuevo gasto fijo
          </Boton>
        ) : null}
      </div>
      <p className="fijos-regla">
        <CalendarClock aria-hidden size={20} />
        <span>
          Cuentan enteros <strong>el día 1 de cada mes</strong>, solos. No los cargues también como gasto suelto: se contarían
          dos veces.
        </span>
      </p>

      {creando ? (
        <FormFijo
          equipo={equipo.datos ?? []}
          onCancelar={() => { setCreando(false); }}
          onListo={() => {
            setCreando(false);
            recargar();
          }}
        />
      ) : null}

      {carga.estado === 'error' ? (
        <Aviso titulo="No pudimos cargar los gastos fijos" accion={<Boton onClick={recargar}>Reintentar</Boton>}>
          {carga.mensaje}
        </Aviso>
      ) : null}
      {!carga.datos ? (
        carga.estado === 'cargando' ? <Cargando texto="Cargando los gastos fijos…" /> : null
      ) : (
        <>
          <p className="total-linea">
            <span>Total por mes</span>
            <strong>{pesos(carga.datos.totalMensual)}</strong>
          </p>
          {carga.datos.gastosFijos.length === 0 ? (
            <Vacio titulo="Todavía no hay gastos fijos">
              {gestiona ? 'Cargá los sueldos, el alquiler y los servicios una sola vez: cuentan solos cada mes.' : 'Los carga el dueño.'}
            </Vacio>
          ) : (
            <ul className="lista-simple">
              {carga.datos.gastosFijos.map((g) => (
                <FilaFijo key={g.id} g={g} gestiona={gestiona} mesActual={mesActual} equipo={equipo.datos ?? []} onCambio={recargar} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function vigencia(g: GastoFijo, mesActual: string): string {
  if (g.hasta) return g.hasta < mesActual ? `Terminó en ${nombreMes(g.hasta)}` : `Desde ${nombreMes(g.desde)} hasta ${nombreMes(g.hasta)}`;
  return g.desde > mesActual ? `Empieza en ${nombreMes(g.desde)}` : `Desde ${nombreMes(g.desde)}, todos los meses`;
}

function FilaFijo({ g, gestiona, mesActual, equipo, onCambio }: { g: GastoFijo; gestiona: boolean; mesActual: string; equipo: Trabajador[]; onCambio: () => void }) {
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminado = g.hasta !== null && g.hasta < mesActual;

  const cambiar = async (cambio: CambioGastoFijo) => {
    setOcupado(true);
    setError(null);
    try {
      await editarGastoFijo(g.id, cambio);
      onCambio();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const borrar = async () => {
    setOcupado(true);
    setError(null);
    try {
      await borrarGastoFijo(g.id);
      setConfirmando(false);
      onCambio();
    } catch (err) {
      setConfirmando(false);
      setError(mensajeDeError(err));
      setOcupado(false);
    }
  };

  if (editando) {
    return (
      <li className="fila-simple">
        <FormFijo
          actual={g}
          equipo={equipo}
          onCancelar={() => { setEditando(false); }}
          onListo={() => {
            setEditando(false);
            onCambio();
          }}
        />
      </li>
    );
  }

  return (
    <li className="fila-simple fila-fijo" data-terminado={terminado ? '' : undefined}>
      <div className="fila-simple-principal">
        <span className="fila-simple-titulo">{g.concepto}</span>
        <span className="fila-simple-monto">{pesos(g.monto)}</span>
      </div>
      <p className="fila-simple-detalle">
        {NOMBRE_CATEGORIA[g.categoria]}
        {g.perfil ? ` · ${g.perfil.nombre}` : ''} · {vigencia(g, mesActual)}
      </p>
      {error ? <Aviso>{error}</Aviso> : null}
      {gestiona ? (
        <div className="copia-acciones">
          <Boton chico variante="fantasma" icono={<Pencil aria-hidden size={16} />} onClick={() => { setEditando(true); }} disabled={ocupado}>
            Editar
          </Boton>
          {g.hasta === null ? (
            <Boton chico variante="fantasma" cargando={ocupado} onClick={() => void cambiar({ activo: false })}>
              Dejar de contar
            </Boton>
          ) : (
            <Boton chico variante="fantasma" cargando={ocupado} onClick={() => void cambiar({ activo: true })}>
              Volver a contar
            </Boton>
          )}
          <Boton chico variante="fantasma" className="btn-texto-peligro" icono={<Trash2 aria-hidden size={16} />} onClick={() => { setConfirmando(true); }} disabled={ocupado}>
            Borrar
          </Boton>
        </div>
      ) : null}
      <Confirmar
        abierto={confirmando}
        titulo="¿Borrar este gasto fijo?"
        confirmar="Sí, borrarlo"
        ocupado={ocupado}
        onConfirmar={() => void borrar()}
        onCancelar={() => { setConfirmando(false); }}
      >
        {g.concepto}, {pesos(g.monto)} por mes. Se borra también de los meses pasados y cambian los números de esos meses. Para
        que deje de contar desde ahora, usá "Dejar de contar".
      </Confirmar>
    </li>
  );
}

function FormFijo({ actual, equipo, onListo, onCancelar }: { actual?: GastoFijo; equipo: Trabajador[]; onListo: () => void; onCancelar: () => void }) {
  const [concepto, setConcepto] = useState(actual?.concepto ?? '');
  const [monto, setMonto] = useState(actual ? miles(String(actual.monto)) : '');
  const [categoria, setCategoria] = useState<CategoriaGasto>(actual?.categoria ?? 'sueldos');
  const [perfilId, setPerfilId] = useState(actual?.perfil?.id ?? '');
  const [desde, setDesde] = useState(actual?.desde ?? hoy().slice(0, 7));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const n = enteroDesdeTexto(monto);
  const cambiaMonto = actual !== undefined && n !== null && n !== actual.monto;

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const locales: Record<string, string> = {};
    if (!concepto.trim()) locales.concepto = 'Escribí qué es (por ejemplo, "Alquiler del local").';
    if (!n) locales.monto = 'Poné el monto por mes (mayor a 0).';
    setErrores(locales);
    if (Object.keys(locales).length || !n) return;
    const perfil = categoria === 'sueldos' && perfilId ? perfilId : null;
    setGuardando(true);
    setError(null);
    try {
      if (actual) {
        const cambio: CambioGastoFijo = {};
        if (concepto.trim() !== actual.concepto) cambio.concepto = concepto.trim();
        if (n !== actual.monto) cambio.monto = n;
        if (categoria !== actual.categoria) cambio.categoria = categoria;
        if (perfil !== (actual.perfil?.id ?? null)) cambio.perfilId = perfil;
        if (desde !== actual.desde) cambio.desde = desde;
        if (Object.keys(cambio).length) await editarGastoFijo(actual.id, cambio);
      } else {
        await crearGastoFijo({ concepto: concepto.trim(), monto: n, categoria, ...(perfil ? { perfilId: perfil } : {}), desde });
      }
      onListo();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="formulario form-fijo" onSubmit={(e) => void guardar(e)} noValidate aria-label={actual ? `Editar ${actual.concepto}` : 'Nuevo gasto fijo'}>
      {error ? <Aviso>{error}</Aviso> : null}
      <Campo etiqueta="Qué es" value={concepto} maxLength={120} onChange={(e) => { setConcepto(e.target.value); }} error={errores.concepto} />
      <div className="fila-campos">
        <Campo etiqueta="Monto por mes" prefijo="$" inputMode="numeric" value={monto} onChange={(e) => { setMonto(miles(e.target.value)); }} error={errores.monto} />
        <Campo
          etiqueta="Cuenta desde"
          type="month"
          value={desde}
          onChange={(e) => {
            if (e.target.value) setDesde(e.target.value);
          }}
          error={errores.desde}
          ayuda="Entra el día 1 de ese mes."
        />
      </div>
      {cambiaMonto ? (
        <Aviso tipo="info" titulo="El monto nuevo cambia todos los meses">
          También los pasados. Si es un aumento, cancelá, tocá "Dejar de contar" en este y creá uno nuevo desde el mes del
          aumento.
        </Aviso>
      ) : actual ? (
        <p className="nota-chica">Cambiar el monto lo cambia en todos los meses. Para un aumento: dejá de contar este y creá otro.</p>
      ) : null}
      <Selector etiqueta="Categoría" value={categoria} onChange={(e) => { setCategoria(e.target.value as CategoriaGasto); }} error={errores.categoria}>
        {CATEGORIAS_GASTO.map((c) => (
          <option key={c} value={c}>
            {NOMBRE_CATEGORIA[c]}
          </option>
        ))}
      </Selector>
      {categoria === 'sueldos' ? (
        <Selector etiqueta="De quién es el sueldo (opcional)" value={perfilId} onChange={(e) => { setPerfilId(e.target.value); }} error={errores.perfilId}>
          <option value="">Sin indicar</option>
          {equipo.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </Selector>
      ) : null}
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>
          {actual ? 'Guardar cambios' : 'Guardar gasto fijo'}
        </Boton>
      </div>
    </form>
  );
}
