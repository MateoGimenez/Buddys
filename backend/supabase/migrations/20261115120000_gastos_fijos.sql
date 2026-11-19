-- =====================================================================================================
-- Buddys: gastos fijos mensuales (sueldos, alquiler, servicios) (contrato: reportes/2026-11-15_03_contrato-mejoras.md,
-- función 10). Decisión del dueño: no hay comisiones; el equipo cobra sueldo fijo a fin de mes.
--
--  - buddys.gastos_fijos: ítems recurrentes que carga el superadmin. Concepto, monto mensual (1 a 99.999.999),
--    categoría (las mismas de gastos), perfil_id opcional (el empleado de un sueldo; ON DELETE SET NULL) y la
--    vigencia por meses: desde_mes (siempre día 1) y hasta_mes (día 1 o null = sin fin). "Activo" = sin hasta_mes o
--    con hasta_mes en el mes actual o después (lo calcula el backend).
--  - buddys.gastos_fijos_imputados(desde, hasta): cada ítem cuenta su monto ENTERO el día 1 de cada mes de vigencia
--    que cae en [desde, hasta]. Las estadísticas la suman a los gastos sueltos (UNION ALL): no se crean filas en
--    buddys.gastos, así el listado de gastos no cambia y nada se cuenta dos veces. STABLE, SECURITY INVOKER y
--    search_path vacío: buddys_app la ejecuta con sus propios permisos (SELECT sobre gastos_fijos).
--
-- Seguridad, mismo modelo que finanzas_gastos_metas_taller: RLS habilitado, REVOKE a los roles de la API de Supabase,
-- GRANT mínimo a buddys_app con su policy USING/WITH CHECK (true): SELECT, INSERT, DELETE y UPDATE de las columnas
-- editables. updated_at lo mantiene el trigger set_updated_at existente.
--
-- Idempotente (create ... if not exists / or replace, drop policy if exists). Tabla nueva: no reescribe nada. No se
-- aplica a Supabase remoto sin pasar las pruebas.
-- =====================================================================================================

create table if not exists buddys.gastos_fijos (
  id          uuid        primary key default gen_random_uuid(),
  concepto    text        not null
                          constraint gastos_fijos_concepto_largo check (char_length(concepto) between 1 and 120 and btrim(concepto) <> ''),
  monto       integer     not null
                          constraint gastos_fijos_monto_rango check (monto between 1 and 99999999),
  categoria   text        not null
                          constraint gastos_fijos_categoria_valida check (
                            categoria in ('insumos', 'herramientas', 'alquiler', 'servicios', 'sueldos',
                                          'publicidad', 'mantenimiento', 'impuestos', 'otros')),
  perfil_id   uuid
                          constraint gastos_fijos_perfil_fkey references buddys.perfiles (id) on update restrict on delete set null,
  desde_mes   date        not null
                          constraint gastos_fijos_desde_dia_uno check (extract(day from desde_mes) = 1),
  hasta_mes   date
                          constraint gastos_fijos_hasta_dia_uno check (extract(day from hasta_mes) = 1),
  creado_por  uuid
                          constraint gastos_fijos_creado_por_fkey references buddys.perfiles (id) on update restrict on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint gastos_fijos_vigencia check (hasta_mes is null or hasta_mes >= desde_mes)
);

comment on table buddys.gastos_fijos is
  'Gastos fijos mensuales (sueldos, alquiler, servicios). Cada uno cuenta su monto el día 1 de cada mes de vigencia.';
comment on column buddys.gastos_fijos.perfil_id is 'El empleado de un sueldo (perfiles.id). Null si no es un sueldo o se borró.';
comment on column buddys.gastos_fijos.desde_mes is 'Primer mes en que cuenta (día 1).';
comment on column buddys.gastos_fijos.hasta_mes is 'Último mes en que cuenta (día 1). Null = sin fin.';

-- Las FK con ON DELETE SET NULL (recorridas al borrar una persona).
create index if not exists gastos_fijos_perfil_idx on buddys.gastos_fijos (perfil_id) where perfil_id is not null;
create index if not exists gastos_fijos_creado_por_idx on buddys.gastos_fijos (creado_por) where creado_por is not null;

drop trigger if exists gastos_fijos_set_updated_at on buddys.gastos_fijos;
create trigger gastos_fijos_set_updated_at
  before update on buddys.gastos_fijos
  for each row execute function buddys.set_updated_at();

-- -----------------------------------------------------------------------------------------------------
-- Imputación: una fila por ítem y por mes de vigencia cuyo día 1 cae en [desde, hasta].
-- -----------------------------------------------------------------------------------------------------
create or replace function buddys.gastos_fijos_imputados(desde date, hasta date)
returns table (gasto_fijo_id uuid, fecha date, categoria text, concepto text, monto integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.id, m.mes::date, f.categoria, f.concepto, f.monto
  from buddys.gastos_fijos f
  cross join lateral pg_catalog.generate_series(
    greatest(f.desde_mes, pg_catalog.date_trunc('month', desde)::date)::timestamp,
    least(coalesce(f.hasta_mes, hasta), hasta)::timestamp,
    interval '1 month'
  ) as m(mes)
  where m.mes::date between desde and hasta
$$;

comment on function buddys.gastos_fijos_imputados(date, date) is
  'Gastos fijos imputados al día 1 de cada mes de vigencia dentro de [desde, hasta] (una fila por ítem y mes).';

revoke all on function buddys.gastos_fijos_imputados(date, date) from public, anon, authenticated, service_role;
grant execute on function buddys.gastos_fijos_imputados(date, date) to buddys_app;

-- -----------------------------------------------------------------------------------------------------
-- Seguridad
-- -----------------------------------------------------------------------------------------------------
alter table buddys.gastos_fijos enable row level security;
revoke all on buddys.gastos_fijos from public, anon, authenticated, service_role;

grant select, delete on buddys.gastos_fijos to buddys_app;
grant insert (concepto, monto, categoria, perfil_id, desde_mes, hasta_mes, creado_por) on buddys.gastos_fijos to buddys_app;
grant update (concepto, monto, categoria, perfil_id, desde_mes, hasta_mes, updated_at) on buddys.gastos_fijos to buddys_app;

drop policy if exists gastos_fijos_app_select on buddys.gastos_fijos;
drop policy if exists gastos_fijos_app_insert on buddys.gastos_fijos;
drop policy if exists gastos_fijos_app_update on buddys.gastos_fijos;
drop policy if exists gastos_fijos_app_delete on buddys.gastos_fijos;
create policy gastos_fijos_app_select on buddys.gastos_fijos for select to buddys_app using (true);
create policy gastos_fijos_app_insert on buddys.gastos_fijos for insert to buddys_app with check (true);
create policy gastos_fijos_app_update on buddys.gastos_fijos for update to buddys_app using (true) with check (true);
create policy gastos_fijos_app_delete on buddys.gastos_fijos for delete to buddys_app using (true);
