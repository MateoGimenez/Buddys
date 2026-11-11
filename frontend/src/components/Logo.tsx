import { useState } from 'react';
import { logoUrl } from '../config/enlaces';
import { marca, sitio } from '../config/sitio';
import { useTema } from '../tema/useTema';

/**
 * Logo de Buddys Wash Detail. Si en `sitio.ts` está cargado `logo` (ej.: '/logo.png'),
 * se muestra esa imagen; si está vacío —o el archivo no carga— se muestra el
 * wordmark tipográfico: "BUDDYS" cromado y "Wash Detail" en letra script.
 * Con el tema claro usa la versión para fondo claro (`marca.logoClaro`).
 */

interface Props {
  className?: string;
  tamano?: 'chico' | 'normal' | 'grande';
}

export function Logo({ className, tamano = 'normal' }: Props) {
  const tema = useTema();
  const logo = logoUrl();
  const ruta = logo && tema === 'claro' ? marca.logoClaro : logo;
  const [fallo, setFallo] = useState(false);
  const clases = ['logo', `logo--${tamano}`, className].filter(Boolean).join(' ');

  if (ruta && !fallo) {
    return (
      <span className={clases}>
        <img
          className="logo__imagen"
          src={ruta}
          width={sitio.logoAncho || undefined}
          height={sitio.logoAlto || undefined}
          alt="Buddys Wash Detail"
          decoding="async"
          onError={() => {
            setFallo(true);
          }}
        />
      </span>
    );
  }

  return (
    <span className={clases}>
      <span className="logo__texto" role="img" aria-label="Buddys Wash Detail">
        <span className="logo__mg" aria-hidden="true">
          BUDDYS
        </span>
        <span className="logo__script" aria-hidden="true">
          Wash Detail
        </span>
      </span>
    </span>
  );
}
