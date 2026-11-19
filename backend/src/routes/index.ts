import express, { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { BookingRepository } from '../domain/booking.js';
import type { SessionCookies } from '../lib/cookies.js';
import type { Logger } from '../lib/logger.js';
import { notFoundHandler } from '../middleware/error-handler.js';
import type { RateLimiters } from '../middleware/rate-limit.js';
import { requestGuard } from '../middleware/request-guard.js';
import { requireSession } from '../middleware/require-session.js';
import { corsPolicy, noStore } from '../middleware/security.js';
import type { AgendaService } from '../services/agenda.js';
import type { AuthService } from '../services/auth.js';
import type { BookingService } from '../services/bookings.js';
import type { DisponibilidadService } from '../services/disponibilidad.js';
import type { EstadisticasService } from '../services/estadisticas.js';
import type { ComprobanteService } from '../services/comprobantes.js';
import type { GastoService } from '../services/gastos.js';
import type { InventarioService } from '../services/inventario.js';
import type { LavadoService } from '../services/lavados.js';
import type { PresupuestoService } from '../services/presupuestos.js';
import type { MetaService } from '../services/metas.js';
import type { TallerService } from '../services/taller.js';
import type { PerfilRepository } from '../domain/perfil.js';
import type { PushService } from '../services/push.js';
import type { RecordatorioService } from '../services/recordatorios.js';
import type { ServicioService } from '../services/servicios.js';
import type { UsuarioService } from '../services/usuarios.js';
import type { CajaService } from '../services/caja.js';
import type { ClienteService } from '../services/clientes.js';
import type { FotoService } from '../services/fotos.js';
import type { PerfilService } from '../services/perfil.js';
import { adminPerfilRouter } from './admin-perfil.js';
import type { GastoFijoService } from '../services/gastos-fijos.js';
import type { TurnoPanelService } from '../services/turnos.js';
import type { ExportRepository } from '../domain/exportar.js';
import type { RecetaRepository } from '../domain/recetas.js';
import type { ServicioRepository } from '../domain/servicios.js';
import { adminCajaRouter } from './admin-caja.js';
import { adminClientesRouter, adminFidelizacionRouter } from './admin-clientes.js';
import { adminExportarRouter } from './admin-exportar.js';
import { adminFotosRouter } from './admin-fotos.js';
import { adminGastosFijosRouter } from './admin-gastos-fijos.js';
import { adminRecetasRouter } from './admin-recetas.js';
import { adminTurnosRouter } from './admin-turnos.js';
import { adminErroresClienteRouter, publicErroresClienteRouter } from './errores-cliente.js';
import { adminAgendaRouter } from './admin-agenda.js';
import { adminBookingsRouter } from './admin-bookings.js';
import { adminDisponibilidadRouter } from './admin-disponibilidad.js';
import { adminPushRouter } from './admin-push.js';
import { adminPermisosRouter } from './admin-permisos.js';
import { adminServiciosRouter } from './admin-servicios.js';
import { adminTrabajadoresRouter } from './admin-trabajadores.js';
import { adminEstadisticasRouter } from './admin-estadisticas.js';
import { adminComprobantesRouter } from './admin-comprobantes.js';
import { adminInsumosRouter } from './admin-insumos.js';
import { adminLavadosRouter } from './admin-lavados.js';
import { adminPresupuestosRouter } from './admin-presupuestos.js';
import { adminGastosRouter } from './admin-gastos.js';
import { adminMetasRouter } from './admin-metas.js';
import { adminTallerRouter } from './admin-taller.js';
import { adminUsuariosRouter } from './admin-usuarios.js';
import { authRouter } from './auth.js';
import { publicBookingsRouter } from './bookings.js';
import { publicDisponibilidadRouter } from './disponibilidad.js';
import { healthRouter } from './health.js';
import { internalRouter } from './internal.js';
import { publicServiciosRouter } from './servicios.js';
import { publicTurnosRouter } from './turnos.js';

export interface ApiDeps {
  config: AppConfig;
  logger: Logger;
  now: () => Date;
  /** Resuelve si la base responde; se rechaza si no (ver db/postgres.ts). */
  checkDatabase: () => Promise<void>;
  bookings: BookingRepository;
  perfiles: PerfilRepository;
  estadisticas: EstadisticasService;
  bookingService: BookingService;
  agenda: AgendaService;
  lavados: LavadoService;
  disponibilidad: DisponibilidadService;
  recordatorios: RecordatorioService;
  push: PushService;
  auth: AuthService;
  usuarios: UsuarioService;
  servicios: ServicioService;
  gastos: GastoService;
  metas: MetaService;
  taller: TallerService;
  inventario: InventarioService;
  presupuestos: PresupuestoService;
  comprobantes: ComprobanteService;
  cookies: SessionCookies;
  limiters: RateLimiters;
  turnos: TurnoPanelService;
  clientes: ClienteService;
  fotos: FotoService;
  perfil: PerfilService;
  gastosFijos: GastoFijoService;
  caja: CajaService;
  recetas: RecetaRepository;
  exportar: ExportRepository;
  serviciosRepo: ServicioRepository;
}

/** Router de /api. El ORDEN de los middlewares importa: cada uno protege a los que vienen después. */
export function createApiRouter(deps: ApiDeps): Router {
  const {
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
    disponibilidad,
    recordatorios,
    push,
    auth,
    usuarios,
    servicios,
    gastos,
    metas,
    taller,
    inventario,
    presupuestos,
    comprobantes,
    cookies,
    limiters,
    turnos,
    clientes,
    fotos,
    perfil,
    gastosFijos,
    caja,
    recetas,
    exportar,
    serviciosRepo,
  } = deps;
  const api = Router();

  api.use(corsPolicy(config.frontendOrigins)); // también responde los preflight (OPTIONS)
  api.use(noStore);
  api.use(limiters.api); // tope general por IP, antes de parsear nada
  api.use(requestGuard(config.frontendOrigins)); // CSRF: Origin + Content-Type, antes de leer el body
  // 10 kb alcanzan de sobra; un presupuesto de 30 ítems con tildes y emojis necesita más (24 kb, solo ahí).
  // inflate:false rechaza bodies comprimidos (evita "zip bombs"). Cada body se lee una sola vez.
  const jsonCorto = express.json({ limit: '10kb', inflate: false, strict: true });
  const jsonPresupuestos = express.json({ limit: '24kb', inflate: false, strict: true });
  api.use((req, res, next) => {
    (req.path === '/admin/presupuestos' || req.path.startsWith('/admin/presupuestos/') ? jsonPresupuestos : jsonCorto)(
      req,
      res,
      next,
    );
  });

  const withSession = requireSession(auth, cookies);

  api.use('/health', healthRouter(checkDatabase));
  // Rutas públicas (las usaba la landing). Buddys es un sistema interno: solo se montan con TURNOS_ONLINE=true.
  if (config.turnosOnline) {
    api.use('/servicios', publicServiciosRouter({ servicios }));
    api.use('/disponibilidad', publicDisponibilidadRouter({ disponibilidad, now }));
    api.use('/bookings', publicBookingsRouter({ bookings: bookingService, logger, now, limiter: limiters.bookings }));
    api.use('/turnos', publicTurnosRouter({ bookings, limiter: limiters.seguimiento }));
  }
  api.use('/internal', internalRouter({ cronSecret: config.recordatorios.cronSecret, recordatorios }));
  // Errores del panel sin sesión (pantalla de login): rate limit estricto por IP.
  api.use('/errores-cliente', publicErroresClienteRouter({ logger, limiter: limiters.erroresClientePublico }));
  api.use('/auth', authRouter({ auth, perfil, cookies, loginLimiter: limiters.loginFailures, requireSession: withSession }));
  // Todo lo que cuelga de /admin exige sesión, existan o no las rutas (así no se revela cuáles existen).
  api.use('/admin', withSession);
  api.use('/admin/perfil', adminPerfilRouter({ perfil, avatarLimiter: limiters.avatar, claveLimiter: limiters.clave }));
  api.use('/admin/lavados/:id/fotos', adminFotosRouter({ fotos, limiter: limiters.fotos }));
  api.use('/admin/lavados', adminLavadosRouter({ lavados, now }));
  api.use('/admin/bookings', adminBookingsRouter({ bookings, agenda, fotos }));
  api.use('/admin/turnos', adminTurnosRouter({ turnos, now }));
  api.use('/admin/clientes', adminClientesRouter({ clientes }));
  api.use('/admin/fidelizacion', adminFidelizacionRouter({ clientes }));
  api.use('/admin/gastos-fijos', adminGastosFijosRouter({ gastosFijos }));
  api.use('/admin/caja', adminCajaRouter({ caja }));
  api.use('/admin/exportar', adminExportarRouter({ exportar, estadisticas, limiter: limiters.pdf }));
  api.use('/admin/errores-cliente', adminErroresClienteRouter({ logger, limiter: limiters.erroresCliente }));
  api.use('/admin/servicios', adminRecetasRouter({ recetas, servicios: serviciosRepo, logger }));
  api.use('/admin/agenda', adminAgendaRouter({ agenda, disponibilidad }));
  api.use('/admin/disponibilidad', adminDisponibilidadRouter({ disponibilidad }));
  api.use('/admin/usuarios', adminUsuariosRouter({ usuarios, perfil }));
  api.use('/admin/servicios', adminServiciosRouter({ servicios }));
  api.use('/admin/trabajadores', adminTrabajadoresRouter({ perfiles, perfil }));
  api.use('/admin/estadisticas', adminEstadisticasRouter({ estadisticas }));
  api.use('/admin/gastos', adminGastosRouter({ gastos }));
  api.use('/admin/metas', adminMetasRouter({ metas }));
  api.use('/admin/taller', adminTallerRouter({ taller }));
  api.use('/admin/insumos', adminInsumosRouter({ inventario }));
  api.use('/admin/presupuestos', adminPresupuestosRouter({ presupuestos, taller, pdfLimiter: limiters.pdf }));
  api.use('/admin', adminComprobantesRouter({ comprobantes, taller, pdfLimiter: limiters.pdf }));
  api.use('/admin/permisos', adminPermisosRouter({ perfiles }));
  api.use('/admin/push', adminPushRouter({ push }));

  api.use(notFoundHandler); // 404 JSON para rutas /api desconocidas
  return api;
}
