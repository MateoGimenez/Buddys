import { ChevronRight, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Usuario } from '../../api/types';
import { Avatar } from '../../components/Avatar';
import { nombreDe, useSecciones } from '../../components/Layout';
import { Aviso, Boton, Encabezado, Segmentado } from '../../components/ui';
import { NOMBRE_ROL } from '../../lib/format';
import { elegirTema, useTema, type Tema } from '../../lib/tema';
import { useSesion, useUsuario } from '../../session/SessionContext';

export function Mas() {
  const usuario = useUsuario();
  const { salir, puede } = useSesion();
  const secciones = useSecciones().filter((s) => !s.principal);
  const [saliendo, setSaliendo] = useState(false);
  const tema = useTema();
  const [noGuardo, setNoGuardo] = useState(false);

  return (
    <>
      <Encabezado titulo="Más" />
      {/* Quién está adentro y, si puede editarlo, el paso a Mi perfil (el mismo destino que el menú de la barra). */}
      {puede('perfil.editar') ? (
        <Link to="/perfil" className="hoja quien" viewTransition>
          <Quien usuario={usuario} accion="Mi perfil: nombre, foto y contraseña" />
          <ChevronRight aria-hidden size={20} />
        </Link>
      ) : (
        <section className="hoja quien">
          <Quien usuario={usuario} />
        </section>
      )}
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

function Quien({ usuario, accion }: { usuario: Usuario; accion?: string }) {
  return (
    <>
      <Avatar persona={usuario} tamano={48} />
      <span className="quien-texto">
        <span className="quien-nombre">{nombreDe(usuario)}</span>
        <span className="quien-detalle">
          {NOMBRE_ROL[usuario.rol]}
          {usuario.email && usuario.nombre ? ` · ${usuario.email}` : ''}
        </span>
        {accion ? <span className="quien-accion">{accion}</span> : null}
      </span>
    </>
  );
}
