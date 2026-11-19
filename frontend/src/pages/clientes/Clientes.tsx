import { useSearchParams } from 'react-router-dom';
import { Encabezado, Segmentado } from '../../components/ui';
import { useSesion } from '../../session/SessionContext';
import { Buscar } from './Buscar';
import { Historial } from './Historial';
import { Inactivos } from './Inactivos';
import { Tarjeta } from './Tarjeta';

type Vista = 'buscar' | 'inactivos' | 'tarjeta';

/**
 * Clientes: buscar y ver el historial (?telefono= o ?patente=), los que hace rato no vienen y la tarjeta de sellos.
 * La vista va en la URL (?ver=) para que "Atrás" del celular vuelva a donde estaba.
 */
export function Clientes() {
  const { puede } = useSesion();
  const [params, setParams] = useSearchParams();
  const telefono = params.get('telefono');
  const patente = params.get('patente');
  if (telefono) return <Historial key={`t${telefono}`} clave={{ telefono }} />;
  if (patente) return <Historial key={`p${patente}`} clave={{ patente }} />;

  const inactivos = puede('clientes.inactivos');
  const pedida = params.get('ver');
  const vista: Vista = pedida === 'tarjeta' || (pedida === 'inactivos' && inactivos) ? pedida : 'buscar';
  const opciones: { valor: Vista; etiqueta: string }[] = [
    { valor: 'buscar', etiqueta: 'Buscar' },
    ...(inactivos ? [{ valor: 'inactivos' as const, etiqueta: 'Inactivos' }] : []),
    { valor: 'tarjeta', etiqueta: 'Tarjeta' },
  ];

  return (
    <>
      <Encabezado titulo="Clientes" />
      <Segmentado
        leyenda="Qué ver"
        leyendaOculta
        nombre="clientes-vista"
        valor={vista}
        onCambio={(v) => {
          setParams(v === 'buscar' ? {} : { ver: v }, { replace: true });
        }}
        opciones={opciones}
      />
      {vista === 'buscar' ? <Buscar /> : vista === 'inactivos' ? <Inactivos /> : <Tarjeta />}
    </>
  );
}
