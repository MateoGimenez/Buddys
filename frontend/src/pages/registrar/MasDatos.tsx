import { ChevronDown, Star } from 'lucide-react';
import type { Cliente } from '../../api/clientes';
import { CampoPatente } from '../../components/CampoPatente';
import { AreaTexto, Campo, Segmentado } from '../../components/ui';
import { NOMBRE_FRANJA, fechaCorta, sumarDias } from '../../lib/format';
import { textoPremio } from '../../lib/sellos';
import { DIAS_ATRAS, type DatosExtra } from './datos';

export function MasDatos({
  abierto,
  onAbrir,
  datos,
  onCambio,
  hoyAR,
  errores,
  sugerenciasPatente,
  conocido,
}: {
  abierto: boolean;
  onAbrir: (abierto: boolean) => void;
  datos: DatosExtra;
  onCambio: (cambio: Partial<DatosExtra>) => void;
  hoyAR: string;
  errores: Record<string, string>;
  /** Patentes o modelos ya anotados que coinciden con lo escrito. */
  sugerenciasPatente?: readonly string[] | undefined;
  /** El cliente de esa patente, si ya vino. */
  conocido?: Cliente | null;
}) {
  const fecha = datos.fechaElegida ?? hoyAR;
  return (
    <details
      className="plegable"
      open={abierto}
      onToggle={(e) => {
        onAbrir(e.currentTarget.open);
      }}
    >
      <summary>
        <span>Más datos</span>
        <span className="plegable-ayuda">Fecha, franja, cliente, patente, nota</span>
        <ChevronDown aria-hidden size={20} className="plegable-flecha" />
      </summary>
      <div className="plegable-cuerpo">
        <Campo
          etiqueta="Fecha"
          type="date"
          name="fecha"
          min={sumarDias(hoyAR, -DIAS_ATRAS)}
          max={hoyAR}
          value={fecha}
          onChange={(e) => {
            const v = e.target.value;
            onCambio({ fechaElegida: v && v !== hoyAR ? v : null });
          }}
          error={errores.fecha || undefined}
          ayuda={`Si te olvidaste de anotarlo: hasta ${DIAS_ATRAS} días atrás.`}
        />
        <Segmentado
          leyenda="Franja"
          nombre="franja"
          valor={datos.franja}
          onCambio={(franja) => {
            onCambio({ franja });
          }}
          error={errores.franja || undefined}
          opciones={[
            { valor: 'auto', etiqueta: <span className="opcion-envuelve">Según la hora</span> },
            { valor: 'manana', etiqueta: NOMBRE_FRANJA.manana },
            { valor: 'tarde', etiqueta: NOMBRE_FRANJA.tarde },
          ]}
        />
        <CampoPatente
          valor={datos.modelo}
          onCambio={(modelo) => {
            onCambio({ modelo });
          }}
          error={errores.vehiculoModelo || undefined}
          sugerencias={sugerenciasPatente}
        />
        {conocido ? <ClienteConocido cliente={conocido} /> : null}
        <Campo
          etiqueta="Nombre del cliente"
          name="nombre"
          autoComplete="off"
          maxLength={80}
          value={datos.nombre}
          onChange={(e) => {
            onCambio({ nombre: e.target.value });
          }}
          error={errores.nombre || undefined}
        />
        <Campo
          etiqueta="Teléfono"
          type="tel"
          name="telefono"
          inputMode="tel"
          autoComplete="off"
          maxLength={20}
          value={datos.telefono}
          onChange={(e) => {
            onCambio({ telefono: e.target.value });
          }}
          error={errores.telefono || undefined}
          ayuda="Sirve para ver el historial del cliente."
        />
        <AreaTexto
          etiqueta="Nota"
          name="notasInternas"
          maxLength={1000}
          value={datos.nota}
          onChange={(e) => {
            onCambio({ nota: e.target.value });
          }}
          error={errores.notasInternas || undefined}
          ayuda="Algo para acordarse de este lavado: un detalle del auto, un pedido del cliente. El cliente no la ve."
        />
      </div>
    </details>
  );
}

function ClienteConocido({ cliente }: { cliente: Cliente }) {
  const { sellos } = cliente;
  return (
    <div className="conocido" role="status">
      <p className="conocido-titulo">
        {cliente.nombre === 'Cliente de mostrador' ? 'Este auto ya vino' : `Ya vino: ${cliente.nombre}`}
      </p>
      <p className="conocido-detalle">
        {cliente.visitas} {cliente.visitas === 1 ? 'visita' : 'visitas'}
        {cliente.ultimaVisita ? ` · la última el ${fechaCorta(cliente.ultimaVisita)}` : ''} · {sellos.sellos} de {sellos.cada} sellos
      </p>
      {sellos.proximoEsPremio ? (
        <p className="conocido-premio">
          <Star aria-hidden size={18} />
          Este lavado es el premio de la tarjeta: {textoPremio(sellos.premio, sellos.porcentaje)}.
        </p>
      ) : null}
    </div>
  );
}
