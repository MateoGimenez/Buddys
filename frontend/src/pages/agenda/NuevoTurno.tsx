import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../../api/client';
import { crearTurno, type NuevoTurno as DatosTurno, type TurnoAgenda } from '../../api/agenda';
import { VEHICULOS, type FormaPago, type Franja, type Servicio, type VehiculoTipo } from '../../api/types';
import { ElegirServicios } from '../../components/ElegirServicios';
import { AreaTexto, Aviso, Boton, Campo, Segmentado } from '../../components/ui';
import { enteroDesdeTexto, hoy, NOMBRE_FRANJA, NOMBRE_VEHICULO, sumarDias } from '../../lib/format';
import { CamposSena } from './CamposSena';
import { DIAS_ADELANTE, DIAS_SENA_ATRAS } from './datos';

/** Turno de un trabajo largo (pulido, tratamiento cerámico…) con seña opcional. Admin y superadmin. */
export function NuevoTurno({
  catalogo,
  fechaInicial,
  onListo,
  onCancelar,
}: {
  catalogo: Servicio[];
  fechaInicial: string;
  onListo: (t: TurnoAgenda) => void;
  onCancelar: () => void;
}) {
  const hoyAR = hoy();
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [vehiculo, setVehiculo] = useState<VehiculoTipo>('auto');
  const [modelo, setModelo] = useState('');
  const [servicioIds, setServicioIds] = useState<string[]>([]);
  const [fecha, setFecha] = useState(fechaInicial < hoyAR ? hoyAR : fechaInicial);
  const [franja, setFranja] = useState<Franja>('manana');
  const [nota, setNota] = useState('');
  const [conSena, setConSena] = useState(false);
  const [senaMonto, setSenaMonto] = useState('');
  const [senaForma, setSenaForma] = useState<FormaPago | null>(null);
  const [senaFecha, setSenaFecha] = useState(hoyAR);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const ofrecidos = catalogo.filter((s) => s.activo && s.vehiculos.includes(vehiculo));

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const locales: Record<string, string> = {};
    if (!nombre.trim()) locales.nombre = 'Escribí el nombre del cliente.';
    if (!telefono.trim()) locales.telefono = 'Escribí un teléfono para avisarle.';
    if (!servicioIds.length) locales.servicioIds = 'Elegí al menos un servicio.';
    const monto = enteroDesdeTexto(senaMonto);
    if (conSena && !monto) locales['sena.monto'] = 'Poné cuánto dejó de seña.';
    if (conSena && !senaForma) locales['sena.formaPago'] = 'Elegí cómo pagó la seña.';
    setErrores(locales);
    if (Object.keys(locales).length) return;
    const datos: DatosTurno = {
      nombre: nombre.trim(),
      telefono: telefono.trim(),
      vehiculoTipo: vehiculo,
      vehiculoModelo: modelo.trim() || null,
      servicioIds,
      fecha,
      franja,
      notasInternas: nota.trim() || null,
      ...(conSena && monto && senaForma ? { sena: { monto, formaPago: senaForma, fecha: senaFecha } } : {}),
    };
    setGuardando(true);
    setError(null);
    try {
      const { turno } = await crearTurno(datos);
      onListo(turno);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="hoja formulario nuevo-turno" onSubmit={(e) => void guardar(e)} noValidate aria-labelledby="nuevo-turno-titulo">
      <h2 id="nuevo-turno-titulo" className="bloque-titulo">
        Nuevo turno
      </h2>
      {error ? <Aviso>{error}</Aviso> : null}
      <div className="fila-campos">
        <Campo etiqueta="Cliente" autoComplete="off" value={nombre} maxLength={80} onChange={(e) => { setNombre(e.target.value); }} error={errores.nombre} />
        <Campo etiqueta="Teléfono" type="tel" inputMode="tel" autoComplete="off" value={telefono} maxLength={30} onChange={(e) => { setTelefono(e.target.value); }} error={errores.telefono} />
      </div>
      <Segmentado<VehiculoTipo>
        leyenda="Vehículo"
        nombre="nuevo-turno-vehiculo"
        valor={vehiculo}
        onCambio={(v) => {
          setVehiculo(v);
          // Lo que no se ofrece para el vehículo nuevo se saca.
          setServicioIds((ids) => ids.filter((id) => catalogo.find((s) => s.id === id)?.vehiculos.includes(v)));
        }}
        opciones={VEHICULOS.map((v) => ({ valor: v, etiqueta: NOMBRE_VEHICULO[v] }))}
        error={errores.vehiculoTipo}
      />
      <Campo etiqueta="Modelo y patente (opcional)" autoComplete="off" value={modelo} maxLength={80} onChange={(e) => { setModelo(e.target.value); }} error={errores.vehiculoModelo} />
      <ElegirServicios
        servicios={ofrecidos}
        vehiculo={vehiculo}
        elegidos={servicioIds}
        onCambio={setServicioIds}
        vePrecios
        pegajoso={false}
        error={errores.servicioIds}
      />
      <div className="fila-campos">
        <Campo
          etiqueta="Día del turno"
          type="date"
          min={hoyAR}
          max={sumarDias(hoyAR, DIAS_ADELANTE)}
          value={fecha}
          onChange={(e) => {
            if (e.target.value) setFecha(e.target.value);
          }}
          error={errores.fecha}
        />
        <Segmentado<Franja>
          leyenda="Franja"
          nombre="nuevo-turno-franja"
          valor={franja}
          onCambio={setFranja}
          opciones={(['manana', 'tarde'] as const).map((f) => ({ valor: f, etiqueta: NOMBRE_FRANJA[f] }))}
          error={errores.franja}
        />
      </div>
      <AreaTexto etiqueta="Nota interna (opcional)" rows={2} maxLength={1000} value={nota} onChange={(e) => { setNota(e.target.value); }} error={errores.notasInternas} />

      <label className="check nuevo-turno-sena">
        <input
          type="checkbox"
          checked={conSena}
          onChange={(e) => {
            setConSena(e.target.checked);
          }}
        />
        <span>Dejó seña</span>
      </label>
      {conSena ? (
        <div className="nuevo-turno-sena-campos">
          <CamposSena
            nombre="nuevo-turno-sena-forma"
            monto={senaMonto}
            setMonto={setSenaMonto}
            forma={senaForma}
            setForma={setSenaForma}
            errores={errores}
          />
          <Campo
            etiqueta="Fecha en que la dejó"
            type="date"
            min={sumarDias(hoyAR, -DIAS_SENA_ATRAS)}
            max={hoyAR}
            value={senaFecha}
            onChange={(e) => {
              if (e.target.value) setSenaFecha(e.target.value);
            }}
            error={errores['sena.fecha']}
            ayuda="La seña entra en la caja de ese día; el saldo, el día del turno."
          />
        </div>
      ) : null}

      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>
          Guardar turno
        </Boton>
      </div>
    </form>
  );
}
