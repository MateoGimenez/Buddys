import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as ep from '../../api/endpoints';
import { Aviso, Boton, Cargando, Encabezado, Vacio } from '../../components/ui';
import { EVENTO_ENVIADOS } from '../../lib/cola';
import { fechaLarga, hoy, sumarDias } from '../../lib/format';
import { useFotosDisponibles } from '../../lib/fotosDisponibles';
import { useCarga } from '../../lib/useCarga';
import { useSesion, useVeImportes } from '../../session/SessionContext';
import { Caja } from './Caja';
import { Lista } from './Lista';
import { Resumen } from './Resumen';

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
  // Las fotos se ofrecen solo si están prendidas en el servidor (se pregunta con el primer lavado del día).
  const fotos = useFotosDisponibles(datos?.lavados[0]?.id ?? null) === true;

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
              fotos={fotos}
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
