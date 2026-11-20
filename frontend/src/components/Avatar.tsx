import { useState, type CSSProperties } from 'react';
import { urlFoto } from '../api/endpoints';
import { iniciales, tonoDe } from '../lib/avatar';

export interface DatosAvatar {
  id: string;
  nombre: string | null;
  email: string | null;
  fotoVersion: string | null;
}

/**
 * La foto de perfil, o las iniciales sobre un color fijo por persona. Siempre decorativo (`aria-hidden`): el nombre
 * está escrito al lado. Tamaño fijo, así la fila no salta cuando llega la imagen.
 */
export function Avatar({ persona, tamano = 40, className }: { persona: DatosAvatar; tamano?: number; className?: string }) {
  const src = persona.fotoVersion ? urlFoto(persona.id, persona.fotoVersion) : null;
  // La URL que falló (404, sin red): se vuelve a las iniciales. Con una versión nueva hay otra URL y se reintenta.
  const [fallida, setFallida] = useState<string | null>(null);
  const conFoto = src !== null && src !== fallida;
  const estilo = { '--avatar-tam': `${String(tamano)}px` } as CSSProperties;

  return (
    <span
      className={`avatar ${className ?? ''}`}
      style={estilo}
      data-tono={tonoDe(persona.id)}
      data-foto={conFoto ? '' : undefined}
      aria-hidden
    >
      {conFoto ? (
        <img
          src={src}
          alt=""
          width={tamano}
          height={tamano}
          loading="lazy"
          decoding="async"
          onError={() => {
            setFallida(src);
          }}
        />
      ) : (
        <span className="avatar-iniciales">{iniciales(persona.nombre, persona.email)}</span>
      )}
    </span>
  );
}
