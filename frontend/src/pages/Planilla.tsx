import { ChevronLeft, ChevronRight, FileDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, mensajeDeError } from '../api/client';
import * as ep from '../api/endpoints';
import { FORMAS_PAGO, type CambioTurno, type FormaPago, type PlanillaDelDia, type Servicio, type Trabajador, type Turno } from '../api/types';
import { ElegirServicios } from '../components/ElegirServicios';
import { AreaTexto, Aviso, Boton, Campo, Cargando, Confirmar, Encabezado, Segmentado, Selector, Vacio } from '../components/ui';
import { EVENTO_ENVIADOS } from '../lib/cola';
import {
  NOMBRE_FRANJA,
  NOMBRE_PAGO,
  NOMBRE_VEHICULO,
  enteroDesdeTexto,
  fechaLarga,
  hora,
  hoy,
  miles,
  nombresDelTurno,
  pesos,
  serie,
  sumaDeLista,
  sumarDias,
} from '../lib/format';
import { useContador, useFlip } from '../lib/movimiento';
import { useCarga } from '../lib/useCarga';
import { useSesion, useUsuario, useVeImportes } from '../session/SessionContext';
import { abrirPdf } from '../lib/pdf';

const NOMBRE_MOSTRADOR = 'Cliente de mostrador';

export function Planilla() {
  const hoyAR = hoy();
  // null = "hoy" (si la pantalla queda abierta pasada la medianoche, muestra el día nuevo).
  const [fechaElegida, setFechaElegida] = useState<string | null>(null);
  const fecha = fechaElegida ?? hoyAR;
  const setFecha = (f: string) => {
    setFechaElegida(f >= hoyAR ? null : f);
  };
  const veImportes = useVeImportes();
  const { puede } = useSesion();
  const corrige = puede('cobro.corregir');
  const borra = puede('turnos.borrar');
  const comprobantes = puede('documentos.comprobantes');

  const [dia, recargar, actualizarDia] = useCarga(() => ep.planilla(fecha), [fecha]);
  // Cuando salen lavados que habían quedado guardados sin conexión, la planilla se pone al día sola.
  useEffect(() => {
    window.addEventListener(EVENTO_ENVIADOS, recargar);
    return () => {
      window.removeEventListener(EVENTO_ENVIADOS, recargar);
    };
  }, [recargar]);
  const [catalogo] = useCarga(() => ep.servicios().then((r) => r.servicios), []);
  const [equipo] = useCarga(() => (corrige ? ep.trabajadores().then((r) => r.trabajadores) : Promise.resolve([])), [corrige]);

  const nombresServicio = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of catalogo.datos ?? []) m.set(s.id, s.nombre);
    return m;
  }, [catalogo.datos]);

  const datos = dia.datos?.fecha === fecha ? dia.datos : dia.estado === 'cargando' ? null : dia.datos;

  return (
    <>
      <Encabezado titulo="Planilla del día">
        <div className="navegador-fecha">
          <Boton
            chico
            variante="fantasma"
            aria-label="Día anterior"
            icono={<ChevronLeft aria-hidden size={20} />}
            onClick={() => {
              setFecha(sumarDias(fecha, -1));
            }}
          />
          <label className="navegador-fecha-campo">
            <span className="solo-lectores">Fecha de la planilla</span>
            <input
              type="date"
              value={fecha}
              max={hoyAR}
              onChange={(e) => {
                if (e.target.value) setFecha(e.target.value);
              }}
            />
          </label>
          <Boton
            chico
            variante="fantasma"
            aria-label="Día siguiente"
            icono={<ChevronRight aria-hidden size={20} />}
            disabled={fecha >= hoyAR}
            onClick={() => {
              setFecha(sumarDias(fecha, 1));
            }}
          />
          {fecha !== hoyAR ? (
            <Boton
              chico
              variante="fantasma"
              onClick={() => {
                setFecha(hoyAR);
              }}
            >
              Hoy
            </Boton>
          ) : null}
        </div>
      </Encabezado>
      <p className="encabezado-fecha">{fecha === hoyAR ? `Hoy, ${fechaLarga(fecha)}` : fechaLarga(fecha)}</p>

      {dia.estado === 'error' ? (
        <Aviso titulo="No pudimos cargar la planilla" accion={<Boton onClick={recargar}>Reintentar</Boton>}>
          {dia.mensaje}
        </Aviso>
      ) : null}

      {!datos && dia.estado === 'cargando' ? <Cargando texto="Cargando la planilla…" /> : null}

      {datos ? (
        <div className="planilla" aria-busy={dia.estado === 'cargando'}>
          <Resumen datos={datos} veImportes={veImportes} />
          {datos.resumen.porFormaPago.length ? <Caja datos={datos} veImportes={veImportes} /> : null}
          {datos.lavados.length === 0 ? (
            <Vacio
              titulo={fecha === hoyAR ? 'Todavía no hay lavados hoy' : 'Ese día no hay lavados registrados'}
              accion={
                <Link to="/registrar" className="btn btn-primario">
                  <Plus aria-hidden size={20} />
                  Registrar lavado
                </Link>
              }
            >
              Cada lavado que se registre aparece acá con su número, en el orden en que se anotó.
            </Vacio>
          ) : (
            <Lista
              lavados={datos.lavados}
              nombresServicio={nombresServicio}
              veImportes={veImportes}
              corrige={corrige}
              borra={borra}
              comprobantes={comprobantes}
              equipo={equipo.datos ?? []}
              catalogo={catalogo.datos ?? []}
              onCambio={(t) => {
                actualizarDia((prev) => ({ ...prev, lavados: prev.lavados.map((l) => (l.id === t.id ? t : l)) }));
                recargar();
              }}
              onBorrado={() => {
                recargar();
              }}
            />
          )}
        </div>
      ) : null}
    </>
  );
}

/** Una cifra que, si cambia mientras se mira (llegó un lavado, se corrigió un monto), cuenta hasta el valor nuevo. */
function Cifra({ valor, formato = String }: { valor: number; formato?: (n: number) => string }) {
  return <>{formato(useContador(valor))}</>;
}

function Resumen({ datos, veImportes }: { datos: PlanillaDelDia; veImportes: boolean }) {
  const { resumen } = datos;
  const lider = resumen.porTrabajador[0];
  const listaRef = useRef<HTMLOListElement>(null);
  // El ranking se reordena deslizándose cuando alguien pasa adelante.
  useFlip(listaRef, resumen.porTrabajador.map((r) => r.trabajador?.id ?? '-').join(','));
  return (
    <section className="resumen hoja" aria-labelledby="resumen-titulo">
      <h2 id="resumen-titulo" className="solo-lectores">
        Resumen del día
      </h2>
      <dl className="resumen-cifras">
        <div>
          <dt>Lavados</dt>
          <dd className="cifra">
            <Cifra valor={resumen.cantidad} />
          </dd>
        </div>
        {veImportes && resumen.total !== null ? (
          <div>
            <dt>Cobrado</dt>
            <dd className="cifra">
              <Cifra valor={resumen.total} formato={pesos} />
            </dd>
          </div>
        ) : null}
        {veImportes && resumen.sinMonto > 0 ? (
          <div>
            <dt>Sin monto</dt>
            <dd className="cifra cifra-alerta">{resumen.sinMonto}</dd>
          </div>
        ) : null}
      </dl>

      {resumen.porTrabajador.length ? (
        <div className="ranking">
          <h3 className="ranking-titulo">Quién lavó más</h3>
          <ol className="ranking-lista" ref={listaRef}>
            {resumen.porTrabajador.map((r, i) => {
              const ancho = lider ? Math.max(0.08, r.cantidad / lider.cantidad) : 0;
              const clave = r.trabajador?.id ?? 'sin-asignar';
              return (
                <li key={clave} data-flip={clave} className="ranking-fila" data-primero={i === 0 ? '' : undefined}>
                  <span className="ranking-puesto">{i + 1}</span>
                  <span className="ranking-nombre">{r.trabajador?.nombre ?? 'Sin asignar'}</span>
                  <span className="ranking-barra" aria-hidden>
                    <span style={{ transform: `scaleX(${String(ancho)})` }} />
                  </span>
                  <span className="ranking-cantidad">
                    {r.cantidad} {r.cantidad === 1 ? 'lavado' : 'lavados'}
                  </span>
                  {veImportes && r.total !== null ? <span className="ranking-total">{pesos(r.total)}</span> : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

/** Cierre de caja: cuánto entró por cada forma de pago. El empleado ve solo cuántos lavados, nunca importes. */
function Caja({ datos, veImportes }: { datos: PlanillaDelDia; veImportes: boolean }) {
  const { porFormaPago, total, sinMonto } = datos.resumen;
  const conImportes = veImportes && total !== null;
  const titulo = conImportes ? 'Caja del día' : 'Cómo pagaron';
  return (
    <section className="caja hoja" aria-labelledby="caja-titulo">
      <h2 id="caja-titulo" className="caja-titulo">
        {titulo}
      </h2>
      <table className="caja-tabla">
        <thead className="solo-lectores">
          <tr>
            <th scope="col">Forma de pago</th>
            <th scope="col">Lavados</th>
            {conImportes ? <th scope="col">Total</th> : null}
          </tr>
        </thead>
        <tbody>
          {porFormaPago.map((f) => (
            <tr key={f.formaPago ?? 'sin-indicar'} data-sin-indicar={f.formaPago === null ? '' : undefined}>
              <th scope="row" className="caja-forma">
                {f.formaPago === null ? 'Sin indicar' : NOMBRE_PAGO[f.formaPago]}
              </th>
              <td className="caja-cantidad">
                {f.cantidad} {f.cantidad === 1 ? 'lavado' : 'lavados'}
              </td>
              {conImportes ? <td className="caja-importe">{f.total === null ? '' : pesos(f.total)}</td> : null}
            </tr>
          ))}
        </tbody>
        {conImportes ? (
          <tfoot>
            <tr>
              <th scope="row" className="caja-forma">
                Total cobrado
              </th>
              <td className="caja-cantidad">
                {datos.resumen.cantidad} {datos.resumen.cantidad === 1 ? 'lavado' : 'lavados'}
              </td>
              <td className="caja-importe">
                <Cifra valor={total} formato={pesos} />
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
      {conImportes && sinMonto > 0 ? (
        <p className="caja-nota">
          {sinMonto === 1 ? '1 lavado no tiene monto cargado y no suma.' : `${String(sinMonto)} lavados no tienen monto cargado y no suman.`}
        </p>
      ) : null}
    </section>
  );
}

interface ListaProps {
  lavados: Turno[];
  nombresServicio: Map<string, string>;
  veImportes: boolean;
  corrige: boolean;
  borra: boolean;
  comprobantes: boolean;
  equipo: Trabajador[];
  catalogo: Servicio[];
  onCambio: (t: Turno) => void;
  onBorrado: (id: string) => void;
}

function Lista(props: ListaProps) {
  const { lavados } = props;
  const numerados = lavados.map((l, i) => ({ lavado: l, numero: i + 1 }));
  // Al abrir un día, las copias entran escalonadas (tope: las primeras 8, así nunca se espera de más).
  let orden = 0;
  const manana = numerados.filter((n) => n.lavado.franja === 'manana');
  const tarde = numerados.filter((n) => n.lavado.franja === 'tarde');
  return (
    <>
      {[
        { clave: 'manana' as const, filas: manana },
        { clave: 'tarde' as const, filas: tarde },
      ]
        .filter((g) => g.filas.length)
        .map((g) => {
          const sub = g.filas.reduce((acc, f) => acc + (f.lavado.monto ?? 0), 0);
          return (
            <section key={g.clave} className="franja" aria-labelledby={`franja-${g.clave}`}>
              <h2 id={`franja-${g.clave}`} className="franja-titulo">
                <span>{NOMBRE_FRANJA[g.clave]}</span>
                <span className="franja-total">
                  {g.filas.length} {g.filas.length === 1 ? 'lavado' : 'lavados'}
                  {props.veImportes ? ` · ${pesos(sub)}` : ''}
                </span>
              </h2>
              <ol className="copias">
                {g.filas.map((f) => (
                  <Copia key={f.lavado.id} numero={f.numero} orden={Math.min(orden++, 8)} {...props} lavado={f.lavado} />
                ))}
              </ol>
            </section>
          );
        })}
    </>
  );
}

type Modo = 'ver' | 'corregir' | 'comprobante' | 'nota';

function Copia({ lavado, numero, orden, nombresServicio, veImportes, corrige, borra, comprobantes, equipo, catalogo, onCambio, onBorrado }: ListaProps & { lavado: Turno; numero: number; orden: number }) {
  const usuario = useUsuario();
  const [modo, setModo] = useState<Modo>('ver');
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const servicio = nombresDelTurno(lavado, nombresServicio);
  const cliente = lavado.nombre !== NOMBRE_MOSTRADOR ? lavado.nombre : null;
  const tituloId = `copia-${lavado.id}`;

  const borrar = async () => {
    setBorrando(true);
    setError(null);
    try {
      await ep.borrarTurno(lavado.id);
      setConfirmando(false);
      onBorrado(lavado.id);
    } catch (err) {
      setConfirmando(false);
      setError(mensajeDeError(err));
    } finally {
      setBorrando(false);
    }
  };

  return (
    <li className="copia" aria-labelledby={tituloId} style={{ '--orden': orden } as CSSProperties}>
      <div className="copia-cabeza">
        <span className="copia-serie" aria-label={`Lavado número ${numero}`}>
          N° {serie(numero)}
        </span>
        <span className="copia-hora">{hora(lavado.createdAt)}</span>
        {veImportes ? (
          <span className={`copia-monto ${lavado.monto === null ? 'copia-monto-falta' : ''}`}>
            {lavado.monto === null ? 'Sin monto' : pesos(lavado.monto)}
          </span>
        ) : null}
      </div>
      <p className="copia-servicio" id={tituloId}>
        {servicio}
      </p>
      <p className="copia-detalle">
        {NOMBRE_VEHICULO[lavado.vehiculoTipo]}
        {lavado.vehiculoModelo ? ` · ${lavado.vehiculoModelo}` : ''}
        {cliente ? ` · ${cliente}` : ''}
        {lavado.formaPago ? (
          <span className="copia-pago">{NOMBRE_PAGO[lavado.formaPago]}</span>
        ) : corrige ? (
          <span className="copia-pago copia-pago-falta">Pago sin indicar</span>
        ) : null}
      </p>
      <p className="copia-trabajador">
        Lavó: <strong>{lavado.trabajador?.nombre ?? 'Sin asignar'}</strong>
        {lavado.origen === 'web' ? <span className="etiqueta">Turno web</span> : null}
      </p>
      {lavado.notasInternas ? <p className="copia-nota">{lavado.notasInternas}</p> : null}

      {error ? <Aviso>{error}</Aviso> : null}

      {modo === 'ver' ? (
        <div className="copia-acciones">
          {corrige ? (
            <Boton chico variante="fantasma" icono={<Pencil aria-hidden size={18} />} onClick={() => { setModo('corregir'); setError(null); }}>
              Corregir
            </Boton>
          ) : (
            <Boton chico variante="fantasma" icono={<Pencil aria-hidden size={18} />} onClick={() => { setModo('nota'); setError(null); }}>
              {lavado.notasInternas ? 'Editar nota' : 'Agregar nota'}
            </Boton>
          )}
          {comprobantes && lavado.monto !== null ? (
            <Boton chico variante="fantasma" icono={<FileDown aria-hidden size={18} />} onClick={() => { setModo('comprobante'); setError(null); }}>
              Comprobante
            </Boton>
          ) : null}
          {borra ? (
            <Boton chico variante="fantasma" className="btn-texto-peligro" icono={<Trash2 aria-hidden size={18} />} onClick={() => { setConfirmando(true); }}>
              Borrar
            </Boton>
          ) : null}
        </div>
      ) : null}

      {modo === 'corregir' ? (
        <Corregir
          lavado={lavado}
          equipo={equipo}
          catalogo={catalogo}
          usuarioId={usuario.id}
          onListo={(t) => {
            setModo('ver');
            onCambio(t);
          }}
          onCancelar={() => { setModo('ver'); }}
        />
      ) : null}
      {modo === 'nota' ? (
        <EditarNota
          lavado={lavado}
          onListo={(t) => {
            setModo('ver');
            onCambio(t);
          }}
          onCancelar={() => { setModo('ver'); }}
        />
      ) : null}
      {modo === 'comprobante' ? <EmitirComprobante lavado={lavado} onCerrar={() => { setModo('ver'); }} /> : null}

      <Confirmar
        abierto={confirmando}
        titulo={`¿Borrar el lavado N° ${serie(numero)}?`}
        confirmar="Sí, borrarlo"
        ocupado={borrando}
        onConfirmar={() => void borrar()}
        onCancelar={() => { setConfirmando(false); }}
      >
        {servicio} · {NOMBRE_VEHICULO[lavado.vehiculoTipo]}. Deja de contar en la planilla, las estadísticas y el ranking. No se puede deshacer.
      </Confirmar>
    </li>
  );
}

/** Los ids de servicios de un lavado, en orden (si el backend no mandara `servicios`, el principal). */
function idsDe(lavado: Turno): string[] {
  const lista = lavado.servicios as Turno['servicios'] | undefined;
  return lista?.length ? lista.map((s) => s.id) : [lavado.servicioId];
}

function Corregir({
  lavado,
  equipo,
  catalogo,
  usuarioId,
  onListo,
  onCancelar,
}: {
  lavado: Turno;
  equipo: Trabajador[];
  catalogo: Servicio[];
  usuarioId: string;
  onListo: (t: Turno) => void;
  onCancelar: () => void;
}) {
  const originales = idsDe(lavado);
  const [servicioIds, setServicioIds] = useState<string[]>(originales);
  const [montoTexto, setMontoTexto] = useState(lavado.monto === null ? '' : miles(String(lavado.monto)));
  const [trabajadorId, setTrabajadorId] = useState(lavado.trabajador?.id ?? '');
  const [nota, setNota] = useState(lavado.notasInternas ?? '');
  const [formaPago, setFormaPago] = useState<FormaPago | null>(lavado.formaPago);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const monto = enteroDesdeTexto(montoTexto);
  // Los que se ofrecen para este vehículo, más los que ya tenía (aunque hoy estén inactivos o no se ofrezcan).
  const opciones = catalogo.filter((s) => (s.activo && s.vehiculos.includes(lavado.vehiculoTipo)) || originales.includes(s.id));
  const cambiaronServicios = servicioIds.join(',') !== originales.join(',');
  const elegidos = servicioIds.map((id) => catalogo.find((s) => s.id === id)).filter((s) => s !== undefined);
  const lista = sumaDeLista(elegidos, lavado.vehiculoTipo);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    // Solo viaja lo que se cambió: así no se pisa un monto que cargó otra persona mientras tanto, y no se vuelve a
    // mandar quién lavó (el backend rechaza a alguien que ya no está activo aunque no se lo cambie).
    if (!servicioIds.length) {
      setErrores({ servicioIds: 'Tiene que quedar al menos un servicio.' });
      return;
    }
    const cambio: CambioTurno = {};
    if (cambiaronServicios) cambio.servicioIds = servicioIds;
    if (monto !== lavado.monto) cambio.monto = monto;
    const trabajador = trabajadorId || null;
    if (trabajador !== (lavado.trabajador?.id ?? null)) cambio.trabajadorId = trabajador;
    const notaNueva = nota.trim() || null;
    if (notaNueva !== (lavado.notasInternas ?? null)) cambio.notasInternas = notaNueva;
    if (formaPago !== lavado.formaPago) cambio.formaPago = formaPago;
    if (Object.keys(cambio).length === 0) {
      onCancelar();
      return;
    }
    setGuardando(true);
    setError(null);
    setErrores({});
    try {
      const { booking } = await ep.corregirTurno(lavado.id, cambio);
      onListo(booking);
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        const campos = { ...err.fields };
        if (campos.servicioId && !campos.servicioIds) campos.servicioIds = campos.servicioId;
        setErrores(campos);
      }
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  const enEquipo = equipo.some((t) => t.id === lavado.trabajador?.id);

  return (
    <form className="copia-form formulario" onSubmit={(e) => void guardar(e)} noValidate>
      {error ? <Aviso>{error}</Aviso> : null}
      {opciones.length ? (
        <ElegirServicios
          servicios={opciones}
          vehiculo={lavado.vehiculoTipo}
          elegidos={servicioIds}
          onCambio={(ids) => {
            setServicioIds(ids);
            setErrores((e) => ({ ...e, servicioIds: '' }));
          }}
          vePrecios
          pegajoso={false}
          error={errores.servicioIds || undefined}
          ayuda={
            cambiaronServicios && lista.total > 0
              ? `Con estos servicios la lista da ${pesos(lista.total)}. El monto no cambia solo.`
              : undefined
          }
        />
      ) : null}
      <Campo
        etiqueta="Monto cobrado"
        prefijo="$"
        inputMode="numeric"
        value={montoTexto}
        onChange={(e) => { setMontoTexto(miles(e.target.value)); }}
        error={errores.monto}
        ayuda={
          lavado.monto !== null && monto === null
            ? `Al guardar se borra el monto cargado (${pesos(lavado.monto)}).`
            : 'Vacío = sin monto cargado.'
        }
      />
      <Segmentado
        leyenda="Forma de pago"
        nombre={`forma-${lavado.id}`}
        variante="fichas"
        valor={formaPago}
        onCambio={setFormaPago}
        onQuitar={() => {
          setFormaPago(null);
        }}
        error={errores.formaPago}
        ayuda={formaPago === null ? 'Sin indicar. Tocá una para cargarla.' : 'Tocá la elegida de nuevo para dejarla sin indicar.'}
        opciones={FORMAS_PAGO.map((f) => ({ valor: f, etiqueta: NOMBRE_PAGO[f] }))}
      />
      <Selector etiqueta="Quién lo lavó" value={trabajadorId} onChange={(e) => { setTrabajadorId(e.target.value); }} error={errores.trabajadorId}>
        <option value="">Sin asignar</option>
        {lavado.trabajador && !enEquipo ? (
          <option value={lavado.trabajador.id}>{lavado.trabajador.nombre}</option>
        ) : null}
        {equipo.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nombre}
            {t.id === usuarioId ? ' (vos)' : ''}
          </option>
        ))}
      </Selector>
      <AreaTexto etiqueta="Nota" value={nota} maxLength={1000} onChange={(e) => { setNota(e.target.value); }} error={errores.notasInternas} />
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>
          Guardar cambios
        </Boton>
      </div>
    </form>
  );
}

function EditarNota({ lavado, onListo, onCancelar }: { lavado: Turno; onListo: (t: Turno) => void; onCancelar: () => void }) {
  const [nota, setNota] = useState(lavado.notasInternas ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const { booking } = await ep.corregirTurno(lavado.id, { notasInternas: nota.trim() || null });
      onListo(booking);
    } catch (err) {
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="copia-form formulario" onSubmit={(e) => void guardar(e)} noValidate>
      {error ? <Aviso>{error}</Aviso> : null}
      <AreaTexto etiqueta="Nota" value={nota} maxLength={1000} onChange={(e) => { setNota(e.target.value); }} ayuda="El cliente no la ve." />
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>
          Guardar nota
        </Boton>
      </div>
    </form>
  );
}

function EmitirComprobante({ lavado, onCerrar }: { lavado: Turno; onCerrar: () => void }) {
  // La del lavado si ya la tiene (el backend usa esa misma si no se manda otra).
  const [formaPago, setFormaPago] = useState<FormaPago>(lavado.formaPago ?? 'efectivo');
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const emitir = async (e: SyntheticEvent) => {
    e.preventDefault();
    setTrabajando(true);
    setError(null);
    try {
      const { comprobante } = await ep.emitirComprobante(lavado.id, formaPago);
      await abrirPdf(() => ep.pdfComprobante(comprobante.id), `Comprobante-${comprobante.codigo}.pdf`);
      onCerrar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <form className="copia-form formulario" onSubmit={(e) => void emitir(e)} noValidate>
      {error ? <Aviso>{error}</Aviso> : null}
      <Selector
        etiqueta="Forma de pago"
        value={formaPago}
        onChange={(e) => { setFormaPago(e.target.value as FormaPago); }}
        ayuda="Si el lavado ya tenía comprobante, se abre el mismo (no se emite otro). No es una factura."
      >
        {FORMAS_PAGO.map((f) => (
          <option key={f} value={f}>
            {NOMBRE_PAGO[f]}
          </option>
        ))}
      </Selector>
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCerrar} disabled={trabajando}>
          Cancelar
        </Boton>
        <Boton type="submit" variante="primario" cargando={trabajando} icono={<FileDown aria-hidden size={18} />}>
          Emitir y abrir PDF
        </Boton>
      </div>
    </form>
  );
}
