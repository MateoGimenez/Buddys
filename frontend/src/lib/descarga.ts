/**
 * Guarda un archivo bajado con fetch (los CSV): un enlace temporal con `download`. Los CSV no se abren en otra pestaña
 * como los PDF (lib/pdf.ts): el celular los manda a Descargas y de ahí se abren con Excel o Sheets.
 */
export function guardarArchivo(blob: Blob, nombre: string, tipo = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

/** Días entre dos fechas YYYY-MM-DD, contando las dos (el 1 y el 1 = 1 día). */
export function diasDelRango(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T12:00:00Z`);
  const b = Date.parse(`${hasta}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/** El backend acepta hasta 366 días por archivo. */
export const MAX_DIAS_EXPORTAR = 366;

/** El problema del rango para exportar, o null si se puede. */
export function problemaDelRango(desde: string, hasta: string): string | null {
  if (!desde || !hasta) return 'Elegí desde y hasta qué día.';
  if (hasta < desde) return 'La fecha "hasta" tiene que ser igual o posterior a "desde".';
  if (diasDelRango(desde, hasta) > MAX_DIAS_EXPORTAR) return 'Se puede bajar hasta un año (366 días) por archivo.';
  return null;
}
