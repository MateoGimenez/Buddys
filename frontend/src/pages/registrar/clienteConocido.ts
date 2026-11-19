// Al escribir la patente en Registrar: sugerencias de patentes/modelos ya anotados y, si la patente es de un cliente
// conocido, su historial (para completar nombre y teléfono y mostrar la tarjeta de sellos).
import { useEffect, useRef, useState } from 'react';
import { buscarTurnos, historialCliente, type Cliente } from '../../api/clientes';
import { patenteEn } from '../../lib/patente';

const ESPERA_MS = 400;
const MAX_SUGERENCIAS = 8;

function compacto(texto: string): string {
  return texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * `onConocido` se llama una vez por cliente reconocido (para autocompletar sin pisar lo que se escribió).
 * Sin señal no pregunta nada.
 */
export function useClienteConocido(
  texto: string,
  onConocido: (c: Cliente) => void,
): { cliente: Cliente | null; sugerencias: string[] } {
  const [cliente, setCliente] = useState<{ patente: string; c: Cliente } | null>(null);
  const [sugerencias, setSugerencias] = useState<{ q: string; lista: string[] } | null>(null);
  const avisar = useRef(onConocido);
  useEffect(() => {
    avisar.current = onConocido;
  });
  const patente = patenteEn(texto)?.patente ?? null;
  const q = compacto(texto);

  useEffect(() => {
    if (!patente || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    let vigente = true;
    const t = window.setTimeout(() => {
      historialCliente({ patente })
        .then((r) => {
          if (!vigente) return;
          setCliente({ patente, c: r.cliente });
          avisar.current(r.cliente);
        })
        .catch(() => {
          // 404 = patente nueva; cualquier otra cosa tampoco frena el registro.
        });
    }, ESPERA_MS);
    return () => {
      vigente = false;
      window.clearTimeout(t);
    };
  }, [patente]);

  useEffect(() => {
    if (q.length < 5 || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    let vigente = true;
    const t = window.setTimeout(() => {
      buscarTurnos(q, 20)
        .then((r) => {
          if (!vigente) return;
          const vistos = new Set<string>();
          for (const b of r.bookings) {
            if (b.vehiculoModelo && compacto(b.vehiculoModelo).includes(q)) vistos.add(b.vehiculoModelo);
            if (vistos.size >= MAX_SUGERENCIAS) break;
          }
          setSugerencias({ q, lista: [...vistos] });
        })
        .catch(() => {
          // sin sugerencias
        });
    }, ESPERA_MS);
    return () => {
      vigente = false;
      window.clearTimeout(t);
    };
  }, [q]);

  const vigente = patente && cliente?.patente === patente ? cliente.c : null;
  const lista = sugerencias && q.startsWith(sugerencias.q) ? sugerencias.lista.filter((s) => compacto(s).includes(q)) : [];
  // Lo que ya está escrito tal cual no hace falta sugerirlo.
  const unicas = [...new Set([...lista, ...(vigente?.vehiculos ?? [])])].filter((s) => s !== texto.trim());
  return { cliente: vigente, sugerencias: unicas };
}
