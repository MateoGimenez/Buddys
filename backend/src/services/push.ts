import type { PushConfig } from '../config.js';
import type { Booking } from '../domain/booking.js';
import {
  type BookingPushNotifier,
  type DestinoPush,
  type NuevaSuscripcion,
  type PayloadPush,
  PushError,
  type PushRepository,
  type PushSender,
  type StockPushNotifier,
  esEndpointPermitido,
} from '../domain/push.js';
import { type InsumoBajo, textoAvisoStock } from '../domain/inventario.js';
import { ROLES } from '../domain/perfil.js';
import { puedeVerConsumoInventario, recibeAvisosDeEquipo } from '../domain/permisos.js';
import type { Logger } from '../lib/logger.js';
import { descripcionTurno } from '../notifications/message.js';

/** Tope de cada envío (todos van en paralelo): un servicio de push lento no demora a los demás. */
export const PUSH_TIMEOUT_MS = 5000;

export interface PushServiceDeps {
  repo: PushRepository;
  /** Las claves VAPID. undefined = avisos apagados. */
  config: PushConfig | undefined;
  /** Cliente de envío (web-push en producción, un doble en los tests). Sin él, tampoco se manda. */
  sender: PushSender | undefined;
  logger: Logger;
  now: () => Date;
  timeoutMs?: number;
}

type Resultado = 'enviado' | 'caducado' | 'fallido';

/**
 * Avisos push de turnos nuevos y de stock bajo. Los endpoints de suscripción (alta y baja), el envío al crear un turno
 * público y el aviso de insumos que cruzaron su mínimo (reportes/2026-11-17_06_recetas-stock-avisos.md, regla 7).
 *
 * Privacidad: el aviso de turno dice solo "<servicio> · <día corto> · <franja>" y la cantidad de pendientes; el de
 * stock, el insumo, su stock y su mínimo (nunca plata). Los logs llevan solo cantidades: nunca el endpoint, las claves
 * de la suscripción ni las VAPID.
 */
export class PushService implements BookingPushNotifier, StockPushNotifier {
  constructor(private readonly deps: PushServiceDeps) {}

  /** true si hay claves VAPID y cliente de envío. */
  get disponible(): boolean {
    return this.deps.config !== undefined && this.deps.sender !== undefined;
  }

  /** GET /api/admin/push/estado: la clave pública solo se publica si el envío está disponible. */
  estado(): { disponible: boolean; clavePublica: string | null } {
    const clave = this.deps.config?.publicKey;
    return this.disponible && clave !== undefined
      ? { disponible: true, clavePublica: clave }
      : { disponible: false, clavePublica: null };
  }

  /** Guarda el dispositivo de `perfilId` (reasigna el endpoint si era de otra persona). */
  async suscribir(perfilId: string, suscripcion: NuevaSuscripcion): Promise<void> {
    await this.deps.repo.guardar(perfilId, suscripcion);
    this.deps.logger.info(`Dispositivo push registrado por=${perfilId}`);
  }

  /** Borra el dispositivo con ese endpoint; no falla si no existía. */
  async desuscribir(endpoint: string, perfilId: string): Promise<void> {
    const existia = await this.deps.repo.borrarPorEndpoint(endpoint);
    if (existia) this.deps.logger.info(`Dispositivo push quitado por=${perfilId}`);
  }

  /** Nunca se rechaza. Con el push apagado no hace nada (ni siquiera consulta la base). */
  async avisarTurnoNuevo(booking: Booking, servicioNombre: string): Promise<void> {
    if (!this.disponible) return;
    try {
      const destinos = await this.deps.repo.destinosActivos();
      if (destinos.length === 0) return;
      const pendientes = await this.deps.repo.contarPendientes();
      await this.difundir('Aviso push', destinos, {
        tipo: 'turno',
        titulo: 'Turno nuevo',
        cuerpo: descripcionTurno(servicioNombre, booking.fechaPreferida, booking.franja),
        pendientes,
        // La Planilla del panel (frontend/src/components/Layout.tsx, SECCIONES): la ven todos los roles con turnos.ver.
        url: '/planilla',
      });
    } catch {
      this.deps.logger.warn('Aviso push falló (error al leer los dispositivos)');
    }
  }

  /**
   * Un solo aviso con los insumos que cruzaron su mínimo en un pedido, a los dispositivos de las personas activas con
   * inventario.consumo (admin y superadmin; domain/permisos.ts). Nunca se rechaza; sin insumos o con el push apagado
   * no hace nada.
   */
  async avisarStockBajo(insumos: readonly InsumoBajo[]): Promise<void> {
    if (!this.disponible || insumos.length === 0) return;
    try {
      const destinos = await this.deps.repo.destinosConRol(ROLES.filter(puedeVerConsumoInventario));
      if (destinos.length === 0) return;
      const pendientes = await this.deps.repo.contarPendientes();
      await this.difundir('Aviso push de stock bajo', destinos, { tipo: 'stock', ...textoAvisoStock(insumos), pendientes });
    } catch {
      this.deps.logger.warn('Aviso push de stock bajo falló (error al leer los dispositivos)');
    }
  }

  /**
   * Aviso a los encargados (lavado sin monto, meta cumplida): a los dispositivos de las personas activas con un rol
   * que recibe los avisos del equipo (domain/permisos.ts: admin y superadmin), menos a quien lo provocó. Nunca se
   * rechaza; con el push apagado no hace nada (ni consulta la base). No lleva datos del cliente ni importes.
   */
  async avisarEquipo(aviso: { titulo: string; cuerpo: string; url: string }, excluirPerfilId: string | null): Promise<void> {
    if (!this.disponible) return;
    try {
      const destinos = await this.deps.repo.destinosConRol(ROLES.filter(recibeAvisosDeEquipo), excluirPerfilId);
      if (destinos.length === 0) return;
      const pendientes = await this.deps.repo.contarPendientes();
      await this.difundir('Aviso push al equipo', destinos, { tipo: 'equipo', ...aviso, pendientes });
    } catch {
      this.deps.logger.warn('Aviso push al equipo falló (error al leer los dispositivos)');
    }
  }

  /** Manda el aviso a todos en paralelo, borra los caducados, marca los entregados y deja un resumen en el log. */
  private async difundir(etiqueta: string, destinos: DestinoPush[], payload: PayloadPush): Promise<void> {
    const { repo, sender, logger, now } = this.deps;
    if (sender === undefined) return;
    const texto = JSON.stringify(payload);

    const resultados = await Promise.all(destinos.map((destino) => this.enviar(sender, destino, texto)));
    const idsDe = (resultado: Resultado): string[] =>
      destinos.filter((_, i) => resultados[i] === resultado).map((destino) => destino.id);
    const caducados = idsDe('caducado');
    const enviados = idsDe('enviado');
    const fallidos = resultados.length - caducados.length - enviados.length;

    // El mantenimiento de la tabla no puede tirar el resumen: cada paso se atrapa por separado.
    await repo.borrarPorIds(caducados).catch(() => undefined);
    await repo.marcarAvisados(enviados, now()).catch(() => undefined);
    logger.info(
      `${etiqueta}: enviados=${String(enviados.length)} caducados=${String(caducados.length)} fallidos=${String(fallidos)}`,
    );
  }

  /** Un envío con tope de tiempo. 404/410 = la suscripción ya no existe (se borra); el resto, solo se cuenta. */
  private async enviar(sender: PushSender, destino: DestinoPush, payload: string): Promise<Resultado> {
    // Defensa en profundidad contra SSRF: un endpoint que hoy no pasa la lista no recibe pedidos.
    if (!esEndpointPermitido(destino.endpoint)) return 'caducado';
    let timer: NodeJS.Timeout | undefined;
    try {
      const tope = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new PushError(0));
        }, this.deps.timeoutMs ?? PUSH_TIMEOUT_MS);
      });
      // Si el envío gana la carrera, el tope queda sin escuchar: se atrapa para que no sea un rechazo sin manejar.
      tope.catch(() => undefined);
      await Promise.race([sender.send(destino, payload), tope]);
      return 'enviado';
    } catch (error) {
      return error instanceof PushError && (error.status === 404 || error.status === 410) ? 'caducado' : 'fallido';
    } finally {
      clearTimeout(timer);
    }
  }
}
