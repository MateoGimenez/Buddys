import { ChevronDown, ClipboardList, CloudOff, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, mensajeDeError } from '../api/client';
import * as ep from '../api/endpoints';
import {
  FORMAS_PAGO,
  VEHICULOS,
  type FormaPago,
  type Franja,
  type NuevoLavado,
  type VehiculoTipo,
} from '../api/types';
import { ElegirServicios, Tilde } from '../components/ElegirServicios';
import { nombreDe } from '../components/Layout';
import { AreaTexto, Aviso, Boton, Campo, Cargando, Encabezado, Segmentado, Vacio } from '../components/ui';
import { encolarLavado, enviarCola, nuevoIdLocal } from '../lib/cola';
import {
  NOMBRE_FRANJA,
  NOMBRE_PAGO,
  NOMBRE_VEHICULO,
  cuantosServicios,
  enteroDesdeTexto,
  fechaLarga,
  franjaSegunHora,
  hoy,
  miles,
  nombresDelTurno,
  pesos,
  sumaDeLista,
  sumarDias,
  unirServicios,
} from '../lib/format';
import { useCarga } from '../lib/useCarga';
import { useUsuario } from '../session/SessionContext';

const MONTO_MAX = 99_999_999;
const DIAS_ATRAS = 31;
const CAMPOS_PLEGADOS = ['fecha', 'franja', 'nombre', 'telefono', 'vehiculoModelo', 'notasInternas'];
/** Cuánto se ofrece "Deshacer" en pantalla. El backend deja hasta deshacerHasta: se usa lo que llegue primero. */
export const VENTANA_DESHACER_MS = 10_000;

const MENSAJE_SIN_GUARDAR =
  'No hay conexión y este celular no deja guardar el lavado. Anotalo en papel y cargalo cuando vuelva la señal.';

/** Hasta cuándo se ofrece "Deshacer": la ventana de la UI o lo que diga el backend, lo que llegue primero. */
function limiteParaDeshacer(deshacerHasta: string): number {
  const ventana = Date.now() + VENTANA_DESHACER_MS;
  const hasta = Date.parse(deshacerHasta);
  return Number.isFinite(hasta) ? Math.min(hasta, ventana) : ventana;
}

type FranjaElegida = 'auto' | Franja;

interface Registrado {
  /** Distinta en cada registro: el talón arranca de cero. */
  clave: string;
  /** "Nivel II + Motor". */
  servicio: string;
  vehiculoTipo: VehiculoTipo;
  vehiculoModelo: string | null;
  formaPago: FormaPago | null;
  montoCargado: number | null;
  envio: { tipo: 'enviado'; id: string; deshacerLimite: number } | { tipo: 'en-cola' };
}

export function Registrar() {
  const usuario = useUsuario();
  // El empleado nunca ve montos ni precios de lista (los carga, pero no se le sugieren).
  const veImportes = usuario.rol !== 'empleado';
  const hoyAR = hoy();

  const [catalogo, recargarCatalogo] = useCarga(() => ep.servicios().then((r) => r.servicios), []);

  const [vehiculo, setVehiculo] = useState<VehiculoTipo>('auto');
  /** En el orden en que se tocaron: el primero es el principal. */
  const [servicioIds, setServicioIds] = useState<string[]>([]);
  const [montoTexto, setMontoTexto] = useState('');
  /** true si el monto lo escribió la persona: entonces la suma de lista ya no lo pisa. */
  const [montoManual, setMontoManual] = useState(false);
  /** Lo que se sacó al cambiar de vehículo, para avisarlo. */
  const [sacados, setSacados] = useState<string[]>([]);
  const [formaPago, setFormaPago] = useState<FormaPago | null>(null);
  const [abierto, setAbierto] = useState(false);
  // null = "hoy": así, si la pantalla queda abierta de un día para el otro, el lavado no se anota con la fecha de ayer.
  const [fechaElegida, setFechaElegida] = useState<string | null>(null);
  const fecha = fechaElegida ?? hoyAR;
  const [franja, setFranja] = useState<FranjaElegida>('auto');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [modelo, setModelo] = useState('');
  const [nota, setNota] = useState('');

  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [registrado, setRegistrado] = useState<Registrado | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Traba sincrónica contra el doble toque: el botón deshabilitado llega recién en el próximo render.
  const enviandoRef = useRef(false);

  const activos = useMemo(() => (catalogo.datos ?? []).filter((x) => x.activo), [catalogo.datos]);
  const ofrecidos = useMemo(() => activos.filter((x) => x.vehiculos.includes(vehiculo)), [activos, vehiculo]);
  const elegidos = useMemo(
    () => servicioIds.map((id) => ofrecidos.find((x) => x.id === id)).filter((x) => x !== undefined),
    [servicioIds, ofrecidos],
  );
  // El empleado nunca ve montos: ni la suma ni el precio de cada uno.
  const lista = veImportes ? sumaDeLista(elegidos, vehiculo) : null;

  /** Pone la suma de lista en el monto, salvo que la persona ya haya escrito uno. */
  const sugerir = (ids: string[], v: VehiculoTipo) => {
    if (!veImportes || (montoManual && montoTexto !== '')) return;
    const servicios = ids.map((id) => activos.find((x) => x.id === id)).filter((x) => x !== undefined);
    const { total } = sumaDeLista(servicios, v);
    setMontoTexto(total > 0 ? miles(String(total)) : '');
    setMontoManual(false);
  };

  const elegirVehiculo = (v: VehiculoTipo) => {
    setVehiculo(v);
    const quedan = servicioIds.filter((id) => activos.find((x) => x.id === id)?.vehiculos.includes(v));
    const fuera = servicioIds.filter((id) => !quedan.includes(id));
    setSacados(fuera.map((id) => activos.find((x) => x.id === id)?.nombre ?? id));
    if (fuera.length) setServicioIds(quedan);
    sugerir(quedan, v);
    setErrores((e) => ({ ...e, vehiculoTipo: '' }));
  };

  const elegirServicios = (ids: string[]) => {
    setServicioIds(ids);
    setSacados([]);
    sugerir(ids, vehiculo);
    setErrores((e) => ({ ...e, servicioIds: '' }));
  };

  const limpiar = () => {
    setServicioIds([]);
    setSacados([]);
    setMontoTexto('');
    setMontoManual(false);
    setFormaPago(null);
    setFechaElegida(null);
    setFranja('auto');
    setNombre('');
    setTelefono('');
    setModelo('');
    setNota('');
    setAbierto(false);
    setErrores({});
  };

  const enviar = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (enviandoRef.current) return;
    setErrorGeneral(null);
    const locales: Record<string, string> = {};
    if (!elegidos.length) locales.servicioIds = 'Elegí qué servicios se hicieron.';
    const monto = enteroDesdeTexto(montoTexto);
    if (monto !== null && monto > MONTO_MAX) locales.monto = `El monto puede ser hasta ${pesos(MONTO_MAX)}.`;
    if (fecha && (fecha > hoyAR || fecha < sumarDias(hoyAR, -DIAS_ATRAS))) {
      locales.fecha = `Elegí una fecha de los últimos ${DIAS_ATRAS} días (no futura).`;
    }
    if (Object.keys(locales).length) {
      setErrores(locales);
      if (locales.fecha) setAbierto(true);
      enfocarPrimerError();
      return;
    }

    // Un idLocal por envío: si la respuesta se pierde y el lavado termina en la cola, se reintenta con el mismo y el
    // backend no lo duplica.
    const idLocal = nuevoIdLocal();
    const datos: NuevoLavado & { idLocal: string } = {
      servicioIds: elegidos.map((x) => x.id),
      vehiculoTipo: vehiculo,
      monto,
      idLocal,
    };
    const nombres = unirServicios(elegidos.map((x) => x.nombre));
    if (formaPago) datos.formaPago = formaPago;
    if (fecha && fecha !== hoyAR) datos.fecha = fecha;
    if (franja !== 'auto') datos.franja = franja;
    if (nombre.trim()) datos.nombre = nombre.trim();
    if (telefono.trim()) datos.telefono = telefono.trim();
    if (modelo.trim()) datos.vehiculoModelo = modelo.trim();
    if (nota.trim()) datos.notasInternas = nota.trim();

    const base = {
      servicio: nombres,
      vehiculoTipo: vehiculo,
      vehiculoModelo: datos.vehiculoModelo ?? null,
      formaPago,
      montoCargado: monto,
    };
    const listo = (r: Registrado) => {
      setRegistrado(r);
      limpiar();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    // Sin señal: queda guardado en el celular con la fecha y la franja de este momento, y sale solo cuando vuelve.
    const guardarSinConexion = () => {
      const paraDespues = { ...datos, fecha, franja: datos.franja ?? franjaSegunHora() };
      if (!encolarLavado(usuario.id, paraDespues, nombres)) {
        setErrorGeneral(MENSAJE_SIN_GUARDAR);
        return;
      }
      listo({
        ...base,
        clave: `cola-${String(Date.now())}`,
        envio: { tipo: 'en-cola' },
      });
    };

    if (!navigator.onLine) {
      guardarSinConexion();
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    setErrores({});
    try {
      const { lavado, deshacerHasta } = await ep.registrarLavado(datos);
      listo({
        ...base,
        // Los nombres como los guardó el backend; si no los mandara, los de acá.
        servicio: nombresDelTurno(lavado, new Map([[lavado.servicioId, nombres]])),
        clave: lavado.id,
        vehiculoModelo: lavado.vehiculoModelo,
        formaPago: lavado.formaPago,
        envio: { tipo: 'enviado', id: lavado.id, deshacerLimite: limiteParaDeshacer(deshacerHasta) },
      });
      // Si quedó algo guardado sin conexión, ya hay señal: que salga.
      void enviarCola(usuario.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK') {
        guardarSinConexion();
        return;
      }
      if (err instanceof ApiError && err.fields) {
        const campos = { ...err.fields };
        // El error de servicios puede venir como servicioIds o (backend viejo) servicioId: va al mismo lugar.
        if (campos.servicioId && !campos.servicioIds) campos.servicioIds = campos.servicioId;
        setErrores(campos);
        if (Object.keys(campos).some((k) => CAMPOS_PLEGADOS.includes(k))) setAbierto(true);
        enfocarPrimerError();
      }
      setErrorGeneral(mensajeDeError(err));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const enfocarPrimerError = () => {
    requestAnimationFrame(() => {
      const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], fieldset[data-error] input');
      el?.focus();
    });
  };

  const ayudaMonto = (): string => {
    if (!lista) return 'Si no sabés cuánto se cobró, dejalo vacío: lo completa un encargado.';
    if (!elegidos.length) return 'Si todavía no se cobró, dejalo vacío y cargalo después desde la planilla.';
    const consultar = lista.aConsultar.length
      ? ` ${unirServicios(lista.aConsultar.map((x) => x.nombre))} no ${lista.aConsultar.length === 1 ? 'tiene' : 'tienen'} precio de lista: sumalo a mano.`
      : '';
    const monto = enteroDesdeTexto(montoTexto);
    if (montoManual && lista.total > 0 && monto !== lista.total) return `Lo cambiaste a mano: la lista da ${pesos(lista.total)}.${consultar}`;
    if (lista.total > 0) return `Suma de lista. Cambiala si se cobró otra cosa.${consultar}`;
    return `Poné lo que se cobró.${consultar}`;
  };

  if (catalogo.estado === 'cargando' && !catalogo.datos) {
    return (
      <>
        <Encabezado titulo="Registrar lavado" />
        <Cargando texto="Cargando servicios…" forma="formulario" />
      </>
    );
  }

  if (catalogo.estado === 'error' && !catalogo.datos) {
    return (
      <>
        <Encabezado titulo="Registrar lavado" />
        <Aviso titulo="No pudimos cargar los servicios" accion={<Boton onClick={recargarCatalogo}>Reintentar</Boton>}>
          {catalogo.mensaje}
        </Aviso>
      </>
    );
  }

  return (
    <>
      <Encabezado titulo="Registrar lavado">
        <p className="encabezado-fecha">{fecha === hoyAR ? `Hoy, ${fechaLarga(hoyAR)}` : fechaLarga(fecha)}</p>
      </Encabezado>

      {registrado ? (
        <Talon
          key={registrado.clave}
          registrado={registrado}
          veMonto={veImportes}
          onCerrar={() => {
            setRegistrado(null);
          }}
        />
      ) : null}

      {errorGeneral ? <Aviso titulo="No se registró el lavado">{errorGeneral}</Aviso> : null}

      <form ref={formRef} className="hoja formulario" onSubmit={(e) => void enviar(e)} noValidate>
        <Segmentado
          leyenda="Vehículo"
          nombre="vehiculo"
          valor={vehiculo}
          onCambio={elegirVehiculo}
          error={errores.vehiculoTipo || undefined}
          opciones={VEHICULOS.map((v) => ({ valor: v, etiqueta: NOMBRE_VEHICULO[v] }))}
        />

        {sacados.length ? (
          <p className="servicios-sacados" role="status">
            Se sacó {unirServicios(sacados)}: no se {sacados.length === 1 ? 'ofrece' : 'ofrecen'} para{' '}
            {NOMBRE_VEHICULO[vehiculo]}.
          </p>
        ) : null}

        {ofrecidos.length ? (
          <ElegirServicios
            servicios={ofrecidos}
            vehiculo={vehiculo}
            elegidos={servicioIds}
            onCambio={elegirServicios}
            vePrecios={veImportes}
            error={errores.servicioIds || undefined}
            ayuda="Marcá todos los que se hicieron. Tocá de nuevo para sacar uno."
          />
        ) : (
          <Vacio titulo={`No hay servicios activos para ${NOMBRE_VEHICULO[vehiculo]}`}>
            {usuario.rol === 'empleado'
              ? 'Avisale al encargado para que active uno en Servicios.'
              : 'Activá uno o sumale este vehículo desde Servicios.'}
          </Vacio>
        )}

        <Campo
          etiqueta="Cuánto se cobró"
          prefijo="$"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          name="monto"
          placeholder="0"
          value={montoTexto}
          onChange={(e) => {
            const texto = miles(e.target.value);
            setMontoTexto(texto);
            setMontoManual(texto !== '');
          }}
          error={errores.monto || undefined}
          ayuda={ayudaMonto()}
        />

        <Segmentado
          leyenda="Cómo pagó"
          nombre="formaPago"
          variante="fichas"
          valor={formaPago}
          onCambio={setFormaPago}
          onQuitar={() => {
            setFormaPago(null);
          }}
          error={errores.formaPago || undefined}
          ayuda="Opcional. Si te equivocaste, tocala de nuevo y se saca."
          opciones={FORMAS_PAGO.map((f) => ({ valor: f, etiqueta: NOMBRE_PAGO[f] }))}
        />

        <p className="dato-fijo">
          <span className="dato-fijo-etiqueta">Registrado por</span>
          <span>Vos, {nombreDe(usuario)}</span>
        </p>

        <details
          className="plegable"
          open={abierto}
          onToggle={(e) => {
            setAbierto(e.currentTarget.open);
          }}
        >
          <summary>
            <span>Más datos</span>
            <span className="plegable-ayuda">Fecha, franja, cliente, patente, nota</span>
            <ChevronDown aria-hidden size={20} className="plegable-flecha" />
          </summary>
          <div className="plegable-cuerpo">
            <Campo
              etiqueta="Fecha"
              type="date"
              name="fecha"
              min={sumarDias(hoyAR, -DIAS_ATRAS)}
              max={hoyAR}
              value={fecha}
              onChange={(e) => {
                const v = e.target.value;
                setFechaElegida(v && v !== hoyAR ? v : null);
              }}
              error={errores.fecha || undefined}
              ayuda={`Si te olvidaste de anotarlo: hasta ${DIAS_ATRAS} días atrás.`}
            />
            <Segmentado
              leyenda="Franja"
              nombre="franja"
              valor={franja}
              onCambio={setFranja}
              error={errores.franja || undefined}
              opciones={[
                { valor: 'auto', etiqueta: 'Según la hora' },
                { valor: 'manana', etiqueta: NOMBRE_FRANJA.manana },
                { valor: 'tarde', etiqueta: NOMBRE_FRANJA.tarde },
              ]}
            />
            <Campo
              etiqueta="Nombre del cliente"
              name="nombre"
              autoComplete="off"
              maxLength={80}
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value);
              }}
              error={errores.nombre || undefined}
            />
            <Campo
              etiqueta="Teléfono"
              type="tel"
              name="telefono"
              inputMode="tel"
              autoComplete="off"
              maxLength={20}
              value={telefono}
              onChange={(e) => {
                setTelefono(e.target.value);
              }}
              error={errores.telefono || undefined}
              ayuda="Sirve para ver el historial del cliente."
            />
            <Campo
              etiqueta="Modelo o patente"
              name="vehiculoModelo"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={80}
              value={modelo}
              onChange={(e) => {
                setModelo(e.target.value);
              }}
              error={errores.vehiculoModelo || undefined}
            />
            <AreaTexto
              etiqueta="Nota"
              name="notasInternas"
              maxLength={1000}
              value={nota}
              onChange={(e) => {
                setNota(e.target.value);
              }}
              error={errores.notasInternas || undefined}
              ayuda="Algo para acordarse de este lavado: un detalle del auto, un pedido del cliente. El cliente no la ve."
            />
          </div>
        </details>

        <div className="pie-fijo">
          {elegidos.length ? (
            <p className="pie-resumen">
              <span key={elegidos.length} className="pie-resumen-cuenta">
                {cuantosServicios(elegidos.length)}
              </span>
              {lista && lista.total > 0 ? <span> · {pesos(lista.total)} de lista</span> : null}
              {lista?.aConsultar.length ? <span className="pie-resumen-consultar"> · {lista.aConsultar.length} a consultar</span> : null}
            </p>
          ) : null}
          <Boton type="submit" variante="primario" cargando={enviando} className="btn-ancho btn-grande" disabled={!ofrecidos.length || enviando}>
            {enviando ? 'Registrando…' : 'Registrar lavado'}
          </Boton>
        </div>
      </form>
    </>
  );
}

/* ------------------------------------------------------------------ Talón del lavado recién anotado */

function Talon({
  registrado,
  veMonto,
  onCerrar,
}: {
  registrado: Registrado;
  veMonto: boolean;
  onCerrar: () => void;
}) {
  const { envio } = registrado;
  const limite = envio.tipo === 'enviado' ? envio.deshacerLimite : 0;
  const [ahora, setAhora] = useState(() => Date.now());
  const [estado, setEstado] = useState<'listo' | 'deshaciendo' | 'deshecho'>('listo');
  const [ofrece, setOfrece] = useState(envio.tipo === 'enviado');
  const [error, setError] = useState<string | null>(null);
  // Traba sincrónica contra el doble toque en "Deshacer".
  const enCurso = useRef(false);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const ayudaId = useId();

  const restanteMs = Math.max(0, limite - ahora);
  const vencido = restanteMs <= 0;
  const muestraDeshacer = ofrece && (estado === 'deshaciendo' || (estado === 'listo' && !vencido));

  useEffect(() => {
    if (!ofrece || estado !== 'listo' || vencido) return;
    const t = window.setInterval(() => {
      setAhora(Date.now());
    }, 200);
    return () => {
      window.clearInterval(t);
    };
  }, [ofrece, estado, vencido]);

  useEffect(() => {
    if (estado === 'deshecho') cerrarRef.current?.focus();
  }, [estado]);

  const deshacer = async () => {
    if (enCurso.current || envio.tipo !== 'enviado') return;
    enCurso.current = true;
    setEstado('deshaciendo');
    setError(null);
    try {
      await ep.deshacerLavado(envio.id);
      setEstado('deshecho');
    } catch (err) {
      setError(mensajeDeError(err));
      setEstado('listo');
      setAhora(Date.now());
      // Sin red se puede volver a probar mientras quede tiempo; cualquier otra respuesta es definitiva.
      if (!(err instanceof ApiError && err.code === 'NETWORK')) setOfrece(false);
    } finally {
      enCurso.current = false;
    }
  };

  const vehiculo = `${NOMBRE_VEHICULO[registrado.vehiculoTipo]}${registrado.vehiculoModelo ? ` ${registrado.vehiculoModelo}` : ''}`;

  if (estado === 'deshecho') {
    return (
      <div className="talon talon-borrado" role="status" aria-live="polite">
        <Trash2 aria-hidden size={22} className="talon-icono" />
        <div className="talon-cuerpo">
          <p className="talon-titulo">Lavado borrado</p>
          <p className="talon-detalle">
            {registrado.servicio} · {vehiculo}. Ya no cuenta en la planilla y los productos que usó volvieron al stock.
          </p>
        </div>
        <div className="talon-acciones">
          <Boton ref={cerrarRef} chico variante="fantasma" icono={<X aria-hidden size={18} />} onClick={onCerrar}>
            Cerrar
          </Boton>
        </div>
      </div>
    );
  }

  const enCola = envio.tipo === 'en-cola';
  const segundos = Math.ceil(restanteMs / 1000);
  return (
    <div className="talon" data-en-cola={enCola ? '' : undefined} role="status" aria-live="polite">
      {enCola ? (
        <CloudOff aria-hidden size={22} className="talon-icono" />
      ) : (
        <span className="talon-sello" aria-hidden>
          <Tilde size={20} className="talon-tilde" />
        </span>
      )}
      <div className="talon-cuerpo">
        <p className="talon-titulo">{enCola ? 'Guardado sin conexión' : 'Lavado registrado'}</p>
        <p className="talon-detalle">
          {registrado.servicio} · {vehiculo}
          {registrado.formaPago ? ` · ${NOMBRE_PAGO[registrado.formaPago]}` : ''}
          {veMonto && registrado.montoCargado !== null ? ` · ${pesos(registrado.montoCargado)}` : ''}
        </p>
        {enCola ? <p className="talon-cola">Se envía solo cuando vuelva la señal.</p> : null}
      </div>
      <div className="talon-acciones">
        {muestraDeshacer ? (
          <Boton
            chico
            variante="secundario"
            className="talon-deshacer"
            cargando={estado === 'deshaciendo'}
            icono={<Undo2 aria-hidden size={18} />}
            aria-describedby={ayudaId}
            onClick={() => void deshacer()}
          >
            {estado === 'deshaciendo' ? 'Deshaciendo…' : 'Deshacer'}
            {estado === 'listo' ? (
              <span className="talon-cuenta" aria-hidden>
                {segundos} s
              </span>
            ) : null}
          </Boton>
        ) : null}
        {enCola ? null : (
          <Link to="/planilla" className="btn btn-fantasma btn-chico" viewTransition>
            <ClipboardList aria-hidden size={18} />
            Ver planilla
          </Link>
        )}
      </div>
      {muestraDeshacer ? (
        <>
          <span id={ayudaId} className="solo-lectores">
            Si lo anotaste por error, tenés unos segundos para borrarlo.
          </span>
          <span className="talon-plazo" aria-hidden>
            <span style={{ transform: `scaleX(${String(Math.min(1, restanteMs / VENTANA_DESHACER_MS))})` }} />
          </span>
        </>
      ) : null}
      {error ? (
        <div className="talon-error">
          <Aviso titulo="No se pudo deshacer">{error}</Aviso>
        </div>
      ) : null}
    </div>
  );
}
