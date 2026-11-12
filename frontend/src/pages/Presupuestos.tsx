import { FileDown, Plus, X } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../api/client';
import * as ep from '../api/endpoints';
import { ESTADOS_PRESUPUESTO, type EstadoPresupuesto, type Presupuesto } from '../api/types';
import { AreaTexto, Aviso, Boton, Campo, Cargando, Encabezado, Selector, Vacio } from '../components/ui';
import { decimalDesdeTexto, enteroDesdeTexto, fechaCorta, miles, pesos } from '../lib/format';
import { abrirPdf } from '../lib/pdf';
import { useCarga } from '../lib/useCarga';

const NOMBRE_ESTADO: Record<EstadoPresupuesto, string> = {
  borrador: 'Borrador',
  enviado: 'Enviado',
  aceptado: 'Aceptado',
  rechazado: 'Rechazado',
};

export function Presupuestos() {
  const [carga, recargar, actualizar] = useCarga(() => ep.presupuestos(), []);
  const [creando, setCreando] = useState(false);

  return (
    <>
      <Encabezado titulo="Presupuestos">
        {!creando ? (
          <Boton variante="primario" chico icono={<Plus aria-hidden size={18} />} onClick={() => { setCreando(true); }}>
            Nuevo presupuesto
          </Boton>
        ) : null}
      </Encabezado>
      {creando ? <NuevoPresupuesto onListo={() => { setCreando(false); recargar(); }} onCancelar={() => { setCreando(false); }} /> : null}

      {carga.estado === 'error' ? <Aviso titulo="No pudimos cargar los presupuestos" accion={<Boton onClick={recargar}>Reintentar</Boton>}>{carga.mensaje}</Aviso> : null}
      {!carga.datos ? (carga.estado === 'cargando' ? <Cargando /> : null) : carga.datos.presupuestos.length === 0 ? (
        <Vacio titulo="Todavía no hay presupuestos">Armá uno para un pulido o un detailing completo y bajalo en PDF para mandarlo por WhatsApp.</Vacio>
      ) : (
        <ul className="lista-hojas">
          {carga.datos.presupuestos.map((p) => (
            <FilaPresupuesto
              key={p.id}
              p={p}
              onCambio={(nuevo) => {
                actualizar((d) => ({ ...d, presupuestos: d.presupuestos.map((x) => (x.id === nuevo.id ? nuevo : x)) }));
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function FilaPresupuesto({ p, onCambio }: { p: Presupuesto; onCambio: (p: Presupuesto) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [bajando, setBajando] = useState(false);

  const cambiarEstado = async (estado: EstadoPresupuesto) => {
    setOcupado(true);
    setError(null);
    try {
      const { presupuesto } = await ep.cambiarEstadoPresupuesto(p.id, estado);
      onCambio(presupuesto);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const bajar = async () => {
    setBajando(true);
    setError(null);
    try {
      await abrirPdf(() => ep.pdfPresupuesto(p.id), `Presupuesto-${p.codigo}.pdf`);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setBajando(false);
    }
  };

  return (
    <li className="hoja fila-hoja">
      <div className="fila-hoja-cabeza">
        <span className="copia-serie">{p.codigo}</span>
        <h2 className="fila-hoja-titulo">{p.clienteNombre}</h2>
        <span className="fila-hoja-monto">{pesos(p.total)}</span>
      </div>
      <p className="fila-hoja-texto">
        {p.vehiculo ? `${p.vehiculo} · ` : ''}
        {p.items.length} {p.items.length === 1 ? 'ítem' : 'ítems'} · vence el {fechaCorta(p.venceEl)}
        {p.vencido ? <span className="etiqueta etiqueta-alerta">Vencido</span> : null}
      </p>
      {error ? <Aviso>{error}</Aviso> : null}
      <div className="fila-campos fila-campos-centro">
        <Selector etiqueta="Estado" value={p.estado} disabled={ocupado} onChange={(e) => void cambiarEstado(e.target.value as EstadoPresupuesto)}>
          {ESTADOS_PRESUPUESTO.map((e) => (
            <option key={e} value={e}>{NOMBRE_ESTADO[e]}</option>
          ))}
        </Selector>
        <Boton variante="secundario" cargando={bajando} icono={<FileDown aria-hidden size={18} />} onClick={() => void bajar()}>
          Ver PDF
        </Boton>
      </div>
    </li>
  );
}

interface FilaItem {
  descripcion: string;
  cantidad: string;
  precio: string;
}

const ITEM_VACIO: FilaItem = { descripcion: '', cantidad: '1', precio: '' };

function NuevoPresupuesto({ onListo, onCancelar }: { onListo: () => void; onCancelar: () => void }) {
  const [cliente, setCliente] = useState('');
  const [telefono, setTelefono] = useState('');
  const [vehiculo, setVehiculo] = useState('');
  const [items, setItems] = useState<FilaItem[]>([{ ...ITEM_VACIO }]);
  const [descuento, setDescuento] = useState('');
  const [validez, setValidez] = useState('7');
  const [notas, setNotas] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const subtotal = items.reduce((acc, it) => {
    const c = decimalDesdeTexto(it.cantidad);
    const pr = enteroDesdeTexto(it.precio) ?? 0;
    return acc + (Number.isNaN(c) ? 0 : Math.round(c * pr));
  }, 0);
  const total = Math.max(0, subtotal - (enteroDesdeTexto(descuento) ?? 0));

  const cambiarItem = (i: number, cambio: Partial<FilaItem>) => {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...cambio } : it)));
  };

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const locales: Record<string, string> = {};
    if (!cliente.trim()) locales.clienteNombre = 'Poné el nombre del cliente.';
    items.forEach((it, i) => {
      if (!it.descripcion.trim()) locales[`items.${i}.descripcion`] = 'Escribí qué incluye.';
      if (Number.isNaN(decimalDesdeTexto(it.cantidad))) locales[`items.${i}.cantidad`] = 'Escribí la cantidad.';
      if (enteroDesdeTexto(it.precio) === null) locales[`items.${i}.precioUnitario`] = 'Poné el precio.';
    });
    setErrores(locales);
    if (Object.keys(locales).length) return;
    setGuardando(true);
    setError(null);
    try {
      const desc = enteroDesdeTexto(descuento);
      await ep.crearPresupuesto({
        clienteNombre: cliente.trim(),
        items: items.map((it) => ({
          descripcion: it.descripcion.trim(),
          cantidad: decimalDesdeTexto(it.cantidad),
          precioUnitario: enteroDesdeTexto(it.precio) ?? 0,
        })),
        validezDias: Number(validez) || 7,
        ...(telefono.trim() ? { clienteTelefono: telefono.trim() } : {}),
        ...(vehiculo.trim() ? { vehiculo: vehiculo.trim() } : {}),
        ...(desc ? { descuento: desc } : {}),
        ...(notas.trim() ? { notas: notas.trim() } : {}),
      });
      onListo();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="hoja formulario" onSubmit={(e) => void guardar(e)} noValidate>
      <h2 className="bloque-titulo">Nuevo presupuesto</h2>
      {error ? <Aviso>{error}</Aviso> : null}
      <Campo etiqueta="Cliente" value={cliente} maxLength={80} onChange={(e) => { setCliente(e.target.value); }} error={errores.clienteNombre} />
      <div className="fila-campos">
        <Campo etiqueta="Teléfono (opcional)" type="tel" inputMode="tel" value={telefono} onChange={(e) => { setTelefono(e.target.value); }} error={errores.clienteTelefono} />
        <Campo etiqueta="Vehículo (opcional)" value={vehiculo} maxLength={80} onChange={(e) => { setVehiculo(e.target.value); }} error={errores.vehiculo} />
      </div>

      <fieldset className="items">
        <legend>Trabajos</legend>
        {errores.items ? <p className="campo-error">{errores.items}</p> : null}
        {items.map((it, i) => (
          <div key={i} className="item">
            <Campo className="item-desc" etiqueta={`Trabajo ${i + 1}`} value={it.descripcion} maxLength={120} onChange={(e) => { cambiarItem(i, { descripcion: e.target.value }); }} error={errores[`items.${i}.descripcion`]} />
            <Campo className="item-cant" etiqueta="Cant." inputMode="decimal" value={it.cantidad} onChange={(e) => { cambiarItem(i, { cantidad: e.target.value }); }} error={errores[`items.${i}.cantidad`]} />
            <Campo className="item-precio" etiqueta="Precio" prefijo="$" inputMode="numeric" value={it.precio} onChange={(e) => { cambiarItem(i, { precio: miles(e.target.value) }); }} error={errores[`items.${i}.precioUnitario`]} />
            {items.length > 1 ? (
              <Boton chico variante="fantasma" className="item-quitar" aria-label={`Quitar trabajo ${i + 1}`} icono={<X aria-hidden size={18} />} onClick={() => { setItems((p) => p.filter((_, j) => j !== i)); }} />
            ) : null}
          </div>
        ))}
        {items.length < 30 ? (
          <Boton chico variante="fantasma" icono={<Plus aria-hidden size={18} />} onClick={() => { setItems((p) => [...p, { ...ITEM_VACIO }]); }}>
            Agregar trabajo
          </Boton>
        ) : null}
      </fieldset>

      <div className="fila-campos">
        <Campo etiqueta="Descuento (opcional)" prefijo="$" inputMode="numeric" value={descuento} onChange={(e) => { setDescuento(miles(e.target.value)); }} error={errores.descuento} />
        <Campo etiqueta="Válido por (días)" inputMode="numeric" value={validez} onChange={(e) => { setValidez(e.target.value.replace(/\D/g, '')); }} error={errores.validezDias} />
      </div>
      <AreaTexto etiqueta="Notas (opcional)" value={notas} maxLength={500} onChange={(e) => { setNotas(e.target.value); }} error={errores.notas} />
      <p className="total-linea">
        <span>Total estimado</span>
        <strong>{pesos(total)}</strong>
      </p>
      <p className="nota-chica">El total final lo calcula el sistema al guardar. No es una factura.</p>
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>Guardar presupuesto</Boton>
      </div>
    </form>
  );
}
