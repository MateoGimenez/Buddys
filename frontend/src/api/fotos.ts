// Fotos antes/después de un lavado (contrato 2026-11-15, función 13). El archivo no pasa por el backend: la API da
// una URL firmada de Supabase Storage y el panel sube ahí con PUT; para mirar, la API da lecturas firmadas (5 min).
// Flujo: 1) POST .../fotos (nace "pendiente", con su URL de subida), 2) PUT del archivo, 3) POST .../confirmar (la
// pasa a "lista"). Solo las listas salen en la galería; las pendientes cuentan para el tope de 6.
import { api, ApiError } from './client';

export type TipoFoto = 'antes' | 'despues';
export type FormatoFoto = 'image/jpeg' | 'image/webp';

/** Lo que acepta el backend. */
export const FOTOS_MAX = 6;
export const FOTO_BYTES_MAX = 1_572_864;

export interface Foto {
  id: string;
  tipo: TipoFoto;
  contentType: FormatoFoto;
  tamano: number;
  /** Solo las 'lista' salen en la galería; las pendientes cuentan para el tope. */
  estado: 'pendiente' | 'lista';
  creadaPor: { id: string; nombre: string } | null;
  createdAt: string;
}

export interface FotoConUrl extends Foto {
  /** Lectura firmada (vale 5 minutos). null si no se pudo firmar. */
  url: string | null;
}

export interface ListaFotos {
  /** false = las fotos están apagadas en el servidor: el panel no las ofrece. */
  disponible: boolean;
  fotos: FotoConUrl[];
}

export interface SubidaFirmada {
  foto: Foto;
  /** venceEl: hasta cuándo vale la URL (2 h). */
  subida: { url: string; metodo: 'PUT'; headers: Record<string, string>; venceEl: string };
}

const ruta = (id: string) => `/api/admin/lavados/${encodeURIComponent(id)}/fotos`;

export const fotosDelLavado = (id: string) => api<ListaFotos>(ruta(id));

export const pedirSubida = (id: string, datos: { tipo: TipoFoto; contentType: FormatoFoto; tamano: number }) =>
  api<SubidaFirmada>(ruta(id), { method: 'POST', body: datos });

/** Paso 3: el backend verifica que el archivo llegó y la foto pasa a la galería (las pendientes no se ven). */
export const confirmarFoto = (id: string, fotoId: string) =>
  api<{ foto: Foto }>(`${ruta(id)}/${encodeURIComponent(fotoId)}/confirmar`, { method: 'POST' });

export const borrarFoto =(id: string, fotoId: string) =>
  api<undefined>(`${ruta(id)}/${encodeURIComponent(fotoId)}`, { method: 'DELETE' });

/** Sube el archivo a la URL firmada (otro origen: sin cookies). */
export async function subirArchivo(subida: SubidaFirmada['subida'], archivo: Blob): Promise<void> {
  let res: Response;
  try {
    res = await fetch(subida.url, { method: subida.metodo, headers: subida.headers, body: archivo, credentials: 'omit' });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No pudimos subir la foto: revisá la conexión y probá de nuevo.');
  }
  if (!res.ok) throw new ApiError(res.status, 'UPLOAD_FAILED', 'No pudimos subir la foto. Probá de nuevo en un rato.');
}
