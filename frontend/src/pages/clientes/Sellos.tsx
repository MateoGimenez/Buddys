import { Star } from 'lucide-react';
import type { Sellos } from '../../api/clientes';
import { Tilde } from '../../components/ElegirServicios';
import { textoPremio } from '../../lib/sellos';

/**
 * La tarjeta de sellos del cliente: una casilla por lavado y, al final, la del premio. Las selladas llevan la tilde,
 * como el sello de goma en la tarjeta de cartón.
 */
export function TarjetaSellos({ sellos }: { sellos: Sellos }) {
  const premio = textoPremio(sellos.premio, sellos.porcentaje);
  return (
    <section className="hoja bloque sellos" aria-labelledby="sellos-titulo">
      <h2 id="sellos-titulo" className="bloque-titulo">
        Tarjeta de sellos
      </h2>
      <ol className="sellos-casillas" aria-label={`${String(sellos.sellos)} de ${String(sellos.cada)} sellos`}>
        {Array.from({ length: sellos.cada }, (_, i) => (
          <li key={i} className="sellos-casilla" data-sellada={i < sellos.sellos ? '' : undefined} aria-hidden>
            {i < sellos.sellos ? <Tilde size={18} /> : <span className="sellos-numero">{i + 1}</span>}
          </li>
        ))}
        <li className="sellos-casilla sellos-premio" data-listo={sellos.proximoEsPremio ? '' : undefined} aria-hidden>
          <Star size={18} />
        </li>
      </ol>
      <p className="sellos-texto">
        {sellos.proximoEsPremio ? (
          <strong>¡El próximo lavado es el premio: {premio}!</strong>
        ) : (
          <>
            {sellos.sellos} de {sellos.cada} sellos. Faltan <strong>{sellos.faltan}</strong> para {premio}.
          </>
        )}
      </p>
    </section>
  );
}
