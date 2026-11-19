import { ArrowLeft, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { historialCliente, type ClaveCliente } from '../../api/clientes';
import type { EstadoTurno } from '../../api/types';
import { Aviso, Boton, Cargando, Encabezado, Vacio } from '../../components/ui';
import { NOMBRE_VEHICULO, fechaCorta, nombresDelTurno, pesos } from '../../lib/format';
import { useCarga } from '../../lib/useCarga';
import { useVeImportes } from '../../session/SessionContext';
import { TarjetaSellos } from './Sellos';

const NOMBRE_ESTADO: Record<EstadoTurno, string> = {
  pendiente: 'Pendiente',
  confirmado: 'Confirmado',
  completado: 'Hecho',
  cancelado: 'Cancelado',
};

function Volver() {
  return (
    <Link to="/clientes" className="btn btn-fantasma btn-chico" viewTransition>
      <ArrowLeft aria-hidden size={18} />
      Buscar otro
    </Link>
  );
}

/** El historial de un cliente (por teléfono o por patente): resumen, tarjeta de sellos y cada visita. */
export function Historial({ clave }: { clave: ClaveCliente }) {
  const veImportes = useVeImportes();
  const texto = 'telefono' in clave ? clave.telefono : clave.patente;
  const [carga, recargar] = useCarga(() => historialCliente(clave), [texto, 'telefono' in clave]);

  if (carga.estado === 'error' && !carga.datos) {
    return (
      <>
        <Encabezado titulo="Cliente">
          <Volver />
        </Encabezado>
        {carga.mensaje.startsWith('No encontramos') ? (
          <Vacio titulo="Sin visitas registradas">{carga.mensaje}</Vacio>
        ) : (
          <Aviso titulo="No pudimos cargar el historial" accion={<Boton onClick={recargar}>Reintentar</Boton>}>
            {carga.mensaje}
          </Aviso>
        )}
      </>
    );
  }
  if (!carga.datos) {
    return (
      <>
        <Encabezado titulo="Cliente">
          <Volver />
        </Encabezado>
        <Cargando texto="Cargando el historial…" />
      </>
    );
  }

  const { cliente, lavados, total } = carga.datos;
  const nombre = cliente.nombre === 'Cliente de mostrador' ? (cliente.vehiculos[0] ?? cliente.clave) : cliente.nombre;
  return (
    <>
      <Encabezado titulo={nombre}>
        <Volver />
      </Encabezado>
      <div className="clientes">
        <section className="hoja bloque" aria-label="Resumen del cliente">
          <p className="cliente-datos">
            {cliente.vehiculos.length ? cliente.vehiculos.join(' · ') : 'Sin vehículo anotado'}
            {cliente.telefonoWhatsapp ? ` · +${cliente.telefonoWhatsapp}` : ''}
          </p>
          <dl className="cliente-cifras">
            <div>
              <dt>Visitas</dt>
              <dd>{cliente.visitas}</dd>
            </div>
            <div>
              <dt>Última</dt>
              <dd className="cliente-cifra-chica">{cliente.ultimaVisita ? fechaCorta(cliente.ultimaVisita) : '—'}</dd>
            </div>
            {veImportes && cliente.totalGastado !== null ? (
              <div>
                <dt>Gastó en total</dt>
                <dd>{pesos(cliente.totalGastado)}</dd>
              </div>
            ) : null}
          </dl>
          {cliente.serviciosMasHechos.length ? (
            <div>
              <h2 className="cliente-subtitulo">Lo que más se hace</h2>
              <ul className="cliente-servicios">
                {cliente.serviciosMasHechos.map((s) => (
                  <li key={s.servicioId}>
                    {s.nombre} <span className="cliente-veces">× {s.cantidad}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {cliente.telefonoWhatsapp ? (
            <a
              className="btn btn-secundario"
              href={`https://wa.me/${cliente.telefonoWhatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle aria-hidden size={20} />
              Escribirle por WhatsApp
            </a>
          ) : null}
        </section>

        <TarjetaSellos sellos={cliente.sellos} />

        <section className="hoja bloque" aria-labelledby="cliente-visitas">
          <h2 id="cliente-visitas" className="bloque-titulo">
            {total === 1 ? '1 visita anotada' : `${String(total)} visitas anotadas`}
            {total > lavados.length ? ` (las últimas ${String(lavados.length)})` : ''}
          </h2>
          <ol className="cliente-visitas">
            {lavados.map((l) => (
              <li key={l.id} className="cliente-visita" data-estado={l.estado}>
                <div className="cliente-visita-cabeza">
                  <span className="cliente-visita-fecha">{fechaCorta(l.fechaConfirmada ?? l.fechaPreferida)}</span>
                  {l.estado !== 'completado' ? <span className="etiqueta">{NOMBRE_ESTADO[l.estado]}</span> : null}
                  {veImportes && l.monto !== null ? <span className="cliente-visita-monto">{pesos(l.monto)}</span> : null}
                </div>
                <p className="cliente-visita-servicio">{nombresDelTurno(l)}</p>
                <p className="cliente-visita-detalle">
                  {NOMBRE_VEHICULO[l.vehiculoTipo]}
                  {l.vehiculoModelo ? ` · ${l.vehiculoModelo}` : ''}
                  {l.trabajador ? ` · lavó ${l.trabajador.nombre}` : ''}
                  {veImportes && l.descuento ? ` · descuento de ${pesos(l.descuento)}` : ''}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
