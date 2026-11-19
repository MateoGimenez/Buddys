import { MessageCircle } from 'lucide-react';
import { clientesInactivos } from '../../api/clientes';
import { Aviso, Boton, Cargando, Vacio } from '../../components/ui';
import { fechaCorta } from '../../lib/format';
import { useCarga } from '../../lib/useCarga';

/** Clientes con teléfono que hace rato no vienen, el que hace más primero, con su WhatsApp ya escrito. */
export function Inactivos() {
  const [carga, recargar] = useCarga(() => clientesInactivos(), []);
  if (carga.estado === 'error' && !carga.datos) {
    return (
      <Aviso titulo="No pudimos cargar los clientes inactivos" accion={<Boton onClick={recargar}>Reintentar</Boton>}>
        {carga.mensaje}
      </Aviso>
    );
  }
  if (!carga.datos) return <Cargando texto="Cargando clientes…" />;
  const { dias, clientes, total } = carga.datos;
  if (!clientes.length) {
    return <Vacio titulo={`Nadie con más de ${String(dias)} días sin venir`}>Cuando alguien deje de venir, aparece acá.</Vacio>;
  }
  return (
    <div className="clientes">
      <p className="nota-chica">
        {total === 1 ? '1 cliente' : `${String(total)} clientes`} con {dias} días o más sin venir. El mensaje se abre en
        WhatsApp para que lo revises antes de mandarlo.
      </p>
      <ul className="lista-hojas">
        {clientes.map((c) => (
          <li key={c.telefonoWhatsapp} className="hoja fila-hoja">
            <div className="fila-hoja-cabeza">
              <span className="fila-hoja-titulo">{c.nombre}</span>
              <span className="inactivo-dias">hace {c.diasSinVenir} días</span>
            </div>
            <p className="fila-hoja-texto">
              {[c.vehiculoModelo, `${String(c.visitas)} ${c.visitas === 1 ? 'visita' : 'visitas'}`, `la última el ${fechaCorta(c.ultimaVisita)}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <a className="btn btn-primario" href={c.whatsapp} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden size={20} />
              Mandar WhatsApp
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
