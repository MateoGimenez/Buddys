import { ChevronDown, ChevronLeft, ChevronRight, Copy, MessageCircle, PackagePlus, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, mensajeDeError } from '../../api/client';
import * as ep from '../../api/endpoints';
import { UNIDADES, type Consumo, type Insumo, type ItemParaComprar, type MovimientoNuevo, type Unidad } from '../../api/types';
import { Barras } from '../../components/Barras';
import { Aviso, Boton, Campo, Cargando, Encabezado, Selector, Vacio } from '../../components/ui';
import { avisarCambioDeStock } from '../../lib/avisosStock';
import { numeroParaCampo, textoParaComprar, urlWhatsApp } from '../../lib/compras';
import {
  NOMBRE_UNIDAD,
  cantidadConUnidad as cantidad,
  decimalDesdeTexto,
  enteroDesdeTexto,
  hoy,
  miles,
  nombreMes,
  numero,
  pesos,
  primeroDelMes,
  sumarDias,
  ultimoDelMes,
} from '../../lib/format';
import { useCarga } from '../../lib/useCarga';
import { useSesion, useVeImportes } from '../../session/SessionContext';
import { Minimo } from './Minimo';
import { Movimientos } from './Movimientos';

/* ---------------------------------------------------------------- Vistas: Stock, Para comprar y Consumo (?ver=) */

type Vista = 'stock' | 'comprar' | 'consumo';

const NOMBRE_VISTA: Record<Vista, string> = { stock: 'Stock', comprar: 'Para comprar', consumo: 'Consumo' };

function buscarVista(v: Vista): string {
  return v === 'stock' ? '' : `?ver=${v}`;
}

export function Insumos() {
  const { puede } = useSesion();
  const gestiona = puede('inventario.gestionar');
  // Para comprar y Consumo traen costos: son de quien tiene inventario.consumo (admin y superadmin).
  const vistas: Vista[] = puede('inventario.consumo') ? ['stock', 'comprar', 'consumo'] : ['stock'];
  const [params] = useSearchParams();
  const vista = vistas.find((v) => v === params.get('ver')) ?? 'stock';
  const [creando, setCreando] = useState(false);

  return (
    <>
      <Encabezado titulo="Insumos">
        {vista === 'stock' && gestiona && !creando ? (
          <Boton variante="primario" chico icono={<Plus aria-hidden size={18} />} onClick={() => { setCreando(true); }}>
            Nuevo insumo
          </Boton>
        ) : null}
      </Encabezado>
      {vistas.length > 1 ? (
        <nav className="vistas" aria-label="Vistas de insumos">
          {vistas.map((v) => (
            <Link key={v} to={{ search: buscarVista(v) }} replace className="vista" aria-current={v === vista ? 'page' : undefined}>
              {NOMBRE_VISTA[v]}
            </Link>
          ))}
        </nav>
      ) : null}
      {vista === 'stock' ? (
        <Stock gestiona={gestiona} veCompras={vistas.includes('comprar')} creando={creando} setCreando={setCreando} />
      ) : vista === 'comprar' ? (
        <VistaParaComprar gestiona={gestiona} />
      ) : (
        <VistaConsumo />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- Stock (lo de siempre) */

function Stock({ gestiona, veCompras, creando, setCreando }: { gestiona: boolean; veCompras: boolean; creando: boolean; setCreando: (v: boolean) => void }) {
  const [carga, recargar, actualizar] = useCarga(() => ep.insumos(), []);

  return (
    <>
      {creando ? <NuevoInsumo onListo={() => { setCreando(false); recargar(); avisarCambioDeStock(); }} onCancelar={() => { setCreando(false); }} /> : null}

      {carga.estado === 'error' ? <Aviso titulo="No pudimos cargar los insumos" accion={<Boton onClick={recargar}>Reintentar</Boton>}>{carga.mensaje}</Aviso> : null}
      {!carga.datos ? (carga.estado === 'cargando' ? <Cargando /> : null) : (
        <>
          {carga.datos.bajoStock > 0 ? (
            <Aviso
              tipo="error"
              titulo={`${carga.datos.bajoStock} ${carga.datos.bajoStock === 1 ? 'insumo está' : 'insumos están'} por acabarse`}
              accion={veCompras ? <Link className="btn btn-secundario btn-chico" to={{ search: buscarVista('comprar') }} replace>Ver qué comprar</Link> : undefined}
            >
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
                    avisarCambioDeStock();
                  }}
                />
              ))}
            </ul>
          )}
          {carga.datos.total > carga.datos.insumos.length ? (
            <p className="nota-chica">Se muestran {carga.datos.insumos.length} de {carga.datos.total} insumos.</p>
          ) : null}
        </>
      )}
    </>
  );
}

type Accion = 'uso' | 'compra' | 'ajuste';

function FilaInsumo({ insumo, gestiona, onCambio }: { insumo: Insumo; gestiona: boolean; onCambio: (i: Insumo) => void }) {
  const veImportes = useVeImportes();
  const [accion, setAccion] = useState<Accion | 'minimo' | null>(null);
  const [verMovimientos, setVerMovimientos] = useState(false);
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
      {accion === 'minimo' ? (
        <Minimo
          insumo={insumo}
          onListo={(i) => { setAccion(null); setHecho(i.stockMinimo ? `Avisa cuando queden ${cantidad(i.stockMinimo, i.unidad)}.` : 'Ya no avisa cuando queda poco.'); onCambio(i); }}
          onCancelar={() => { setAccion(null); }}
        />
      ) : accion ? (
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
              <Boton chico variante="fantasma" onClick={() => { setAccion('minimo'); setHecho(null); }}>Cambiar mínimo</Boton>
            </>
          ) : null}
          <Boton chico variante="fantasma" aria-expanded={verMovimientos} onClick={() => { setVerMovimientos(!verMovimientos); }}>
            {verMovimientos ? 'Ocultar movimientos' : 'Movimientos'}
          </Boton>
        </div>
      )}
      {verMovimientos ? <Movimientos insumo={insumo} veImportes={veImportes} /> : null}
    </li>
  );
}

const TITULO_ACCION: Record<Accion, string> = { uso: 'Cuánto se usó', compra: 'Cuánto se compró', ajuste: 'Cuánto hay contado' };

/** La carga de un movimiento. Desde "Para comprar" llega con la cantidad sugerida ya escrita (`inicial`). */
function Movimiento({
  insumo,
  accion,
  inicial = '',
  onListo,
  onCancelar,
}: {
  insumo: Pick<Insumo, 'id' | 'unidad'>;
  accion: Accion;
  inicial?: string;
  onListo: (i: Insumo, texto: string) => void;
  onCancelar: () => void;
}) {
  const [cant, setCant] = useState(inicial);
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
        onFocus={(e) => { e.target.select(); }}
        error={errores[campo]}
        ayuda={inicial ? 'Es lo sugerido: cambialo si compraste otra cantidad.' : undefined}
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

/* ---------------------------------------------------------------- Para comprar */

/** Agrupa los renglones (ya vienen por categoría y nombre) bajo su categoría, en el mismo orden. */
function porCategoriaDeInsumo(items: ItemParaComprar[]): { categoria: string; items: ItemParaComprar[] }[] {
  const grupos: { categoria: string; items: ItemParaComprar[] }[] = [];
  for (const i of items) {
    const c = i.categoria?.trim() || 'Sin categoría';
    const ultimo = grupos.at(-1);
    if (ultimo?.categoria === c) ultimo.items.push(i);
    else grupos.push({ categoria: c, items: [i] });
  }
  return grupos;
}

function VistaParaComprar({ gestiona }: { gestiona: boolean }) {
  const [carga, recargar] = useCarga(() => ep.paraComprar(), []);
  const [hecho, setHecho] = useState<string | null>(null);

  if (carga.estado === 'error' && !carga.datos)
    return <Aviso titulo="No pudimos cargar la lista para comprar" accion={<Boton onClick={recargar}>Reintentar</Boton>}>{carga.mensaje}</Aviso>;
  if (!carga.datos) return <Cargando />;
  const { items, costoTotalEstimado } = carga.datos;
  const grupos = porCategoriaDeInsumo(items);
  const muchasCategorias = grupos.length > 1;

  return (
    <div className="comprar" aria-busy={carga.estado === 'cargando'}>
      {hecho ? <Aviso tipo="ok">{hecho}</Aviso> : null}
      {carga.estado === 'error' ? <Aviso>{carga.mensaje}</Aviso> : null}
      {items.length === 0 ? (
        <Vacio titulo="No falta nada">Todos los insumos están por encima del mínimo. Cuando alguno llegue, aparece acá.</Vacio>
      ) : (
        <>
          <p className="comprar-resumen">
            {items.length === 1 ? '1 insumo llegó al mínimo.' : `${String(items.length)} insumos llegaron al mínimo.`} Lo sugerido deja el
            stock en el doble del mínimo.
          </p>
          {grupos.map((g) => (
            <section key={g.categoria} className="categoria">
              {muchasCategorias ? <h2 className="categoria-titulo">{g.categoria}</h2> : null}
              <ul className="lista-hojas">
                {g.items.map((i) => (
                  <FilaParaComprar
                    key={i.insumoId}
                    item={i}
                    titulo={muchasCategorias ? 'h3' : 'h2'}
                    gestiona={gestiona}
                    onCompra={(texto) => {
                      setHecho(`${texto.replace(/\.$/, '')} de ${i.nombre}.`);
                      recargar();
                      avisarCambioDeStock();
                    }}
                  />
                ))}
              </ul>
            </section>
          ))}
          <Compartir items={items} costoTotal={costoTotalEstimado} />
        </>
      )}
    </div>
  );
}

function FilaParaComprar({
  item,
  titulo: Titulo,
  gestiona,
  onCompra,
}: {
  item: ItemParaComprar;
  /** h3 bajo el título de su categoría; h2 si hay una sola categoría (sin títulos de grupo). */
  titulo: 'h2' | 'h3';
  gestiona: boolean;
  onCompra: (texto: string) => void;
}) {
  const [cargando, setCargando] = useState(false);
  return (
    <li className="hoja fila-hoja comprar-fila">
      <div className="comprar-fila-cabeza">
        <Titulo className="fila-hoja-titulo">{item.nombre}</Titulo>
        <p className="comprar-sugerido">
          <span className="comprar-etiqueta">Comprar</span>{' '}
          <strong>{cantidad(item.sugerido, item.unidad)}</strong>
          {item.costoEstimado !== null ? <span className="comprar-costo">≈ {pesos(item.costoEstimado)}</span> : null}
        </p>
      </div>
      <p className="stock">
        <span>Hay {cantidad(item.stock, item.unidad)} · mínimo {numero(item.stockMinimo)}</span>
      </p>
      {cargando ? (
        <Movimiento
          insumo={{ id: item.insumoId, unidad: item.unidad }}
          accion="compra"
          inicial={numeroParaCampo(item.sugerido)}
          onListo={(_i, texto) => { setCargando(false); onCompra(texto); }}
          onCancelar={() => { setCargando(false); }}
        />
      ) : gestiona ? (
        <div className="copia-acciones">
          <Boton chico variante="secundario" icono={<PackagePlus aria-hidden size={18} />} onClick={() => { setCargando(true); }} aria-label={`Cargar compra de ${item.nombre}`}>
            Cargar compra
          </Boton>
        </div>
      ) : null}
    </li>
  );
}

type Resultado = { tipo: 'ok' | 'error'; texto: string } | null;

/** Copiar y compartir la lista (sin precios: es para el proveedor). */
function Compartir({ items, costoTotal }: { items: ItemParaComprar[]; costoTotal: number }) {
  const texto = textoParaComprar(items, hoy());
  const [resultado, setResultado] = useState<Resultado>(null);
  const reloj = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const puedeCompartir = typeof navigator.share === 'function';

  useEffect(() => () => { clearTimeout(reloj.current); }, []);

  const avisar = (r: Resultado) => {
    clearTimeout(reloj.current);
    setResultado(r);
    reloj.current = setTimeout(() => { setResultado(null); }, 4000);
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      avisar({ tipo: 'ok', texto: 'Lista copiada. Pegala en el chat del proveedor.' });
    } catch {
      avisar({ tipo: 'error', texto: 'No se pudo copiar. Abrí “Ver el mensaje” y copialo a mano.' });
    }
  };

  const compartir = async () => {
    try {
      await navigator.share({ text: texto });
    } catch (err) {
      // Cerrar la hoja de compartir no es un error. Si el navegador no deja compartir, se abre WhatsApp directo.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      window.open(urlWhatsApp(texto), '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <section className="hoja bloque comprar-pie" aria-labelledby="t-compartir">
      <div className="bloque-cabeza">
        <h2 id="t-compartir" className="bloque-titulo">Mandar la lista</h2>
        {/* El backend manda 0 (nunca null) si ningún insumo tiene costo: "$ 0" sería engañoso. */}
        {costoTotal > 0 ? (
          <p className="comprar-total">
            <span>Costo estimado</span> <strong>{pesos(costoTotal)}</strong>
          </p>
        ) : null}
      </div>
      <p className="nota-chica">El mensaje va sin precios. El costo estimado usa el último precio de cada insumo.</p>
      <div className="fila-botones fila-botones-inicio">
        <Boton icono={<Copy aria-hidden size={18} />} onClick={() => void copiar()}>Copiar</Boton>
        {puedeCompartir ? (
          <Boton variante="primario" icono={<MessageCircle aria-hidden size={18} />} onClick={() => void compartir()}>
            Compartir por WhatsApp
          </Boton>
        ) : (
          <a className="btn btn-primario" href={urlWhatsApp(texto)} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden size={18} />
            Compartir por WhatsApp
          </a>
        )}
      </div>
      <p className={`comprar-resultado ${resultado?.tipo === 'error' ? 'campo-error' : 'nota-ok'}`} role="status">
        {resultado?.texto ?? ''}
      </p>
      <details className="plegable">
        <summary>
          <span>Ver el mensaje</span>
          <span className="plegable-ayuda">Así le llega al proveedor</span>
          <ChevronDown aria-hidden size={20} className="plegable-flecha" />
        </summary>
        <pre className="comprar-mensaje">{texto}</pre>
      </details>
    </section>
  );
}

/* ---------------------------------------------------------------- Consumo del mes */

const TITULO_SERIE: Record<Consumo['rango']['agrupado'], string> = {
  dia: 'Lavados por día',
  semana: 'Lavados por semana',
  mes: 'Lavados por mes',
};

function VistaConsumo() {
  const hoyAR = hoy();
  const [mes, setMes] = useState(primeroDelMes(hoyAR));
  const esMesActual = mes === primeroDelMes(hoyAR);
  // El mes en curso va hasta hoy: los días que faltan no son "cero lavados".
  const desde = mes;
  const hasta = esMesActual ? hoyAR : ultimoDelMes(mes);
  const [carga, recargar] = useCarga(() => ep.consumo(desde, hasta), [desde, hasta]);

  return (
    <>
      <div className="navegador-fecha">
        <Boton chico variante="fantasma" aria-label="Mes anterior" icono={<ChevronLeft aria-hidden size={20} />} onClick={() => { setMes(primeroDelMes(sumarDias(mes, -1))); }} />
        <span className="navegador-mes" aria-live="polite">{nombreMes(mes)}</span>
        <Boton chico variante="fantasma" aria-label="Mes siguiente" icono={<ChevronRight aria-hidden size={20} />} disabled={esMesActual} onClick={() => { setMes(sumarDias(ultimoDelMes(mes), 1)); }} />
      </div>
      {carga.estado === 'error' && !carga.datos ? (
        <Aviso titulo="No pudimos cargar el consumo" accion={<Boton onClick={recargar}>Reintentar</Boton>}>{carga.mensaje}</Aviso>
      ) : !carga.datos ? (
        <Cargando />
      ) : (
        <div className="numeros" aria-busy={carga.estado === 'cargando'}>
          {carga.estado === 'error' ? <Aviso>{carga.mensaje}</Aviso> : null}
          <TableroConsumo c={carga.datos} mes={mes} />
        </div>
      )}
    </>
  );
}

function TableroConsumo({ c, mes }: { c: Consumo; mes: string }) {
  const sinCosto = c.porInsumo.some((i) => i.costo === null);
  return (
    <>
      <section className="hoja bloque" aria-labelledby="t-lavados">
        <h2 id="t-lavados" className="bloque-titulo">Lavados y costo de {nombreMes(mes)}</h2>
        <dl className="cifras-periodo">
          <div><dt>Lavados</dt><dd>{c.lavados.total}</dd></div>
          <div><dt>Costo de insumos</dt><dd>{pesos(c.costoInsumos)}</dd></div>
          <div><dt>Costo por lavado</dt><dd>{c.costoPorLavado === null ? '—' : pesos(c.costoPorLavado)}</dd></div>
        </dl>
        <p className="nota-chica">Costos con el precio actual de cada insumo, no con lo que se pagó en su momento.</p>
        {c.lavados.total === 0 ? (
          <Vacio titulo="No hubo lavados en este mes">Probá con otro mes.</Vacio>
        ) : (
          <Barras titulo={TITULO_SERIE[c.rango.agrupado]} puntos={c.lavados.serie.map((p) => ({ clave: p.clave, valor: p.cantidad }))} formato={(v) => String(v)} />
        )}
      </section>

      <section className="hoja bloque" aria-labelledby="t-por-insumo">
        <h2 id="t-por-insumo" className="bloque-titulo">Qué se gastó</h2>
        {c.porInsumo.length === 0 ? (
          <Vacio titulo="No se descontó nada este mes">Se descuenta solo con la receta de cada servicio, o con “Anotar uso” en Stock.</Vacio>
        ) : (
          <>
            <div className="tabla-scroll">
              <table className="tabla">
                <thead>
                  <tr>
                    <th scope="col">Insumo</th>
                    <th scope="col" className="num">Consumido</th>
                    <th scope="col" className="num">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {c.porInsumo.map((i) => (
                    <tr key={i.insumoId}>
                      <td>{i.nombre}</td>
                      <td className="num">{cantidad(i.consumido, i.unidad)}</td>
                      <td className="num">{i.costo === null ? <span className="sin-dato">Sin costo</span> : pesos(i.costo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sinCosto ? <p className="nota-chica">“Sin costo”: ese insumo no tiene precio cargado y no suma al costo por lavado. Se carga solo con la próxima compra que lleve costo.</p> : null}
          </>
        )}
      </section>
    </>
  );
}
