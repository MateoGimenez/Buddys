import { ChevronRight, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nombreDe, useSecciones } from '../components/Layout';
import { Boton, Encabezado } from '../components/ui';
import { NOMBRE_ROL } from '../lib/format';
import { useSesion, useUsuario } from '../session/SessionContext';

export function Mas() {
  const usuario = useUsuario();
  const { salir } = useSesion();
  const secciones = useSecciones().filter((s) => !s.principal);
  const [saliendo, setSaliendo] = useState(false);

  return (
    <>
      <Encabezado titulo="Más" />
      <section className="hoja quien">
        <p className="quien-nombre">{nombreDe(usuario)}</p>
        <p className="quien-detalle">
          {NOMBRE_ROL[usuario.rol]}
          {usuario.email && usuario.nombre ? ` · ${usuario.email}` : ''}
        </p>
      </section>
      {secciones.length ? (
        <nav aria-label="Otras secciones">
          <ul className="menu">
            {secciones.map((s) => (
              <li key={s.ruta}>
                <Link to={s.ruta} className="menu-item">
                  <s.icono aria-hidden size={22} />
                  <span className="menu-texto">
                    <span className="menu-nombre">{s.nombre}</span>
                    <span className="menu-desc">{s.descripcion}</span>
                  </span>
                  <ChevronRight aria-hidden size={20} />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <Boton
        variante="secundario"
        className="btn-ancho"
        cargando={saliendo}
        icono={<LogOut aria-hidden size={20} />}
        onClick={() => {
          setSaliendo(true);
          void salir().finally(() => {
            setSaliendo(false);
          });
        }}
      >
        Cerrar sesión
      </Boton>
    </>
  );
}
