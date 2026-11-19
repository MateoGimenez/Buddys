import { UserRound } from 'lucide-react';
import { useState } from 'react';
import { iniciales } from '../lib/format';

type Tamano = 'chico' | 'medio' | 'grande';
const PX: Record<Tamano, number> = { chico: 32, medio: 40, grande: 128 };

interface Props {
  nombre: string | null | undefined;
  url: string | null | undefined;
  tamano?: Tamano;
  /** Sin foto: el ícono de persona en vez de las iniciales (el botón del encabezado). */
  sinFoto?: 'iniciales' | 'icono';
  /** Texto alternativo de la foto. Por defecto es decorativa: el nombre ya está escrito al lado. */
  alt?: string;
}

/**
 * La foto de perfil en un círculo. Si no hay foto (o la URL venció y no carga), las iniciales sobre fondo de tinta
 * clara, o el ícono de persona.
 */
export function Avatar({ nombre, url, tamano = 'chico', sinFoto = 'iniciales', alt }: Props) {
  // Si la URL falla (venció, sin red), se recuerda cuál falló: una URL nueva se vuelve a intentar.
  const [fallo, setFallo] = useState<string | null>(null);
  const px = PX[tamano];
  const conFoto = url && fallo !== url;
  return (
    <span className="avatar" data-tamano={tamano} aria-hidden={alt ? undefined : true} role={alt && !conFoto ? 'img' : undefined} aria-label={alt && !conFoto ? alt : undefined}>
      {conFoto ? (
        <img
          src={url}
          alt={alt ?? ''}
          width={px}
          height={px}
          decoding="async"
          onError={() => {
            setFallo(url);
          }}
        />
      ) : sinFoto === 'icono' ? (
        <UserRound size={Math.round(px * 0.6)} aria-hidden />
      ) : (
        <span className="avatar-iniciales">{iniciales(nombre)}</span>
      )}
    </span>
  );
}
