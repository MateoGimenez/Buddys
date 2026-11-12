import { Check, ChevronDown, ClipboardList } from 'lucide-react';
import { useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, mensajeDeError } from '../api/client';
import * as ep from '../api/endpoints';
import { VEHICULOS, type Franja, type NuevoLavado, type Servicio, type Turno, type VehiculoTipo } from '../api/types';
import { nombreDe } from '../components/Layout';
import { AreaTexto, Aviso, Boton, Campo, Cargando, Encabezado, Segmentado, Selector, Vacio } from '../components/ui';
import {
  NOMBRE_FRANJA,
  NOMBRE_VEHICULO,
  enteroDesdeTexto,
  fechaLarga,
  hoy,
  miles,
  pesos,
  precioPara,
  sumarDias,
} from '../lib/format';
import { useCarga } from '../lib/useCarga';
import { useUsuario } from '../session/SessionContext';

const MONTO_MAX = 99_999_999;
const DIAS_ATRAS = 31;
const CAMPOS_PLEGADOS = ['fecha', 'franja', 'nombre', 'telefono', 'vehiculoModelo', 'notasInternas'];

type FranjaElegida = 'auto' | Franja;

interface Registrado {
  lavado: Turno;
  servicio: string;
  montoCargado: number | null;
}

export function Registrar() {
  const usuario = useUsuario();
  const eligeTrabajador = usuario.rol !== 'empleado';
  const hoyAR = hoy();

  const [catalogo, recargarCatalogo] = useCarga(() => ep.servicios().then((r) => r.servicios), []);
  const [equipo] = useCarga(
    () => (eligeTrabajador ? ep.trabajadores().then((r) => r.trabajadores) : Promise.resolve([])),
    [eligeTrabajador],
  );

  const [vehiculo, setVehiculo] = useState<VehiculoTipo>('auto');
  const [servicioId, setServicioId] = useState<string | null>(null);
  const [montoTexto, setMontoTexto] = useState('');
  const [montoSugerido, setMontoSugerido] = useState(false);
  const [trabajadorId, setTrabajadorId] = useState(usuario.id);
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

  const activos = useMemo(() => (catalogo.datos ?? []).filter((s) => s.activo), [catalogo.datos]);
  const ofrecidos = useMemo(() => activos.filter((s) => s.vehiculos.includes(vehiculo)), [activos, vehiculo]);
  const servicio = ofrecidos.find((s) => s.id === servicioId) ?? null;

  const elegirVehiculo = (v: VehiculoTipo) => {
    setVehiculo(v);
    const actual = activos.find((s) => s.id === servicioId);
    if (actual && !actual.vehiculos.includes(v)) {
      setServicioId(null);
      if (montoSugerido) setMontoTexto('');
    } else if (actual && montoSugerido) {
      sugerirMonto(actual, v);
    }
    setErrores((e) => ({ ...e, vehiculoTipo: '' }));
  };

  const sugerirMonto = (s: Servicio, v: VehiculoTipo) => {
    // El empleado nunca ve montos: no se le precarga el precio de lista.
    const precio = eligeTrabajador ? precioPara(s, v) : null;
    if (precio === null) {
      setMontoTexto('');
      setMontoSugerido(false);
    } else {
      setMontoTexto(miles(String(precio)));
      setMontoSugerido(true);
    }
  };

  const elegirServicio = (id: string) => {
    setServicioId(id);
    const s = ofrecidos.find((x) => x.id === id);
    if (s && (montoTexto === '' || montoSugerido)) sugerirMonto(s, vehiculo);
    setErrores((e) => ({ ...e, servicioId: '' }));
  };

  const limpiar = () => {
    setServicioId(null);
    setMontoTexto('');
    setMontoSugerido(false);
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
    if (!servicioId || !servicio) locales.servicioId = 'Elegí qué servicio se hizo.';
    const monto = enteroDesdeTexto(montoTexto);
    if (monto !== null && monto > MONTO_MAX) locales.monto = `El monto puede ser hasta ${pesos(MONTO_MAX)}.`;
    if (fecha && (fecha > hoyAR || fecha < sumarDias(hoyAR, -DIAS_ATRAS))) {
      locales.fecha = `Elegí una fecha de los últimos ${DIAS_ATRAS} días (no futura).`;
    }
    if (Object.keys(locales).length || !servicio) {
      setErrores(locales);
      if (locales.fecha) setAbierto(true);
      enfocarPrimerError();
      return;
    }

    const datos: NuevoLavado = { servicioId: servicio.id, vehiculoTipo: vehiculo, monto };
    if (eligeTrabajador && trabajadorId) datos.trabajadorId = trabajadorId;
    if (fecha && fecha !== hoyAR) datos.fecha = fecha;
    if (franja !== 'auto') datos.franja = franja;
    if (nombre.trim()) datos.nombre = nombre.trim();
    if (telefono.trim()) datos.telefono = telefono.trim();
    if (modelo.trim()) datos.vehiculoModelo = modelo.trim();
    if (nota.trim()) datos.notasInternas = nota.trim();

    enviandoRef.current = true;
    setEnviando(true);
    setErrores({});
    try {
      const { lavado } = await ep.registrarLavado(datos);
      setRegistrado({ lavado, servicio: servicio.nombre, montoCargado: monto });
      limpiar();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setErrores(err.fields);
        if (Object.keys(err.fields).some((k) => CAMPOS_PLEGADOS.includes(k))) setAbierto(true);
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
      const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], fieldset[aria-describedby] input');
      el?.focus();
    });
  };

  if (catalogo.estado === 'cargando' && !catalogo.datos) {
    return (
      <>
        <Encabezado titulo="Registrar lavado" />
        <Cargando texto="Cargando servicios…" />
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

  const trabajadorNombre =
    (equipo.datos ?? []).find((t) => t.id === registrado?.lavado.trabajador?.id)?.nombre ??
    registrado?.lavado.trabajador?.nombre ??
    null;

  return (
    <>
      <Encabezado titulo="Registrar lavado">
        <p className="encabezado-fecha">{fecha === hoyAR ? `Hoy, ${fechaLarga(hoyAR)}` : fechaLarga(fecha)}</p>
      </Encabezado>

      {registrado ? (
        <div className="talon" role="status" aria-live="polite">
          <Check aria-hidden size={22} className="talon-icono" />
          <div className="talon-cuerpo">
            <p className="talon-titulo">Lavado registrado</p>
            <p className="talon-detalle">
              {registrado.servicio} · {NOMBRE_VEHICULO[registrado.lavado.vehiculoTipo]}
              {registrado.lavado.vehiculoModelo ? ` ${registrado.lavado.vehiculoModelo}` : ''}
              {eligeTrabajador && registrado.montoCargado !== null ?` · ${pesos(registrado.montoCargado)}` : ''}
              {trabajadorNombre && registrado.lavado.trabajador?.id !== usuario.id ? ` · lo lavó ${trabajadorNombre}` : ''}
            </p>
          </div>
          <Link to="/planilla" className="btn btn-fantasma btn-chico">
            <ClipboardList aria-hidden size={18} />
            Ver planilla
          </Link>
        </div>
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

        {ofrecidos.length ? (
          <Segmentado
            leyenda="Servicio"
            nombre="servicio"
            variante="grilla"
            valor={servicioId}
            onCambio={elegirServicio}
            error={errores.servicioId || undefined}
            opciones={ofrecidos.map((s) => {
              if (!eligeTrabajador) return { valor: s.id, etiqueta: s.nombre };
              const precio = precioPara(s, vehiculo);
              return {
                valor: s.id,
                etiqueta: s.nombre,
                detalle: precio === null ? 'Precio a consultar' : `Lista: ${pesos(precio)}`,
              };
            })}
          />
        ) : (
          <Vacio titulo={`No hay servicios activos para ${NOMBRE_VEHICULO[vehiculo].toLowerCase()}`}>
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
            setMontoTexto(miles(e.target.value));
            setMontoSugerido(false);
          }}
          error={errores.monto || undefined}
          ayuda={
            usuario.rol === 'empleado'
              ? 'Si no sabés cuánto se cobró, dejalo vacío: lo completa un encargado.'
              : montoSugerido
                ? 'Precio de lista del servicio. Cambialo si se cobró otra cosa.'
                : 'Si todavía no se cobró, dejalo vacío y cargalo después desde la planilla.'
          }
        />

        {eligeTrabajador ? (
          <Selector
            etiqueta="Quién lo lavó"
            name="trabajador"
            value={trabajadorId}
            onChange={(e) => {
              setTrabajadorId(e.target.value);
            }}
            error={errores.trabajadorId || undefined}
            ayuda={equipo.estado === 'error' ? 'No pudimos cargar el equipo: queda a tu nombre.' : undefined}
          >
            {(equipo.datos ?? []).some((t) => t.id === usuario.id) ? null : (
              <option value={usuario.id}>{nombreDe(usuario)} (vos)</option>
            )}
            {(equipo.datos ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
                {t.id === usuario.id ? ' (vos)' : ''}
              </option>
            ))}
          </Selector>
        ) : (
          <p className="dato-fijo">
            <span className="dato-fijo-etiqueta">Quién lo lavó</span>
            <span>Vos, {nombreDe(usuario)}</span>
          </p>
        )}

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
              ayuda="Por ejemplo, la forma de pago. El cliente no la ve."
            />
          </div>
        </details>

        <div className="pie-fijo">
          <Boton type="submit" variante="primario" cargando={enviando} className="btn-ancho btn-grande" disabled={!ofrecidos.length || enviando}>
            {enviando ? 'Registrando…' : 'Registrar lavado'}
          </Boton>
        </div>
      </form>
    </>
  );
}
