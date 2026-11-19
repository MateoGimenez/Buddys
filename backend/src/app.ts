import express, { type Express } from 'express';
import type { JWTVerifyGetKey } from 'jose';
import type { AppConfig } from './config.js';
import type { BookingNotifier } from './domain/notifier.js';
import type { PushSender } from './domain/push.js';
import { createAccessTokenVerifier, createSupabaseJwks } from './lib/access-token.js';
import { SessionCookies } from './lib/cookies.js';
import { type Logger, createLogger } from './lib/logger.js';
import { SupabaseAdminClient } from './lib/supabase-admin.js';
import { type FetchFn, SupabaseAuthClient } from './lib/supabase-auth.js';
import { SupabaseStorageClient } from './lib/supabase-storage.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { type PlazosCuerpo, plazoDelCuerpo } from './middleware/plazo-cuerpo.js';
import { createRateLimiters } from './middleware/rate-limit.js';
import { requestLogger } from './middleware/request-logger.js';
import { securityHeaders } from './middleware/security.js';
import { NOTIFY_TIMEOUT_MS, createNotifier } from './notifications/index.js';
import { createWebPushSender } from './notifications/push.js';
import { createCanalesRecordatorio } from './notifications/recordatorio.js';
import type { Repositories } from './repositories/index.js';
import { createApiRouter } from './routes/index.js';
import { AgendaService } from './services/agenda.js';
import { AuthService } from './services/auth.js';
import { BookingService } from './services/bookings.js';
import { ComprobanteService } from './services/comprobantes.js';
import { DisponibilidadService } from './services/disponibilidad.js';
import { EstadisticasService } from './services/estadisticas.js';
import { GastoService } from './services/gastos.js';
import { InventarioService } from './services/inventario.js';
import { LavadoService } from './services/lavados.js';
import { MetaService } from './services/metas.js';
import { PerfilService } from './services/perfil.js';
import { PresupuestoService } from './services/presupuestos.js';
import { PUSH_TIMEOUT_MS, PushService } from './services/push.js';
import { RecetaService } from './services/recetas.js';
import { RecordatorioService } from './services/recordatorios.js';
import { ServicioService } from './services/servicios.js';
import { TallerService } from './services/taller.js';
import { UsuarioService } from './services/usuarios.js';
import { AvisoService } from './services/avisos.js';
import { CajaService } from './services/caja.js';
import { ClienteService } from './services/clientes.js';
import { FotoService, type ResultadoConciliacion } from './services/fotos.js';
import { GastoFijoService } from './services/gastos-fijos.js';
import { TurnoPanelService } from './services/turnos.js';
import { StorageFirmadoClient } from './lib/supabase-storage-firmado.js';
import { BUCKET_FOTOS, CONCILIACION_CADA_MS } from './domain/fotos.js';

export interface AppDeps {
  config: AppConfig;
  /** Repositorios sobre una base Postgres ya migrada (ver db/database.ts). */
  repositories: Repositories;
  /** Resuelve si la base responde; se rechaza si no (para /api/health). */
  checkDatabase: () => Promise<void>;
  logger?: Logger;
  /** Reloj inyectable (los tests lo fijan). */
  now?: () => Date;
  /** fetch inyectable para los avisos y los recordatorios (los tests nunca tocan la red). */
  fetch?: FetchFn;
  /** fetch inyectable para Supabase Auth (los tests usan un Supabase Auth falso). */
  authFetch?: FetchFn;
  /** fetch inyectable para Supabase Storage (los tests usan un Storage falso en memoria). */
  storageFetch?: FetchFn;
  /** Claves para verificar los access tokens. Por defecto, el JWKS remoto del proyecto (con caché). */
  jwks?: JWTVerifyGetKey;
  /** Pisa al notificador elegido por la config (tests). */
  notifier?: BookingNotifier;
  /** Pisa al cliente de envío push (web-push) para que los tests no toquen la red. */
  pushSender?: PushSender;
  /** Plazos para recibir el cuerpo (por defecto 10 s y 30 s la foto; los tests los acortan). */
  plazosCuerpo?: PlazosCuerpo;
  /**
   * Programa las tareas de fondo (la conciliación del bucket de fotos: al arrancar y cada hora, con un timer que no
   * retiene el proceso). Solo index.ts la prende; los tests llaman a `conciliarFotos(app)` a mano.
   */
  tareasProgramadas?: boolean;
}

/** La conciliación del bucket de fotos de esta app (para index.ts y los tests). */
export function conciliarFotos(app: Express): Promise<ResultadoConciliacion | undefined> {
  const conciliar = (app.locals as { conciliarFotos?: () => Promise<ResultadoConciliacion | undefined> }).conciliarFotos;
  return conciliar === undefined ? Promise.resolve(undefined) : conciliar();
}


/**
 * Arma la aplicación Express SIN ponerla a escuchar (index.ts hace el listen; los tests usan supertest).
 * No abre ni cierra la base: quien la crea la administra.
 */
export function createApp(deps: AppDeps): Express {
  const { config, checkDatabase } = deps;
  const logger = deps.logger ?? createLogger();
  const now = deps.now ?? (() => new Date());

  const {
    bookings,
    perfiles,
    servicios,
    disponibilidad,
    push: pushRepo,
    estadisticas: estadisticasRepo,
    gastos: gastosRepo,
    metas: metasRepo,
    taller: tallerRepo,
    inventario: inventarioRepo,
    recetas: recetasRepo,
    presupuestos: presupuestosRepo,
    comprobantes: comprobantesRepo,
    clientes: clientesRepo,
    fotos: fotosRepo,
    gastosFijos: gastosFijosRepo,
    caja: cajaRepo,
    exportar,
  } = deps.repositories;
  const push = new PushService({
    repo: pushRepo,
    config: config.push,
    sender: deps.pushSender ?? (config.push === undefined ? undefined : createWebPushSender(config.push, PUSH_TIMEOUT_MS)),
    logger,
    now,
  });
  const bookingService = new BookingService({
    bookings,
    servicios,
    disponibilidad,
    logger,
    notifier: deps.notifier ?? createNotifier(config.whatsapp, config.publicUrl, deps.fetch),
    push,
  });
  const supabaseAuth = new SupabaseAuthClient(config.supabase, deps.authFetch);
  const auth = new AuthService({
    supabase: supabaseAuth,
    verifyAccessToken: createAccessTokenVerifier({
      getKey: deps.jwks ?? createSupabaseJwks(config.supabase.jwksUrl),
      issuer: config.supabase.authUrl,
      now,
    }),
    perfiles,
    logger,
  });
  const { secretKey } = config.supabase;
  const supabaseAdmin =
    secretKey === undefined
      ? undefined
      : new SupabaseAdminClient({ authUrl: config.supabase.authUrl, secretKey }, deps.authFetch);
  // Fotos de perfil: Storage con la misma secret key (sin ella, no hay fotos: 503 y fotosDisponibles = false).
  const storage =
    secretKey === undefined
      ? undefined
      : new SupabaseStorageClient({ url: config.supabase.url, secretKey }, deps.storageFetch);
  const usuarios = new UsuarioService({ perfiles, admin: supabaseAdmin, storage, logger, now });
  const perfil = new PerfilService({ perfiles, auth: supabaseAuth, admin: supabaseAdmin, storage, logger, now });
  // El aviso de stock bajo (push a admin y superadmin) sale de los lavados, de su corrección y de los movimientos.
  const avisosEquipo = new AvisoService({ push, metas: metasRepo, estadisticas: estadisticasRepo, logger, now });
  // Fotos de los lavados (función 13): otro cliente de Storage, con URLs firmadas. Sin SUPABASE_SECRET_KEY, apagadas.
  const storageFotos =
    secretKey === undefined
      ? undefined
      : new StorageFirmadoClient({ url: config.supabase.url, secretKey, bucket: BUCKET_FOTOS }, deps.storageFetch);
  const fotos = new FotoService({ fotos: fotosRepo, bookings, storage: storageFotos, logger, now });
  // El aviso de stock bajo (push a admin y superadmin) sale de los lavados, de su corrección y de los movimientos.
  const agenda = new AgendaService({ bookings, servicios, perfiles, logger, now, avisos: push, avisosEquipo });
  const lavados = new LavadoService({ bookings, servicios, perfiles, logger, now, avisos: push, avisosEquipo, fotos });
  const turnos = new TurnoPanelService({ bookings, servicios, logger, now });
  const clientes = new ClienteService({ clientes: clientesRepo, logger, now });
  const gastosFijos = new GastoFijoService({ gastosFijos: gastosFijosRepo, perfiles, logger, now });
  const caja = new CajaService({ caja: cajaRepo, logger, now });
  const estadisticas = new EstadisticasService({ estadisticas: estadisticasRepo, now });
  const servicioService = new ServicioService({ servicios, logger, now });
  const disponibilidadService = new DisponibilidadService({ disponibilidad, logger, now });
  const gastos = new GastoService({ gastos: gastosRepo, logger, now });
  const metas = new MetaService({
    metas: metasRepo,
    estadisticas: estadisticasRepo,
    disponibilidad: disponibilidadService,
    logger,
    now,
  });
  const taller = new TallerService({ taller: tallerRepo, logger, now });
  const inventario = new InventarioService({ inventario: inventarioRepo, logger, now, avisos: push });
  const recetas = new RecetaService({ recetas: recetasRepo, servicios, logger });
  const presupuestos = new PresupuestoService({ presupuestos: presupuestosRepo, logger, now });
  const comprobantes = new ComprobanteService({ comprobantes: comprobantesRepo, logger, now });
  const recordatorios = new RecordatorioService({
    bookings,
    canales: createCanalesRecordatorio(config.recordatorios, {
      fetch: deps.fetch ?? fetch,
      publicUrl: config.publicUrl,
      timeoutMs: NOTIFY_TIMEOUT_MS,
    }),
    logger,
    now,
  });
  const cookies = new SessionCookies(config);
  const limiters = createRateLimiters(config.rateLimits);

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false); // la API no usa validadores de caché; Cache-Control: no-store
  app.set('query parser', 'simple'); // sin objetos anidados en la query (menos superficie)
  app.set('trust proxy', config.trustProxy);

  app.use(requestLogger(logger));
  app.use(securityHeaders(config));
  app.use('/api', plazoDelCuerpo(deps.plazosCuerpo));
  app.use(
    '/api',
    createApiRouter({
      config,
      logger,
      now,
      checkDatabase,
      bookings,
      perfiles,
      estadisticas,
      bookingService,
      agenda,
      lavados,
      disponibilidad: disponibilidadService,
      recordatorios,
      push,
      auth,
      usuarios,
      perfil,
      servicios: servicioService,
      gastos,
      metas,
      taller,
      inventario,
      recetas,
      presupuestos,
      comprobantes,
      cookies,
      limiters,
      turnos,
      clientes,
      fotos,
      gastosFijos,
      caja,
      exportar,
    }),
  );


  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  app.locals.conciliarFotos = () => fotos.conciliar();
  if (deps.tareasProgramadas === true && fotos.disponible) {
    void fotos.conciliar();
    setInterval(() => void fotos.conciliar(), CONCILIACION_CADA_MS).unref();
  }
  return app;
}
