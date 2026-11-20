import { Repeat2 } from 'lucide-react';
import { NOMBRE_VEHICULO, pesos } from '../../lib/format';
import type { UltimoLavado } from './memoria';

/**
 * "Repetir el último": precarga el vehículo y los servicios del último lavado registrado desde este celular (y el
 * monto, si quien registra ve montos). No registra nada: hay que revisar y tocar "Registrar lavado".
 */
export function RepetirUltimo({ ultimo, veMonto, onRepetir }: { ultimo: UltimoLavado; veMonto: boolean; onRepetir: () => void }) {
  return (
    <button type="button" className="repetir" onClick={onRepetir}>
      <Repeat2 aria-hidden size={22} className="repetir-icono" />
      <span className="repetir-texto">
        <span className="repetir-titulo">Repetir el último</span>
        <span className="repetir-detalle">
          {ultimo.servicio} · {NOMBRE_VEHICULO[ultimo.vehiculo]}
          {veMonto && ultimo.monto !== null ? ` · ${pesos(ultimo.monto)}` : ''}
        </span>
      </span>
    </button>
  );
}
