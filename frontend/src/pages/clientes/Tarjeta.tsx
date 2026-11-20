import { useState, type SyntheticEvent } from 'react';
import { ApiError, mensajeDeError } from '../../api/client';
import { fidelizacion, guardarFidelizacion, type ConfigFidelizacion, type Premio } from '../../api/clientes';
import { Aviso, Boton, Campo, Cargando, Segmentado } from '../../components/ui';
import { enteroDesdeTexto } from '../../lib/format';
import { textoPremio } from '../../lib/sellos';
import { useCarga } from '../../lib/useCarga';
import { useSesion } from '../../session/SessionContext';

/** Cómo funciona la tarjeta de sellos. La cambia solo el dueño (superadmin); el resto la ve. */
export function Tarjeta() {
  const { puede } = useSesion();
  const configura = puede('fidelizacion.configurar');
  const [carga, recargar, actualizar] = useCarga(() => fidelizacion().then((r) => r.config), []);
  const [editando, setEditando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  if (carga.estado === 'error' && !carga.datos) {
    return (
      <Aviso titulo="No pudimos cargar la tarjeta de sellos" accion={<Boton onClick={recargar}>Reintentar</Boton>}>
        {carga.mensaje}
      </Aviso>
    );
  }
  if (!carga.datos) return <Cargando />;
  const c = carga.datos;

  return (
    <section className="hoja bloque" aria-labelledby="tarjeta-titulo">
      <h2 id="tarjeta-titulo" className="bloque-titulo">
        Tarjeta de sellos
      </h2>
      {editando ? (
        <FormTarjeta
          actual={c}
          onListo={(nueva) => {
            actualizar(() => nueva);
            setEditando(false);
            setGuardado(true);
          }}
          onCancelar={() => {
            setEditando(false);
          }}
        />
      ) : (
        <>
          <p className="tarjeta-regla">
            Cada <strong>{c.sellosCada} lavados</strong>, el siguiente es <strong>{textoPremio(c.premio, c.premioPorcentaje)}</strong>.
          </p>
          <p className="nota-chica">
            Un cliente cuenta como inactivo después de {c.inactivosDias} días sin venir. El premio se carga al cobrar: monto
            en cero o el descuento, con el motivo "Tarjeta de sellos".
          </p>
          {guardado ? (
            <p className="nota-ok" role="status">
              Listo, se guardó. Las tarjetas de todos se acomodan a la regla nueva.
            </p>
          ) : null}
          {configura ? (
            <Boton
              variante="secundario"
              onClick={() => {
                setGuardado(false);
                setEditando(true);
              }}
            >
              Cambiar la tarjeta
            </Boton>
          ) : null}
        </>
      )}
    </section>
  );
}

function FormTarjeta({
  actual,
  onListo,
  onCancelar,
}: {
  actual: ConfigFidelizacion;
  onListo: (c: ConfigFidelizacion) => void;
  onCancelar: () => void;
}) {
  const [cada, setCada] = useState(String(actual.sellosCada));
  const [premio, setPremio] = useState<Premio>(actual.premio);
  const [porcentaje, setPorcentaje] = useState(actual.premioPorcentaje === null ? '' : String(actual.premioPorcentaje));
  const [dias, setDias] = useState(String(actual.inactivosDias));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e: SyntheticEvent) => {
    e.preventDefault();
    const sellosCada = enteroDesdeTexto(cada) ?? 0;
    const inactivosDias = enteroDesdeTexto(dias) ?? 0;
    const pct = enteroDesdeTexto(porcentaje);
    const locales: Record<string, string> = {};
    if (sellosCada < 2 || sellosCada > 50) locales.sellosCada = 'Poné de 2 a 50 lavados.';
    if (premio === 'descuento' && (pct === null || pct < 1 || pct > 99)) locales.premioPorcentaje = 'Poné un porcentaje de 1 a 99.';
    if (inactivosDias < 7 || inactivosDias > 365) locales.inactivosDias = 'Poné de 7 a 365 días.';
    setErrores(locales);
    if (Object.keys(locales).length) return;
    setGuardando(true);
    setError(null);
    try {
      const { config } = await guardarFidelizacion({
        sellosCada,
        premio,
        premioPorcentaje: premio === 'descuento' ? pct : null,
        inactivosDias,
      });
      onListo(config);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrores(err.fields);
      setError(mensajeDeError(err));
      setGuardando(false);
    }
  };

  return (
    <form className="formulario" onSubmit={(e) => void guardar(e)} noValidate>
      {error ? <Aviso>{error}</Aviso> : null}
      <Campo
        etiqueta="Cada cuántos lavados hay premio"
        inputMode="numeric"
        value={cada}
        onChange={(e) => {
          setCada(e.target.value.replace(/\D/g, ''));
        }}
        error={errores.sellosCada}
        ayuda="De 2 a 50. El lavado que sigue es el premio."
      />
      <Segmentado
        leyenda="El premio"
        nombre="premio"
        valor={premio}
        onCambio={setPremio}
        opciones={[
          { valor: 'gratis', etiqueta: 'Lavado gratis' },
          { valor: 'descuento', etiqueta: 'Descuento' },
        ]}
      />
      {premio === 'descuento' ? (
        <Campo
          etiqueta="Porcentaje de descuento"
          inputMode="numeric"
          prefijo="%"
          value={porcentaje}
          onChange={(e) => {
            setPorcentaje(e.target.value.replace(/\D/g, ''));
          }}
          error={errores.premioPorcentaje}
        />
      ) : null}
      <Campo
        etiqueta="Días sin venir para contarlo inactivo"
        inputMode="numeric"
        value={dias}
        onChange={(e) => {
          setDias(e.target.value.replace(/\D/g, ''));
        }}
        error={errores.inactivosDias}
        ayuda="De 7 a 365."
      />
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>
          Guardar
        </Boton>
      </div>
    </form>
  );
}
