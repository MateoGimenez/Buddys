import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout, SECCIONES } from './components/Layout';
import { Cargando } from './components/ui';
import { Agenda } from './pages/agenda/Agenda';
import { PantallaCaja } from './pages/caja/Caja';
import { Clientes } from './pages/clientes/Clientes';
import { Equipo } from './pages/equipo/Equipo';
import { Gastos } from './pages/gastos/Gastos';
import { Hoy } from './pages/hoy/Hoy';
import { Insumos } from './pages/insumos/Insumos';
import { Login } from './pages/login/Login';
import { Mas } from './pages/mas/Mas';
import { Numeros } from './pages/numeros/Numeros';
import { Perfil } from './pages/perfil/Perfil';
import { Planilla } from './pages/planilla/Planilla';
import { Presupuestos } from './pages/presupuestos/Presupuestos';
import { Registrar } from './pages/registrar/Registrar';
import { Servicios } from './pages/servicios/Servicios';
import { useSesion } from './session/SessionContext';
import type { ReactElement } from 'react';

const PAGINAS: Record<string, ReactElement> = {
  '/registrar': <Registrar />,
  '/planilla': <Planilla />,
  '/numeros': <Numeros />,
  '/servicios': <Servicios />,
  '/insumos': <Insumos />,
  '/gastos': <Gastos />,
  '/presupuestos': <Presupuestos />,
  '/equipo': <Equipo />,
  '/agenda': <Agenda />,
  '/caja': <PantallaCaja />,
  '/hoy': <Hoy />,
  '/clientes': <Clientes />,
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

  // El encargado arranca en Hoy; el empleado, en Registrar.
  const inicio = puede('estadisticas.completas') ? '/hoy' : '/registrar';

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={inicio} replace />} />
        {SECCIONES.filter((s) => puede(s.capacidad)).map((s) => (
          <Route key={s.ruta} path={s.ruta} element={PAGINAS[s.ruta]} />
        ))}
        <Route path="/mas" element={<Mas />} />
        <Route path="/perfil" element={<Perfil />} />
        <Route path="*" element={<Navigate to={inicio} replace />} />
      </Route>
    </Routes>
  );
}
