import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { agenda } from '../../api/agenda';
import * as ep from '../../api/endpoints';
import { Aviso, Boton, Cargando, Encabezado, Segmentado, Vacio } from '../../components/ui';
import { diaMes, fechaLarga, hoy, sumarDias } from '../../lib/format';
import { usePuede, usePuedeDelTodo } from '../../lib/nivel';
import { useCarga } from '../../lib/useCarga';
import { useVeImportes } from '../../session/SessionContext';
import { porDia, rangoDe, type Vista } from './datos';
import { NuevoTurno } from './NuevoTurno';
import { TarjetaTurno } from './TarjetaTurno';

/**
 * La agenda de los trabajos largos: turnos de la web y los que se cargan desde el panel con seña. Por día o por
 * semana. Los lavados de mostrador no aparecen (están en la planilla).
 */
export function Agenda() {
  const hoyAR = hoy();
  const [vista, setVista] = useState<Vista>('semana');
  const [fecha, setFecha] = useState(hoyAR);
  const [creando, setCreando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const veImportes = useVeImportes();
  const crea = usePuede('turnos.crear');
  const cancela = usePuedeDelTodo('turnos.estado');
  const { desde, hasta } = rangoDe(vista, fecha);
  const [carga, recargar] = useCarga(() => agenda(desde, hasta), [desde, hasta]);
  const [catalogo] = useCarga(() => (crea ? ep.servicios().then((r) => r.servicios) : Promise.resolve([])), [crea]);
  const paso = vista === 'dia' ? 1 : 7;
  const dias = carga.datos ? porDia(carga.datos.turnos) : [];
  const enRango = rangoDe(vista, hoyAR).desde === desde;

  return (
    <>
      <Encabezado titulo="Agenda">
        {crea && !creando ? (
          <Boton
            variante="primario"
            chico
            icono={<Plus aria-hidden size={18} />}
            onClick={() => {
              setCreando(true);
              setAviso(null);
            }}
          >
            Nuevo turno
          </Boton>
        ) : null}
      </Encabezado>

      {creando ? (
        catalogo.datos ? (
          <NuevoTurno
            catalogo={catalogo.datos}
            fechaInicial={fecha}
            onCancelar={() => {
              setCreando(false);
            }}
            onListo={(t) => {
              setCreando(false);
              setAviso(`Turno de ${t.nombre} guardado para el ${fechaLarga(t.fechaPreferida)}.`);
              setFecha(t.fechaPreferida);
              recargar();
            }}
          />
        ) : catalogo.estado === 'error' ? (
          <Aviso titulo="No pudimos cargar los servicios">{catalogo.mensaje}</Aviso>
        ) : (
          <Cargando texto="Cargando los servicios…" />
        )
      ) : null}

      <div className="agenda-controles">
        <Segmentado<Vista>
          leyenda="Ver"
          leyendaOculta
          nombre="agenda-vista"
          valor={vista}
          onCambio={setVista}
          opciones={[
            { valor: 'dia', etiqueta: 'Día' },
            { valor: 'semana', etiqueta: 'Semana' },
          ]}
        />
        <div className="navegador-fecha">
          <Boton
            chico
            variante="fantasma"
            aria-label={vista === 'dia' ? 'Día anterior' : 'Semana anterior'}
            icono={<ChevronLeft aria-hidden size={20} />}
            onClick={() => {
              setFecha(sumarDias(fecha, -paso));
            }}
          />
          <span className="navegador-mes" aria-live="polite">
            {vista === 'dia' ? fechaLarga(desde) : `${diaMes(desde)} al ${diaMes(hasta)}`}
          </span>
          <Boton
            chico
            variante="fantasma"
            aria-label={vista === 'dia' ? 'Día siguiente' : 'Semana siguiente'}
            icono={<ChevronRight aria-hidden size={20} />}
            onClick={() => {
              setFecha(sumarDias(fecha, paso));
            }}
          />
          {!enRango ? (
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
      </div>

      {aviso ? <Aviso tipo="ok" titulo={aviso} /> : null}
      {carga.estado === 'error' ? (
        <Aviso titulo="No pudimos cargar la agenda" accion={<Boton onClick={recargar}>Reintentar</Boton>}>
          {carga.mensaje}
        </Aviso>
      ) : null}
      {!carga.datos && carga.estado === 'cargando' ? <Cargando texto="Cargando la agenda…" /> : null}

      {carga.datos ? (
        dias.length === 0 ? (
          <Vacio titulo={vista === 'dia' ? 'No hay turnos este día' : 'No hay turnos esta semana'}>
            {crea ? 'Los trabajos largos con seña se cargan con "Nuevo turno".' : 'Cuando haya un turno, aparece acá.'}
          </Vacio>
        ) : (
          <div className="agenda" aria-busy={carga.estado === 'cargando'}>
            {dias.map((d) => (
              <section key={d.fecha} className="agenda-dia" aria-labelledby={`dia-${d.fecha}`}>
                <h2 id={`dia-${d.fecha}`} className="agenda-dia-titulo">
                  {d.fecha === hoyAR ? `Hoy, ${fechaLarga(d.fecha)}` : fechaLarga(d.fecha)}
                </h2>
                <ul className="lista-hojas">
                  {d.turnos.map((t) => (
                    <TarjetaTurno
                      key={t.id}
                      turno={t}
                      veImportes={veImportes}
                      cancela={cancela}
                      gestionaSena={crea && veImportes}
                      onCambio={(_, texto) => {
                        setAviso(texto);
                        recargar();
                      }}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : null}
    </>
  );
}
