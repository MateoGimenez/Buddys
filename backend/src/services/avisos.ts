import type { EstadisticasRepository } from '../domain/estadisticas.js';
import { type MetaRepository, limitesDelMes, metaCumplida } from '../domain/metas.js';
import { todayInLaRioja } from '../lib/dates.js';
import type { Logger } from '../lib/logger.js';
import type { PushService } from './push.js';

/** Nombre de cada mes para el aviso ("Llegaron a la meta de noviembre."). */
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

export interface AvisoServiceDeps {
  push: PushService;
  metas: MetaRepository;
  estadisticas: EstadisticasRepository;
  logger: Logger;
  now: () => Date;
}

/**
 * Disparadores de los avisos push al encargado (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 7). Van
 * a admin y superadmin (PushService.avisarEquipo). Sin claves VAPID no hacen nada: ni consultan la base.
 *
 * Decisión del "lavado sin monto": se avisa AL REGISTRARLO (no a fin del día): no necesita un cron y el encargado se
 * entera mientras el cliente todavía está en el taller.
 *
 * Todo es "dispará y olvidate": los métodos nunca se rechazan y quien los llama no los espera (un aviso no puede
 * demorar ni tirar el registro de un lavado).
 */
export class AvisoService {
  constructor(private readonly deps: AvisoServiceDeps) {}

  /** Un lavado recién registrado sin monto: aviso a los encargados, menos a quien lo registró. */
  lavadoSinMonto(registradoPor: string): void {
    if (!this.deps.push.disponible) return;
    void this.deps.push.avisarEquipo(
      {
        titulo: 'Lavado sin monto',
        cuerpo: 'Se registró un lavado sin monto: completalo desde la planilla.',
        url: '/admin/lavados',
      },
      registradoPor,
    );
  }

  /**
   * Después de algo que mueve los ingresos o los trabajos del mes (registrar un lavado, completar o cobrar un turno):
   * si la meta del mes en curso quedó cumplida y todavía no se avisó, se avisa una sola vez (la marca en la base decide
   * quién avisa si llegan dos a la vez).
   */
  revisarMeta(): void {
    if (!this.deps.push.disponible) return;
    void this.revisar().catch(() => {
      this.deps.logger.warn('No se pudo revisar la meta del mes para el aviso push');
    });
  }

  private async revisar(): Promise<void> {
    const { metas, estadisticas, push, now } = this.deps;
    const ahora = now();
    const mes = todayInLaRioja(ahora).slice(0, 7);
    const meta = await metas.obtener(mes);
    if (meta === null) return;
    const { desde, hasta } = limitesDelMes(mes);
    const totales = await estadisticas.totales([{ clave: 'mes', desde, hasta }]);
    const avance = { ingresos: totales.mes?.ingresos ?? 0, trabajos: totales.mes?.completados ?? 0 };
    if (!metaCumplida(meta, avance)) return;
    if (!(await metas.marcarCumplidaAvisada(mes, ahora))) return;
    const nombreMes = MESES[Number(mes.slice(5, 7)) - 1] ?? 'este mes';
    await push.avisarEquipo(
      { titulo: '¡Meta cumplida!', cuerpo: `Llegaron a la meta de ${nombreMes}.`, url: '/admin/metas' },
      null,
    );
  }
}
