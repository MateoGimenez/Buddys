import { ChevronRight, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../../components/Avatar';
import { nombreDe, useSecciones } from '../../components/Layout';
import { Aviso, Boton, Encabezado, Segmentado } from '../../components/ui';
import { NOMBRE_ROL } from '../../lib/format';
import { elegirTema, useTema, type Tema } from '../../lib/tema';
import { useSesion, useUsuario } from '../../session/SessionContext';
import { AvisosPush } from './AvisosPush';

export function Mas() {
  const usuario = useUsuario();
  const { salir } = useSesion();
  const secciones = useSecciones().filter((s) => !s.principal);
  const [saliendo, setSaliendo] = useState(false);
  const tema = useTema();
  const [noGuardo, setNoGuardo] = useState(false);

  return (
    <>
      <Encabezado titulo="Más" />
      <Link to="/perfil" className="hoja quien" viewTransition>
        <Avatar nombre={nombreDe(usuario)} url={usuario.avatarUrl} tamano="medio" />
        <span className="quien-texto">
          <span className="quien-nombre">{nombreDe(usuario)}</span>
          <span className="quien-detalle">
            {NOMBRE_ROL[usuario.rol]}
            {usuario.email && usuario.nombre ? ` · ${usuario.email}` : ''}
          </span>
          <span className="quien-ver">Tu perfil: foto, nombre y contraseña</span>
        </span>
        <ChevronRight aria-hidden size={20} />
      </Link>
      {secciones.length ? (
        <nav aria-label="Otras secciones">
          <ul className="menu">
            {secciones.map((s) => (
              <li key={s.ruta}>
                <Link to={s.ruta} className="menu-item" viewTransition>
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
      <div className="hoja">
        <Segmentado<Tema>
          leyenda="Cómo se ve la pantalla"
          nombre="tema"
          variante="grilla"
          valor={tema}
          onCambio={(t) => {
            setNoGuardo(!elegirTema(t));
          }}
          ayuda="Se guarda en este celular."
          opciones={[
            { valor: 'auto', etiqueta: 'Automático', detalle: 'Como el celular' },
            { valor: 'claro', etiqueta: 'Claro' },
            { valor: 'oscuro', etiqueta: 'Oscuro', detalle: 'Para la noche' },
            { valor: 'contraste', etiqueta: 'Alto contraste', detalle: 'Para leer al sol' },
          ]}
        />
        {noGuardo ? (
          <Aviso tipo="info" titulo="Este celular no deja guardarlo">
            Queda así hasta que cierres el panel.
          </Aviso>
        ) : null}
      </div>
      <AvisosPush />
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
