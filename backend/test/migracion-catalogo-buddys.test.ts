import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPostgresRepositories } from '../src/repositories/index.js';
import type { Servicio } from '../src/domain/servicios.js';
import { servicioIdsSchema, updateServicioSchema } from '../src/schemas/servicios.js';
import { closeAllContexts, createTestContext, loginAs } from './helpers.js';
import { MIGRACIONES_SOLO_DATOS, MIGRATIONS_DIR, migrationFiles } from './pglite.js';

afterEach(closeAllContexts);

/*
 * Migración de datos 20261113130000_catalogo_buddys: el catálogo real de Buddys. La base de los tests no la aplica
 * (MIGRACIONES_SOLO_DATOS, test/pglite.ts); acá se aplica sobre una base con todas las demás, dos veces.
 */

const CATALOGO = '20261113130000_catalogo_buddys.sql';
const leer = () => readFileSync(path.join(MIGRATIONS_DIR, CATALOGO), 'utf8');

const ESPERADO: [id: string, nombre: string, categoria: string, precios: (number | null)[], vehiculos: string[]][] = [
  ['limpieza-nivel-1', 'Limpieza Nivel I', 'Lavado', [25000, 30000, 35000, null], ['auto', 'suv', 'pickup']],
  ['limpieza-nivel-2', 'Limpieza Nivel II', 'Lavado', [30000, 35000, 40000, null], ['auto', 'suv', 'pickup']],
  ['limpieza-nivel-3', 'Limpieza Nivel III', 'Lavado', [60000, 70000, 80000, null], ['auto', 'suv', 'pickup']],
  ['limpieza-motor', 'Limpieza de motor', 'Lavado', [25000, 25000, 25000, null], ['auto', 'suv', 'pickup']],
  ['higienizacion-profunda', 'Higienización profunda', 'Interior', [120000, 120000, 120000, null], ['auto', 'suv', 'pickup']],
  ['pulido-basico', 'Pulido básico', 'Pulido', [250000, 270000, 320000, null], ['auto', 'suv', 'pickup']],
  ['pulido-abrillantado', 'Pulido y abrillantado', 'Pulido', [300000, 320000, 370000, null], ['auto', 'suv', 'pickup']],
  ['pulido-opticas', 'Pulido de ópticas', 'Pulido', [80000, 80000, 80000, null], ['auto', 'suv', 'pickup']],
  ['restauracion-opticas', 'Restauración de ópticas', 'Pulido', [180000, 180000, 180000, null], ['auto', 'suv', 'pickup']],
  ['tratamiento-acrilico', 'Tratamiento acrílico', 'Protección', [400000, 450000, 480000, null], ['auto', 'suv', 'pickup']],
  ['tratamiento-ceramico', 'Tratamiento cerámico', 'Protección', [600000, 600000, 600000, null], ['auto', 'suv', 'pickup']],
  ['preparacion-venta', 'Preparación para la venta', 'Pre venta', [400000, 400000, 400000, null], ['auto', 'suv', 'pickup']],
  ['motos-basico', 'Motos básico', 'Motos', [null, null, null, 60000], ['moto']],
  ['motos-ceramico', 'Motos tratamiento cerámico', 'Motos', [null, null, null, 150000], ['moto']],
];

describe('migración catalogo_buddys', () => {
  it('es la última migración de datos y la base de los tests no la aplica', () => {
    expect(migrationFiles()).toContain(CATALOGO);
    expect(MIGRACIONES_SOLO_DATOS).toEqual([CATALOGO]);
  });

  it('carga los 14 servicios en orden, desactiva los heredados y es idempotente', async () => {
    const context = await createTestContext();
    // eslint-disable-next-line no-restricted-syntax -- migración versionada
    await context.db.pg.exec(leer());
    // eslint-disable-next-line no-restricted-syntax -- migración versionada
    await context.db.pg.exec(leer());

    const { servicios } = createPostgresRepositories(context.db.appSql);
    const activos = await servicios.list({ soloActivos: true });
    expect(activos.map((s) => [s.id, s.nombre, s.categoria, [s.precioDesde, s.precioDesdeSuv, s.precioDesdePickup, s.precioDesdeMoto], s.vehiculos])).toEqual(ESPERADO);
    expect(activos.map((s) => s.orden)).toEqual(ESPERADO.map((_, i) => (i + 1) * 10));
    expect(activos.filter((s) => s.destacado).map((s) => s.id)).toEqual(['limpieza-nivel-1', 'limpieza-nivel-2', 'limpieza-nivel-3']);

    const todos = await servicios.list();
    const inactivos = todos.filter((s) => !s.activo).map((s) => s.id).sort();
    expect(inactivos).toEqual(['encerado', 'lavado-basico', 'lavado-premium', 'pulido']);
    expect(todos.filter((s) => !s.activo).every((s) => !s.destacado)).toBe(true);

    // Cada servicio pasa las mismas validaciones que el PATCH del panel (largos, ítems, slug).
    for (const s of activos) {
      const datos: Partial<Servicio> = { ...s };
      const { nombre, resumen, descripcion, incluye, glosario, categoria, vehiculos } = datos;
      const parsed = updateServicioSchema.safeParse({ nombre, resumen, descripcion, incluye, glosario, categoria, vehiculos });
      expect(parsed.success, `${s.id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      expect(s.incluye.length).toBeGreaterThan(0);
      expect(s.descripcion).toMatch(/\.$/);
      expect([s.duracion, s.duracionSuv, s.duracionPickup, s.duracionMoto]).toEqual([null, null, null, null]);
    }
    expect(servicioIdsSchema.safeParse(activos.map((s) => s.id).slice(0, 10)).success).toBe(true);
    expect(activos.find((s) => s.id === 'restauracion-opticas')?.incluye).toEqual([
      'Limpieza Nivel I',
      'Desarme completo',
      'Reparación de piezas internas',
      'Customización',
      'Lijado y pulido',
      'Polímero protector',
      '1 año de garantía',
    ]);
  });

  it('con el catálogo cargado se registra un lavado de varios servicios con sus precios de pick-up', async () => {
    const context = await createTestContext();
    // eslint-disable-next-line no-restricted-syntax -- migración versionada
    await context.db.pg.exec(leer());
    const { client } = await loginAs(context, 'admin');
    const response = await client.post('/api/admin/lavados', {
      servicioIds: ['limpieza-nivel-2', 'limpieza-motor'],
      vehiculoTipo: 'pickup',
      monto: 65000,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.lavado.servicios).toEqual([
      { id: 'limpieza-nivel-2', nombre: 'Limpieza Nivel II', precioLista: 40000 },
      { id: 'limpieza-motor', nombre: 'Limpieza de motor', precioLista: 25000 },
    ]);
    // Un servicio de motos no se ofrece para auto.
    const moto = await client.post('/api/admin/lavados', { servicioIds: ['motos-basico'], vehiculoTipo: 'auto' });
    expect(moto.status).toBe(400);
    expect(Object.keys(moto.body.error.fields as object)).toEqual(['servicioIds']);
  });
});
