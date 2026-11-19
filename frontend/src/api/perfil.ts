// Perfil de quien está usando el panel (contrato 2026-11-16, reportes/2026-11-16_04_contrato-perfil.md): nombre, foto
// y contraseña. La foto no pasa por el backend: la API da una URL firmada de Supabase Storage, el panel sube ahí con
// PUT y después confirma. Para mirar, avatarUrl es una lectura firmada que vence (avatarVenceEl, ~1 h). Con las fotos
// apagadas en el servidor, avatarUrl es siempre null y las rutas de la foto responden 503.
import { api } from './client';
import type { Rol } from './types';
import { subirArchivo } from './fotos';

export type FormatoAvatar = 'image/webp' | 'image/jpeg';

/** Lo que acepta el backend para la foto de perfil. */
export const AVATAR_BYTES_MAX = 524_288;
export const AVATAR_LADO = 400;
export const NOMBRE_MIN = 2;
export const NOMBRE_MAX = 60;
export const CLAVE_MIN = 8;

export interface Perfil {
  id: string;
  email: string | null;
  nombre: string | null;
  rol: Rol;
  /** null sin foto o con Storage apagado. */
  avatarUrl: string | null;
  avatarVenceEl: string | null;
  creadoEl: string;
}

export interface SubidaAvatar {
  url: string;
  metodo: 'PUT';
  headers: Record<string, string>;
  venceEl: string;
}

export const miPerfil = () => api<{ perfil: Perfil }>('/api/admin/perfil');

export const cambiarNombre = (nombre: string) => api<{ perfil: Perfil }>('/api/admin/perfil', { method: 'PATCH', body: { nombre } });

/** Paso 1: pide la URL firmada para subir la foto. */
export const pedirSubidaAvatar = (datos: { contentType: FormatoAvatar; tamano: number }) =>
  api<{ subida: SubidaAvatar }>('/api/admin/perfil/avatar', { method: 'POST', body: datos });

/** Paso 2: el archivo va directo a Storage (otro origen, sin cookies). */
export const subirAvatar = (subida: SubidaAvatar, archivo: Blob) => subirArchivo(subida, archivo);

/** Paso 3: el backend verifica que llegó y la deja como foto de perfil. 409 si no llegó o venció; 400 si no sirve. */
export const confirmarAvatar = () => api<{ perfil: Perfil }>('/api/admin/perfil/avatar/confirmar', { method: 'POST' });

export const sacarAvatar = () => api<undefined>('/api/admin/perfil/avatar', { method: 'DELETE' });

/** 204 si salió; 400 si la actual no coincide. */
export const cambiarClave = (actual: string, nueva: string) =>
  api<undefined>('/api/admin/perfil/clave', { method: 'POST', body: { actual, nueva } });
