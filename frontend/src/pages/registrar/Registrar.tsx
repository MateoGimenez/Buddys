import { BadgePercent } from 'lucide-react';
import { useId, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import type { Cliente } from '../../api/clientes';
import { ApiError, mensajeDeError } from '../../api/client';
import * as ep from '../../api/endpoints';
import {
  FORMAS_PAGO,
  VEHICULOS,
  type FormaPago,
  type NuevoLavado,
  type VehiculoTipo,
} from '../../api/types';
import { ElegirServicios } from '../../components/ElegirServicios';
import { Avatar } from '../../components/Avatar';
import { nombreDe } from '../../components/Layout';
import { Aviso, Boton, Campo, Cargando, Encabezado, Segmentado, Selector, Vacio } from '../../components/ui';
import { encolarLavado, enviarCola, nuevoIdLocal } from '../../lib/cola';
import {
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
} from '../../lib/format';
import { prefiereMenosMovimiento } from '../../lib/movimiento';
import { normalizarPatente } from '../../lib/patente';
import { useCarga } from '../../lib/useCarga';
import { useUsuario } from '../../session/SessionContext';
import { useClienteConocido } from './clienteConocido';
import { CAMPOS_PLEGADOS, DIAS_ATRAS, EXTRA_VACIO, type DatosExtra } from './datos';
import { CamposDescuento } from './Descuento';
import { MONTO_MAX, revisarDescuento } from './descuentoReglas';
import { MasDatos } from './MasDatos';
import { recordarUltimo, recordarVehiculo, ultimoLavado, vehiculoRecordado, type UltimoLavado } from './memoria';
import { limiteParaDeshacer, type Registrado } from './registrado';
import { RepetirUltimo } from './RepetirUltimo';
import { Talon } from './Talon';

const MENSAJE_SIN_GUARDAR =
  'No hay conexión y este celular no deja guardar el lavado. Anotalo en papel y cargalo cuando vuelva la señal.';

/**
 * Registrar lavado: lo más usado del panel. Vehículo, servicios, monto y forma de pago a la vista; lo demás plegado en
 * "Más datos". Si no hay señal, queda en la cola del celular (lib/cola.ts) y sale solo cuando vuelve.
 */
export function Registrar() {
  const usuario = useUsuario();
  const eligeTrabajador = usuario.rol !== 'empleado';
  const hoyAR = hoy();

  const [catalogo, recargarCatalogo] = useCarga(() => ep.servicios().then((r) => r.servicios), []);
  const [equipo] = useCarga(
    () => (eligeTrabajador ? ep.trabajadores().then((r) => r.trabajadores) : Promise.resolve([])),
    [eligeTrabajador],
  );

  // El último vehículo que se eligió en este celular (por usuario): en un lavadero de motos, arranca en Moto.
  const [vehiculo, setVehiculo] = useState<VehiculoTipo>(() => vehiculoRecordado(usuario.id) ?? 'auto');
  const [ultimo, setUltimo] = useState<UltimoLavado | null>(() => ultimoLavado(usuario.id));
  /** Lo que precargó "Repetir el último": se lee junto con el botón Registrar, que recibe el foco. */
  const [repetido, setRepetido] = useState<string | null>(null);
  const repetidoId = useId();
  const registrarRef = useRef<HTMLButtonElement>(null);
  /** En el orden en que se tocaron: el primero es el principal. */
  const [servicioIds, setServicioIds] = useState<string[]>([]);
  const [montoTexto, setMontoTexto] = useState('');
  /** true si el monto lo escribió la persona: entonces la suma de lista ya no lo pisa. */
  const [montoManual, setMontoManual] = useState(false);
  /** Lo que se sacó al cambiar de vehículo, para avisarlo. */
  const [sacados, setSacados] = useState<string[]>([]);
  const [formaPago, setFormaPago] = useState<FormaPago | null>(null);
  const [trabajadorId, setTrabajadorId] = useState(usuario.id);
  const [abierto, setAbierto] = useState(false);
  const [extra, setExtra] = useState<DatosExtra>(EXTRA_VACIO);
  const { franja, nombre, telefono, modelo, nota } = extra;
  const fecha = extra.fechaElegida ?? hoyAR;
  /** "Ya terminado" (lo de siempre: se anota al cobrar) o "Recién llega" (queda En espera). */
  const [llegada, setLlegada] = useState<'terminado' | 'espera'>('terminado');
  const [descuentoAbierto, setDescuentoAbierto] = useState(false);
  const [descuentoTexto, setDescuentoTexto] = useState('');
  const [motivo, setMotivo] = useState('');
  const descuento = eligeTrabajador ? (enteroDesdeTexto(descuentoTexto) ?? 0) : 0;

  // Patente conocida: completa nombre y teléfono si están vacíos (sin pisar lo escrito).
  const completarCliente = (c: Cliente) => {
    setExtra((x) => ({
      ...x,
      nombre: x.nombre.trim() || c.nombre === 'Cliente de mostrador' ? x.nombre : c.nombre,
      telefono: x.telefono.trim() || !c.telefonoWhatsapp ? x.telefono : c.telefonoWhatsapp,
    }));
  };
  const conocido = useClienteConocido(modelo, completarCliente);

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
  const lista = eligeTrabajador ? sumaDeLista(elegidos, vehiculo) : null;

  /** Pone la suma de lista (menos el descuento) en el monto, salvo que la persona ya haya escrito uno. */
  const sugerir = (ids: string[], v: VehiculoTipo, menos = descuento) => {
    if (!eligeTrabajador || (montoManual && montoTexto !== '')) return;
    const servicios = ids.map((id) => activos.find((x) => x.id === id)).filter((x) => x !== undefined);
    const { total } = sumaDeLista(servicios, v);
    const sugerido = Math.max(0, total - menos);
    setMontoTexto(total > 0 ? miles(String(sugerido)) : '');
    setMontoManual(false);
  };

  const cambiarDescuento = (texto: string) => {
    setDescuentoTexto(texto);
    sugerir(servicioIds, vehiculo, enteroDesdeTexto(texto) ?? 0);
    setErrores((e) => ({ ...e, descuento: '' }));
  };

  const elegirVehiculo = (v: VehiculoTipo) => {
    setVehiculo(v);
    recordarVehiculo(usuario.id, v);
    setRepetido(null);
    const quedan = servicioIds.filter((id) => activos.find((x) => x.id === id)?.vehiculos.includes(v));
    const fuera = servicioIds.filter((id) => !quedan.includes(id));
    setSacados(fuera.map((id) => activos.find((x) => x.id === id)?.nombre ?? id));
    if (fuera.length) setServicioIds(quedan);
    sugerir(quedan, v);
    setErrores((e) => ({ ...e, vehiculoTipo: '' }));
  };

  const elegirServicios = (ids: string[]) => {
    setServicioIds(ids);
    setRepetido(null);
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
    setExtra(EXTRA_VACIO);
    setRepetido(null);
    setAbierto(false);
    setErrores({});
    setLlegada('terminado');
    setDescuentoAbierto(false);
    setDescuentoTexto('');
    setMotivo('');
  };

  const enviar = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (enviandoRef.current) return;
    setErrorGeneral(null);
    const locales: Record<string, string> = {};
    if (!elegidos.length) locales.servicioIds = 'Elegí qué servicios se hicieron.';
    const monto = enteroDesdeTexto(montoTexto);
    if (monto !== null && monto > MONTO_MAX) locales.monto = `El monto puede ser hasta ${pesos(MONTO_MAX)}.`;
    if (eligeTrabajador) Object.assign(locales, revisarDescuento(monto, descuento, motivo));
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
    if (llegada === 'espera') datos.etapa = 'espera';
    if (descuento > 0) {
      datos.descuento = descuento;
      datos.descuentoMotivo = motivo.trim();
    }
    if (eligeTrabajador && trabajadorId) datos.trabajadorId = trabajadorId;
    if (fecha && fecha !== hoyAR) datos.fecha = fecha;
    if (franja !== 'auto') datos.franja = franja;
    if (nombre.trim()) datos.nombre = nombre.trim();
    if (telefono.trim()) datos.telefono = telefono.trim();
    const patente = normalizarPatente(modelo);
    if (patente) datos.vehiculoModelo = patente;
    if (nota.trim()) datos.notasInternas = nota.trim();

    const base = {
      servicio: nombres,
      vehiculoTipo: vehiculo,
      vehiculoModelo: datos.vehiculoModelo ?? null,
      formaPago,
      montoCargado: monto,
      descuento,
      descuentoMotivo: descuento > 0 ? motivo.trim() : null,
      etapa: llegada === 'espera' ? ('espera' as const) : ('entregado' as const),
    };
    const listo = (r: Registrado) => {
      setRegistrado(r);
      // Para "Repetir el último". El monto, solo para quien ve montos.
      const recuerdo: UltimoLavado = { vehiculo, servicioIds: datos.servicioIds, servicio: nombres, monto: eligeTrabajador ? monto : null };
      recordarUltimo(usuario.id, recuerdo);
      setUltimo(recuerdo);
      limpiar();
      window.scrollTo({ top: 0, behavior: prefiereMenosMovimiento() ? 'auto' : 'smooth' });
    };
    // Sin señal: queda guardado en el celular con la fecha y la franja de este momento, y sale solo cuando vuelve.
    const guardarSinConexion = () => {
      const paraDespues = { ...datos, fecha, franja: datos.franja ?? franjaSegunHora() };
      if (!encolarLavado(usuario.id, paraDespues, nombres)) {
        setErrorGeneral(MENSAJE_SIN_GUARDAR);
        return;
      }
      const elegido = trabajadorId === usuario.id ? undefined : (equipo.datos ?? []).find((t) => t.id === trabajadorId);
      listo({
        ...base,
        clave: `cola-${String(Date.now())}`,
        trabajador: elegido ? { id: elegido.id, nombre: elegido.nombre } : null,
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
        trabajador: lavado.trabajador,
        descuento: lavado.descuento ?? base.descuento,
        descuentoMotivo: lavado.descuentoMotivo ?? base.descuentoMotivo,
        etapa: lavado.etapa ?? base.etapa,
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

  // Los servicios del último que todavía se ofrecen para su vehículo (alguno pudo desactivarse desde entonces).
  const repetibles = ultimo
    ? ultimo.servicioIds.filter((id) => activos.some((x) => x.id === id && x.vehiculos.includes(ultimo.vehiculo)))
    : [];

  const repetir = () => {
    if (!ultimo || !repetibles.length) return;
    setVehiculo(ultimo.vehiculo);
    recordarVehiculo(usuario.id, ultimo.vehiculo);
    setServicioIds(repetibles);
    setSacados([]);
    setErrores({});
    if (eligeTrabajador && ultimo.monto !== null) {
      setMontoTexto(miles(String(ultimo.monto)));
      setMontoManual(true);
    } else if (eligeTrabajador) {
      const servicios = repetibles.map((id) => activos.find((x) => x.id === id)).filter((x) => x !== undefined);
      const { total } = sumaDeLista(servicios, ultimo.vehiculo);
      setMontoTexto(total > 0 ? miles(String(total)) : '');
      setMontoManual(false);
    }
    const nombres = unirServicios(repetibles.map((id) => activos.find((x) => x.id === id)?.nombre ?? id));
    setRepetido(`Precargado: ${nombres}, ${NOMBRE_VEHICULO[ultimo.vehiculo]}. Revisá y tocá Registrar lavado.`);
    // El pulgar sigue al botón Registrar (sin saltar la pantalla: el pie está fijo abajo).
    requestAnimationFrame(() => {
      registrarRef.current?.focus({ preventScroll: true });
    });
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
          veMonto={eligeTrabajador}
          usuarioId={usuario.id}
          equipo={equipo.datos ?? []}
          onCerrar={() => {
            setRegistrado(null);
          }}
        />
      ) : null}

      {errorGeneral ? <Aviso titulo="No se registró el lavado">{errorGeneral}</Aviso> : null}

      <form ref={formRef} className="hoja formulario" onSubmit={(e) => void enviar(e)} noValidate>
        {ultimo && repetibles.length ? (
          <div className="repetir-zona">
            <RepetirUltimo ultimo={ultimo} veMonto={eligeTrabajador} onRepetir={repetir} />
            {repetido ? (
              <p className="repetir-aviso" id={repetidoId}>
                {repetido}
              </p>
            ) : null}
          </div>
        ) : null}

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
            vePrecios={eligeTrabajador}
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

        {eligeTrabajador ? (
          descuentoAbierto || descuento > 0 ? (
            <CamposDescuento
              montoTexto={descuentoTexto}
              motivo={motivo}
              onMonto={cambiarDescuento}
              onMotivo={(m) => {
                setMotivo(m);
                setErrores((e) => ({ ...e, descuentoMotivo: '' }));
              }}
              errores={errores}
              ayuda={
                lista && lista.total > 0 && descuento > 0
                  ? `Lista ${pesos(lista.total)} menos el descuento: ${pesos(Math.max(0, lista.total - descuento))}.`
                  : 'Cuánto se rebajó. El monto de arriba es lo que se cobró, ya con el descuento.'
              }
            />
          ) : (
            <Boton
              chico
              variante="fantasma"
              className="registrar-descuento"
              icono={<BadgePercent aria-hidden size={18} />}
              onClick={() => {
                setDescuentoAbierto(true);
              }}
            >
              Agregar descuento
            </Boton>
          )
        ) : null}

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

        <Segmentado
          leyenda="El auto"
          nombre="llegada"
          valor={llegada}
          onCambio={setLlegada}
          ayuda={
            llegada === 'espera'
              ? 'Queda En espera: lo pasás a Lavando, Listo y Entregado desde la planilla.'
              : 'Ya está lavado y cobrado (lo de siempre).'
          }
          opciones={[
            { valor: 'terminado', etiqueta: 'Ya terminado' },
            { valor: 'espera', etiqueta: 'Recién llega' },
          ]}
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
            <span className="dato-fijo-quien">
              <Avatar nombre={nombreDe(usuario)} url={usuario.avatarUrl} />
              Vos, {nombreDe(usuario)}
            </span>
          </p>
        )}

        <MasDatos
          abierto={abierto}
          onAbrir={setAbierto}
          datos={extra}
          onCambio={(cambio) => {
            setExtra((x) => ({ ...x, ...cambio }));
          }}
          hoyAR={hoyAR}
          errores={errores}
          sugerenciasPatente={conocido.sugerencias}
          conocido={conocido.cliente}
        />

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
          <Boton
            ref={registrarRef}
            aria-describedby={repetido ? repetidoId : undefined}
            type="submit"
            variante="primario"
            cargando={enviando} className="btn-ancho btn-grande" disabled={!ofrecidos.length || enviando}>
            {enviando ? 'Registrando…' : llegada === 'espera' ? 'Anotar auto que llega' : 'Registrar lavado'}
          </Boton>
        </div>
      </form>
    </>
  );
}

