import { Component, lazy, Suspense, type ReactElement, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout, SECCIONES } from './components/Layout';
import { Aviso, Boton, Cargando } from './components/ui';
import { Login } from './pages/Login';
import { Mas } from './pages/Mas';
import { Planilla } from './pages/Planilla';
import { Registrar } from './pages/Registrar';
import { useSesion } from './session/SessionContext';

// Lo de todos los días (Registrar, Planilla, Más y el ingreso) viene en el paquete inicial. Las pantallas de
// encargado se bajan aparte la primera vez que se abren (y el service worker las deja guardadas para sin señal).
const Numeros = lazy(() => import('./pages/Numeros').then((m) => ({ default: m.Numeros })));
const Servicios = lazy(() => import('./pages/Servicios').then((m) => ({ default: m.Servicios })));
const Insumos = lazy(() => import('./pages/Insumos').then((m) => ({ default: m.Insumos })));
const Gastos = lazy(() => import('./pages/Gastos').then((m) => ({ default: m.Gastos })));
const Presupuestos = lazy(() => import('./pages/Presupuestos').then((m) => ({ default: m.Presupuestos })));
const Equipo = lazy(() => import('./pages/Equipo').then((m) => ({ default: m.Equipo })));
const Perfil = lazy(() => import('./pages/Perfil').then((m) => ({ default: m.Perfil })));

/** Mientras baja una pantalla: el lugar del título y las filas de carga de siempre, así no salta al aparecer. */
function AbriendoPantalla() {
  return (
    <>
      <div className="pagina-encabezado" aria-hidden>
        <span className="esqueleto-titulo" />
      </div>
      <Cargando texto="Abriendo la pantalla…" />
    </>
  );
}

/**
 * Si la pantalla no se pudo bajar (sin señal y todavía sin guardar en el celular), un aviso en vez de la página en
 * blanco. Se recarga entera: el navegador recuerda el import que falló y no lo vuelve a intentar.
 */
class SinPantalla extends Component<{ children: ReactNode }, { fallo: boolean }> {
  override state = { fallo: false };

  static getDerivedStateFromError() {
    return { fallo: true };
  }

  override render() {
    if (!this.state.fallo) return this.props.children;
    return (
      <Aviso
        titulo="No pudimos abrir esta pantalla"
        accion={
          <Boton
            onClick={() => {
              window.location.reload();
            }}
          >
            Reintentar
          </Boton>
        }
      >
        Revisá la señal y probá de nuevo.
      </Aviso>
    );
  }
}

const aparte = (pagina: ReactElement) => (
  <SinPantalla>
    <Suspense fallback={<AbriendoPantalla />}>{pagina}</Suspense>
  </SinPantalla>
);

const PAGINAS: Record<string, ReactElement> = {
  '/registrar': <Registrar />,
  '/planilla': <Planilla />,
  '/numeros': aparte(<Numeros />),
  '/servicios': aparte(<Servicios />),
  '/insumos': aparte(<Insumos />),
  '/gastos': aparte(<Gastos />),
  '/presupuestos': aparte(<Presupuestos />),
  '/equipo': aparte(<Equipo />),
};

export function App() {
  const { estado, puede } = useSesion();

  if (estado.tipo === 'cargando') {
    return (
      <main className="pantalla-inicio">
        <img src="/logo.png" alt="Buddys Wash Detail" width={250} height={60} />
        <Cargando texto="Abriendo el panel…" />
      </main>
    );
  }

  if (estado.tipo === 'afuera') return <Login {...(estado.aviso ? { aviso: estado.aviso } : {})} />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/registrar" replace />} />
        {SECCIONES.filter((s) => puede(s.capacidad)).map((s) => (
          <Route key={s.ruta} path={s.ruta} element={PAGINAS[s.ruta]} />
        ))}
        <Route path="/mas" element={<Mas />} />
        {/* Mi perfil: todos los roles (perfil.editar es "sí" para los tres). */}
        {puede('perfil.editar') ? <Route path="/perfil" element={aparte(<Perfil />)} /> : null}
        <Route path="*" element={<Navigate to="/registrar" replace />} />
      </Route>
    </Routes>
  );
}
