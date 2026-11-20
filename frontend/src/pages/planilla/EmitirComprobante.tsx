import { FileDown } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { mensajeDeError } from '../../api/client';
import * as ep from '../../api/endpoints';
import { FORMAS_PAGO, type FormaPago, type Turno } from '../../api/types';
import { Aviso, Boton, Selector } from '../../components/ui';
import { NOMBRE_PAGO } from '../../lib/format';
import { abrirPdf } from '../../lib/pdf';

export function EmitirComprobante({ lavado, onCerrar }: { lavado: Turno; onCerrar: () => void }) {
  // La del lavado si ya la tiene (el backend usa esa misma si no se manda otra).
  const [formaPago, setFormaPago] = useState<FormaPago>(lavado.formaPago ?? 'efectivo');
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const emitir = async (e: SyntheticEvent) => {
    e.preventDefault();
    setTrabajando(true);
    setError(null);
    try {
      const { comprobante } = await ep.emitirComprobante(lavado.id, formaPago);
      await abrirPdf(() => ep.pdfComprobante(comprobante.id), `Comprobante-${comprobante.codigo}.pdf`);
      onCerrar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <form className="copia-form formulario" onSubmit={(e) => void emitir(e)} noValidate>
      {error ? <Aviso>{error}</Aviso> : null}
      <Selector
        etiqueta="Forma de pago"
        value={formaPago}
        onChange={(e) => { setFormaPago(e.target.value as FormaPago); }}
        ayuda="Si el lavado ya tenía comprobante, se abre el mismo (no se emite otro). No es una factura."
      >
        {FORMAS_PAGO.map((f) => (
          <option key={f} value={f}>
            {NOMBRE_PAGO[f]}
          </option>
        ))}
      </Selector>
      <div className="fila-botones">
        <Boton variante="fantasma" onClick={onCerrar} disabled={trabajando}>
          Cancelar
        </Boton>
        <Boton type="submit" variante="primario" cargando={trabajando} icono={<FileDown aria-hidden size={18} />}>
          Emitir y abrir PDF
        </Boton>
      </div>
    </form>
  );
}
