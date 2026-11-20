import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../../api/client';
import * as ep from '../../api/endpoints';
import { FORMAS_PAGO, type CambioTurno, type FormaPago, type Servicio, type Turno } from '../../api/types';
import { ElegirServicios } from '../../components/ElegirServicios';
import { AreaTexto, Aviso, Boton, Campo, Segmentado } from '../../components/ui';
import { NOMBRE_PAGO, enteroDesdeTexto, miles, pesos, sumaDeLista } from '../../lib/format';
import { CamposDescuento } from '../registrar/Descuento';
import { revisarDescuento } from '../registrar/descuentoReglas';

/** Los ids de servicios de un lavado, en orden (si el backend no mandara `servicios`, el principal). */
function idsDe(lavado: Turno): string[] {
  const lista = lavado.servicios as Turno['servicios'] | undefined;
  return lista?.length ? lista.map((s) => s.id) : [lavado.servicioId];
}

export function Corregir({
  lavado,
  catalogo,
  onListo,
  onCancelar,
}: {
  lavado: Turno;
  catalogo: Servicio[];
  onListo: (t: Turno) => void;
  onCancelar: () => void;
}) {
  const originales = idsDe(lavado);
  const [servicioIds, setServicioIds] = useState<string[]>(originales);
  const [montoTexto, setMontoTexto] = useState(lavado.monto === null ? '' : miles(String(lavado.monto)));
  const [nota, setNota] = useState(lavado.notasInternas ?? '');
  const [formaPago, setFormaPago] = useState<FormaPago | null>(lavado.formaPago);
  const descuentoOriginal = lavado.descuento ?? 0;
  const [descuentoTexto, setDescuentoTexto] = useState(descuentoOriginal ? miles(String(descuentoOriginal)) : '');
  const [motivo, setMotivo] = useState(lavado.descuentoMotivo ?? '');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const monto = enteroDesdeTexto(montoTexto);
  // Los que se ofrecen para este vehículo, más los que ya tenía (aunque hoy estén inactivos o no se ofrezcan).
  const opciones = catalogo.filter((s) => (s.activo && s.vehiculos.includes(lavado.vehiculoTipo)) || originales.includes(s.id));
  const cambiaronServicios = servicioIds.join(',') !== originales.join(',');
  const elegidos = servicioIds.map((id) => catalogo.find((s) => s.id === id)).filter((s) => s !== undefined);
  const lista = sumaDeLista(elegidos, lavado.vehiculoTipo);
  const descuento = enteroDesdeTexto(descuentoTexto) ?? 0;

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    // Solo viaja lo que se cambió: así no se pisa un monto que cargó otra persona mientras tanto, y no se vuelve a
    // mandar quién lavó (el backend rechaza a alguien que ya no está activo aunque no se lo cambie).
    if (!servicioIds.length) {
      setErrores({ servicioIds: 'Tiene que quedar al menos un servicio.' });
      return;
    }
    const problemas = revisarDescuento(monto, descuento, motivo);
    if (Object.keys(problemas).length) {
      setErrores(problemas);
      return;
    }
    const cambio: CambioTurno = {};
    const motivoNuevo = descuento > 0 ? motivo.trim() : null;
    if (descuento !== descuentoOriginal || motivoNuevo !== (lavado.descuentoMotivo ?? null)) {
      cambio.descuento = descuento;
      if (motivoNuevo) cambio.descuentoMotivo = motivoNuevo;
    }
    if (cambiaronServicios) cambio.servicioIds = servicioIds;
    if (monto !== lavado.monto) cambio.monto = monto;
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
              ? `Con estos servicios la lista da ${pesos(Math.max(0, lista.total - descuento))}${descuento > 0 ? ' (ya con el descuento)' : ''}. El monto no cambia solo.`
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
      <CamposDescuento
        montoTexto={descuentoTexto}
        motivo={motivo}
        onMonto={setDescuentoTexto}
        onMotivo={setMotivo}
        errores={errores}
        ayuda={
          descuento > 0 && lista.total > 0
            ? `Lista ${pesos(lista.total)} menos el descuento: ${pesos(Math.max(0, lista.total - descuento))}.`
            : 'Vacío = sin descuento. El monto cobrado va ya con el descuento.'
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
