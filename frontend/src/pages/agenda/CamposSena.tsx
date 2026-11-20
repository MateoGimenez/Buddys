import { FORMAS_PAGO, type FormaPago } from '../../api/types';
import { Campo, Segmentado } from '../../components/ui';
import { miles, NOMBRE_PAGO } from '../../lib/format';

/** Monto y forma de pago de la seña (al crear el turno y al corregirla). */
export function CamposSena({
  nombre,
  monto,
  setMonto,
  forma,
  setForma,
  errores,
}: {
  nombre: string;
  monto: string;
  setMonto: (v: string) => void;
  forma: FormaPago | null;
  setForma: (f: FormaPago) => void;
  errores: Record<string, string | undefined>;
}) {
  return (
    <>
      <Campo
        etiqueta="Cuánto dejó de seña"
        prefijo="$"
        inputMode="numeric"
        value={monto}
        onChange={(e) => {
          setMonto(miles(e.target.value));
        }}
        error={errores.monto ?? errores['sena.monto']}
      />
      <Segmentado<FormaPago>
        leyenda="Cómo pagó la seña"
        nombre={nombre}
        variante="fichas"
        valor={forma}
        onCambio={setForma}
        opciones={FORMAS_PAGO.map((f) => ({ valor: f, etiqueta: NOMBRE_PAGO[f] }))}
        error={errores.formaPago ?? errores['sena.formaPago']}
      />
    </>
  );
}
