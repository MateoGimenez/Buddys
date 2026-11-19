/**
 * Foto de perfil de cada usuario del panel (contrato: reportes/2026-11-16_04_contrato-perfil.md). El archivo vive en
 * el bucket PRIVADO `perfiles-avatares` de Supabase Storage; la base guarda la ruta en buddys.perfiles.
 *
 * Mismo flujo de 3 pasos que las fotos de los lavados (domain/fotos.ts): pedir la URL firmada (queda como subida
 * pendiente) -> el panel sube con PUT -> confirmar (el backend verifica en Storage que el objeto exista, su tamaño y su
 * tipo, y lo pasa a foto vigente). La foto que deja de usarse queda anotada en avatares_a_borrar (trigger de la base)
 * y la conciliación la vuelve a borrar cuando vence su token de subida.
 */

export { CONTENT_TYPES_FOTO as CONTENT_TYPES_AVATAR, EXTENSION_FOTO as EXTENSION_AVATAR, SUBIDA_VALE_MS } from './fotos.js';
export type { ContentTypeFoto as ContentTypeAvatar } from './fotos.js';

export const BUCKET_AVATARES = 'perfiles-avatares';
/** 512 KB: el panel la achica antes de subirla. Mismo tope que el bucket. */
export const AVATAR_TAMANO_MAX = 524_288;
/** Segundos que vale una URL firmada de lectura de una foto de perfil (1 hora). */
export const AVATAR_LECTURA_SEGUNDOS = 3600;

/** La foto de perfil de alguien, tal como la guarda la base. */
export interface AvatarDePerfil {
  /** Foto vigente (null = sin foto). */
  avatarPath: string | null;
  /** Subida pedida y no confirmada. */
  pendientePath: string | null;
  /** Hasta cuándo vale el token de la última subida pedida (ISO 8601). */
  subidaVence: string | null;
}

export interface AvatarRepository {
  /** undefined si el perfil no existe. */
  obtener(perfilId: string): Promise<AvatarDePerfil | undefined>;
  /**
   * Las fotos vigentes de esos perfiles (los que no tienen foto no aparecen). Una sola consulta: sirve para firmar en
   * lote las de un listado.
   */
  vigentes(perfilIds: readonly string[]): Promise<Map<string, string>>;
  /** Anota una subida pendiente (pisa la anterior, que queda anotada para borrar). false si el perfil no existe. */
  pedirSubida(perfilId: string, path: string, vence: Date): Promise<boolean>;
  /**
   * Pasa la subida pendiente `path` a foto vigente (la anterior queda anotada para borrar). Devuelve la ruta de la
   * foto anterior (null si no había) o undefined si `path` ya no es la pendiente (otra subida la pisó).
   */
  confirmar(perfilId: string, path: string): Promise<{ anterior: string | null } | undefined>;
  /** Saca la subida pendiente `path` (vencida o rechazada); queda anotada para borrar. */
  descartarPendiente(perfilId: string, path: string): Promise<void>;
  /** Saca la foto vigente y la pendiente (quedan anotadas). Devuelve las rutas que había. */
  quitar(perfilId: string): Promise<string[]>;
  /** Saca las subidas pendientes cuyo token venció (quedan anotadas). Cuántas. */
  descartarPendientesVencidas(now: Date): Promise<number>;
  /** Objetos anotados para borrar cuyo plazo ya llegó (hasta `limite`). */
  aBorrarVencidos(now: Date, limite: number): Promise<string[]>;
  /** Saca esas rutas de avatares_a_borrar (ya se borraron del bucket). */
  quitarDeABorrar(rutas: readonly string[]): Promise<void>;
  /** De esas rutas, las que la base conoce (vigente, pendiente o anotada para borrar). */
  rutasConocidas(rutas: readonly string[]): Promise<Set<string>>;
}
