import { type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';
import { MAX_DIAS_ESTADISTICAS } from '../domain/estadisticas.js';
import { puedeExportar } from '../domain/permisos.js';
import { armarCsv, type Celda } from '../lib/csv.js';
import { daysBetween, isValidCalendarDate } from '../lib/dates.js';
import { requirePermiso } from '../middleware/require-session.js';
import type { ExportRepository } from '../domain/exportar.js';
import { blankToUndefined } from '../schemas/admin.js';
import { parseOrThrow } from '../schemas/common.js';
import type { EstadisticasService } from '../services/estadisticas.js';

const SIN_PERMISO_MESSAGE = 'Con tu rol no podés exportar: los archivos llevan importes.';

function fecha(campo: 'desde' | 'hasta') {
  const message = `Indicá "${campo}" como una fecha válida con formato AAAA-MM-DD.`;
  return z.preprocess(blankToUndefined, z.string({ error: message }).refine(isValidCalendarDate, { error: message }));
}

/** ?desde=&hasta= obligatorios, hasta 366 días. */
export const rangoExportarSchema = z
  .object({ desde: fecha('desde'), hasta: fecha('hasta') })
  .superRefine(({ desde, hasta }, ctx) => {
    if (!isValidCalendarDate(desde) || !isValidCalendarDate(hasta)) return;
    const dias = daysBetween(desde, hasta);
    if (dias < 0) ctx.addIssue({ code: 'custom', path: ['hasta'], message: '"hasta" no puede ser anterior a "desde".' });
    else if (dias + 1 > MAX_DIAS_ESTADISTICAS) {
      ctx.addIssue({ code: 'custom', path: ['hasta'], message: `Se exportan hasta ${String(MAX_DIAS_ESTADISTICAS)} días por vez.` });
    }
  });

function enviarCsv(res: Response, nombre: string, renglones: readonly (readonly Celda[])[]): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  // El nombre lo arma el servidor (solo letras, números, guiones y puntos): no hay nada del usuario.
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(armarCsv(renglones));
}

/**
 * Exportar a CSV para Excel en es-AR (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 16). Detrás de
 * requireSession. Llevan importes: solo admin y superadmin (finanzas.exportar); el empleado, 403 antes de validar.
 *  - GET /api/admin/exportar/planilla.csv?desde=&hasta=
 *  - GET /api/admin/exportar/gastos.csv?desde=&hasta=
 *  - GET /api/admin/exportar/estadisticas.csv?desde=&hasta=
 */
export function adminExportarRouter(deps: {
  exportar: ExportRepository;
  estadisticas: EstadisticasService;
  limiter: RequestHandler;
}): Router {
  const { exportar, estadisticas, limiter } = deps;
  const router = Router();
  router.use(requirePermiso(puedeExportar, SIN_PERMISO_MESSAGE));
  router.use(limiter);

  router.get('/planilla.csv', async (req, res) => {
    const { desde, hasta } = parseOrThrow(rangoExportarSchema, req.query);
    const renglones = await exportar.planilla(desde, hasta);
    enviarCsv(res, `planilla_${desde}_${hasta}.csv`, [
      ['Fecha', 'Franja', 'Origen', 'Estado', 'Etapa', 'Cliente', 'Teléfono', 'Vehículo', 'Modelo / patente', 'Servicios',
        'Trabajador', 'Forma de pago', 'Monto', 'Descuento', 'Motivo del descuento', 'Seña', 'Saldo'],
      ...renglones.map((r) => [
        r.fecha, r.franja, r.origen, r.estado, r.etapa, r.nombre, r.telefono, r.vehiculoTipo, r.vehiculoModelo, r.servicios,
        r.trabajador, r.formaPago, r.monto, r.descuento, r.descuentoMotivo, r.sena,
        r.monto === null ? null : r.monto - (r.sena ?? 0),
      ]),
    ]);
  });

  router.get('/gastos.csv', async (req, res) => {
    const { desde, hasta } = parseOrThrow(rangoExportarSchema, req.query);
    const renglones = await exportar.gastos(desde, hasta);
    enviarCsv(res, `gastos_${desde}_${hasta}.csv`, [
      ['Fecha', 'Origen', 'Categoría', 'Descripción', 'Proveedor', 'Monto'],
      ...renglones.map((r) => [r.fecha, r.origen, r.categoria, r.descripcion, r.proveedor, r.monto]),
    ]);
  });

  router.get('/estadisticas.csv', async (req, res) => {
    const { desde, hasta } = parseOrThrow(rangoExportarSchema, req.query);
    const e = await estadisticas.completas({ desde, hasta });
    const p = e.periodo;
    enviarCsv(res, `estadisticas_${desde}_${hasta}.csv`, [
      ['Período', `${desde} a ${hasta}`],
      [],
      ['Métrica', 'Valor'],
      ['Turnos', p.turnos],
      ['Completados', p.completados],
      ['Cancelados', p.cancelados],
      ['Ingresos', p.ingresos],
      ['Gastos', p.gastos],
      ['Gastos fijos', p.gastosFijos],
      ['Descuentos', p.descuentos],
      ['Ganancia neta', p.gananciaNeta],
      ['Margen', p.margen],
      ['Ticket promedio', p.ticketPromedio],
      ['Completados sin monto', p.completadosSinMonto],
      ['Tasa de cancelación', p.tasaCancelacion],
      [],
      ['Fecha', 'Completados', 'Ingresos', 'Gastos'],
      ...e.serie.map((s) => [s.clave, s.completados, s.ingresos, s.gastos]),
      [],
      ['Servicio', 'Pedidos', 'Completados', 'Ingresos'],
      ...e.porServicio.map((s) => [s.nombre, s.pedidos, s.completados, s.ingresos]),
      [],
      ['Categoría de gasto', 'Monto'],
      ...e.gastosPorCategoria.map((g) => [g.categoria, g.monto]),
    ]);
  });

  return router;
}
