import { Download } from 'lucide-react';
import { useId, useState } from 'react';
import { mensajeDeError } from '../api/client';
import { exportarCsv, type QueExportar } from '../api/finanzas';
import { diaMes } from '../lib/format';
import { guardarArchivo, problemaDelRango } from '../lib/descarga';
import { usePuede } from '../lib/nivel';
import { Aviso, Boton } from './ui';

const NOMBRE: Record<QueExportar, string> = {
  planilla: 'la planilla',
  gastos: 'los gastos',
  estadisticas: 'las estadísticas',
};

/**
 * Botones para bajar CSV que abre Excel (es-AR: separador ";" y coma decimal). Solo para quien ve importes
 * (finanzas.exportar): para el empleado no se dibuja nada.
 */
export function Exportar({ que, desde, hasta, titulo = 'Bajar para Excel' }: { que: QueExportar[]; desde: string; hasta: string; titulo?: string }) {
  const puede = usePuede('finanzas.exportar');
  const tituloId = useId();
  const [bajando, setBajando] = useState<QueExportar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  if (!puede) return null;

  const problema = problemaDelRango(desde, hasta);
  const bajar = async (q: QueExportar) => {
    if (problema) return;
    setBajando(q);
    setError(null);
    setListo(null);
    try {
      const blob = await exportarCsv(q, desde, hasta);
      const nombre = `buddys-${q}-${desde}-a-${hasta}.csv`;
      guardarArchivo(blob, nombre);
      setListo(`Listo: ${nombre} quedó en Descargas.`);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setBajando(null);
    }
  };

  return (
    <section className="hoja bloque exportar" aria-labelledby={tituloId}>
      <h2 id={tituloId} className="bloque-titulo">
        {titulo}
      </h2>
      <p className="nota-chica">
        Del {diaMes(desde)} al {diaMes(hasta)}. Se abre con Excel o Google Sheets.
      </p>
      {problema ? <p className="campo-error">{problema}</p> : null}
      {error ? <Aviso titulo="No se pudo bajar el archivo">{error}</Aviso> : null}
      {listo ? (
        <p className="nota-ok" role="status">
          {listo}
        </p>
      ) : null}
      <div className="exportar-botones">
        {que.map((q) => (
          <Boton
            key={q}
            chico
            variante="secundario"
            icono={<Download aria-hidden size={18} />}
            cargando={bajando === q}
            disabled={bajando !== null || problema !== null}
            onClick={() => void bajar(q)}
          >
            Descargar {NOMBRE[q]} en Excel (CSV)
          </Boton>
        ))}
      </div>
    </section>
  );
}
