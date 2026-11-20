import type { Turno } from '../api/types';
import { useSesion, useUsuario } from '../session/SessionContext';

/** ¿Esta persona puede mover el auto de etapa? El empleado, solo en los suyos (el backend lo vuelve a mirar). */
export function usePuedeCambiarEtapa(): (lavado: Turno) => boolean {
  const usuario = useUsuario();
  const { puede } = useSesion();
  const tiene = puede('lavados.etapa');
  return (lavado) => tiene && (usuario.rol !== 'empleado' || lavado.trabajador?.id === usuario.id);
}

