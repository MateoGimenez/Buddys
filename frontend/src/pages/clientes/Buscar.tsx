import { ChevronRight, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { buscarTurnos } from '../../api/clientes';
import { Aviso, Boton, Campo, Cargando, Vacio } from '../../components/ui';
import { fechaCorta } from '../../lib/format';
import { rutaHistorial } from '../../lib/historial';
import { useCarga } from '../../lib/useCarga';
import { agrupar } from './agrupar';

const ESPERA_MS = 350;

/** Buscar un cliente por nombre, teléfono o patente; cada resultado abre su historial. */
export function Buscar() {
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(texto.trim());
    }, ESPERA_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [texto]);
  const busca = q.length >= 2;
  const [carga, recargar] = useCarga(() => (busca ? buscarTurnos(q) : Promise.resolve(null)), [q, busca]);
  const clientes = carga.datos ? agrupar(carga.datos.bookings) : [];

  return (
    <div className="clientes">
      <form
        role="search"
        className="hoja"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(texto.trim());
        }}
      >
        <Campo
          etiqueta="Buscar cliente"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          maxLength={80}
          placeholder="Nombre, teléfono o patente"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
          }}
          ayuda="Con 2 letras o más. La patente, con o sin espacios."
        />
      </form>

      {!busca ? (
        <Vacio titulo="Buscá por nombre, teléfono o patente">
          Vas a ver cuántas veces vino, qué se hace siempre y cómo va su tarjeta de sellos.
        </Vacio>
      ) : carga.estado === 'error' ? (
        <Aviso titulo="No pudimos buscar" accion={<Boton onClick={recargar}>Reintentar</Boton>}>
          {carga.mensaje}
        </Aviso>
      ) : !carga.datos ? (
        <Cargando texto="Buscando…" />
      ) : clientes.length === 0 ? (
        <Vacio titulo={`No encontramos a nadie con "${q}"`}>Probá con otra parte del nombre o la patente.</Vacio>
      ) : (
        <ul className="menu clientes-resultados" aria-label="Clientes encontrados" aria-busy={carga.estado === 'cargando'}>
          {clientes.map((c) => {
            const ruta = rutaHistorial(c);
            if (!ruta) return null;
            return (
              <li key={ruta}>
                <Link to={ruta} className="menu-item" viewTransition>
                  <Search aria-hidden size={20} />
                  <span className="menu-texto">
                    <span className="menu-nombre">{c.nombre}</span>
                    <span className="menu-desc">
                      {[c.vehiculoModelo, c.telefonoWhatsapp ? `+${c.telefonoWhatsapp}` : null, `última ${fechaCorta(c.ultima)}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <ChevronRight aria-hidden size={20} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
