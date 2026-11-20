import { Campo } from '../../components/ui';
import { miles } from '../../lib/format';
import { MOTIVO_MAX } from './descuentoReglas';

/**
 * Descuento y su motivo (solo para quien ve importes). El motivo aparece cuando hay descuento y es obligatorio: así,
 * a fin de mes, se sabe por qué se cobró menos.
 */
export function CamposDescuento({
  montoTexto,
  motivo,
  onMonto,
  onMotivo,
  errores,
  ayuda,
}: {
  montoTexto: string;
  motivo: string;
  onMonto: (texto: string) => void;
  onMotivo: (texto: string) => void;
  errores: Record<string, string>;
  ayuda?: string;
}) {
  const hay = montoTexto !== '' && montoTexto !== '0';
  return (
    <div className="descuento">
      <Campo
        etiqueta="Descuento"
        prefijo="$"
        inputMode="numeric"
        autoComplete="off"
        name="descuento"
        placeholder="0"
        value={montoTexto}
        onChange={(e) => {
          onMonto(miles(e.target.value));
        }}
        error={errores.descuento || undefined}
        ayuda={ayuda}
      />
      {hay || motivo ? (
        <Campo
          etiqueta="Motivo del descuento"
          name="descuentoMotivo"
          autoComplete="off"
          maxLength={MOTIVO_MAX}
          placeholder="Ej.: cliente frecuente, tarjeta de sellos"
          value={motivo}
          onChange={(e) => {
            onMotivo(e.target.value);
          }}
          error={errores.descuentoMotivo || undefined}
        />
      ) : null}
    </div>
  );
}
