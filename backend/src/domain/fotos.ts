/**
 * Fotos antes/después de un lavado o turno (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 13). El
 * archivo vive en el bucket PRIVADO `lavados-fotos` de Supabase Storage; la base guarda la ruta y quién la subió.
 *
 * Flujo: pedir la URL firmada (la foto nace 'pendiente') -> el panel sube con PUT -> confirmar (el backend verifica en
 * Storage que el objeto existe, su tamaño y su tipo, y la pasa a 'lista'). Solo las 'lista' se muestran; las
 * pendientes cuentan para el tope. Lo que se borra queda anotado (fotos_a_borrar) para volver a borrar el objeto
 * cuando venza el token de subida; la conciliación lo hace al arrancar y cada hora.
 */

export const BUCKET_FOTOS = 'lavados-fotos';
export const TIPOS_FOTO = ['antes', 'despues'] as const;
export type TipoFoto = (typeof TIPOS_FOTO)[number];
export const CONTENT_TYPES_FOTO = ['image/jpeg', 'image/webp'] as const;
export type ContentTypeFoto = (typeof CONTENT_TYPES_FOTO)[number];
export const ESTADOS_FOTO = ['pendiente', 'lista'] as const;
export type EstadoFoto = (typeof ESTADOS_FOTO)[number];
/** 1,5 MB: el panel las achica antes de subirlas. Mismo tope que el bucket y que el CHECK de la tabla. */
export const FOTO_TAMANO_MAX = 1_572_864;
/** Hasta cuántas fotos (pendientes incluidas) puede tener un turno o lavado. */
export const MAX_FOTOS_POR_TURNO = 6;
/** Segundos que vale una URL firmada de lectura. */
export const LECTURA_SEGUNDOS = 300;
/** Lo que vale el token de una URL firmada de subida de Supabase (fijo: no se puede acortar). */
export const SUBIDA_VALE_MS = 2 * 60 * 60 * 1000;
/** Cada cuánto corre la conciliación del bucket. */
export const CONCILIACION_CADA_MS = 60 * 60 * 1000;

export const EXTENSION_FOTO: Readonly<Record<ContentTypeFoto, 'jpg' | 'webp'>> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export interface Foto {
  id: string;
  bookingId: string;
  tipo: TipoFoto;
  /** Ruta del objeto en el bucket: <bookingId>/<id>.<ext>. No sale por la API. */
  path: string;
  contentType: ContentTypeFoto;
  tamano: number;
  estado: EstadoFoto;
  creadaPor: { id: string; nombre: string } | null;
  createdAt: string;
  /** Hasta cuándo vale el token de subida (ISO 8601). */
  subidaVence: string;
}

export interface NuevaFoto {
  id: string;
  bookingId: string;
  tipo: TipoFoto;
  path: string;
  contentType: ContentTypeFoto;
  tamano: number;
  creadaPor: string;
  /** El reloj de la app (los plazos se cuentan desde acá). */
  createdAt: Date;
  subidaVence: Date;
}

/** El turno ya tiene MAX_FOTOS_POR_TURNO fotos (pendientes incluidas). */
export class MaximoFotosError extends Error {
  constructor() {
    super('El turno ya tiene el máximo de fotos.');
    this.name = 'MaximoFotosError';
  }
}

export interface FotoRepository {
  /** Las fotos de un turno, en el orden en que se subieron (con `soloListas`, sin las pendientes). */
  listar(bookingId: string, soloListas: boolean): Promise<Foto[]>;
  /** En una transacción con un bloqueo por turno: cuenta (pendientes incluidas) y guarda. Lanza MaximoFotosError. */
  crear(nueva: NuevaFoto): Promise<Foto>;
  /** undefined si no existe (o el id no es un UUID). */
  obtener(id: string): Promise<Foto | undefined>;
  /** Pasa una pendiente a 'lista'. undefined si no existe. */
  confirmar(id: string): Promise<Foto | undefined>;
  /** true si existía y se borró (el trigger anota el objeto en fotos_a_borrar). */
  borrar(id: string): Promise<boolean>;
  /** Borra las pendientes cuyo token de subida venció (quedan anotadas para borrar el objeto). Cuántas. */
  borrarPendientesVencidas(now: Date): Promise<number>;
  /** Objetos anotados para borrar cuyo plazo ya llegó (hasta `limite`). */
  aBorrarVencidos(now: Date, limite: number): Promise<string[]>;
  /** Saca esas rutas de fotos_a_borrar (ya se borraron del bucket). */
  quitarDeABorrar(rutas: readonly string[]): Promise<void>;
  /** De esas rutas, las que la base conoce (una foto o un objeto anotado para borrar). */
  rutasConocidas(rutas: readonly string[]): Promise<Set<string>>;
}
