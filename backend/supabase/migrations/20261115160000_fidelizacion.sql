-- =====================================================================================================
-- Buddys: clientes frecuentes (tarjeta de sellos) e inactivos (contrato: reportes/2026-11-15_03_contrato-mejoras.md,
-- función 14).
--
--  - buddys.fidelizacion: UNA sola fila (id = 1), como buddys.taller. La configura el superadmin:
--      sellos_cada (2 a 50, default 10): cada cuántas visitas completadas la siguiente es el premio;
--      premio 'gratis' | 'descuento' (default 'gratis') y premio_porcentaje (1 a 99, solo con 'descuento');
--      inactivos_dias (7 a 365, default 30): desde cuántos días sin venir un cliente cuenta como inactivo.
--    El progreso de cada cliente se calcula con sus turnos completados (por teléfono, o patente si no tiene): no hay
--    tabla de sellos.
--
-- Seguridad: RLS habilitado, REVOKE a los roles de la API de Supabase; buddys_app solo SELECT y UPDATE de las columnas
-- editables (la fila no se crea ni se borra desde la app). Idempotente (la fila se siembra con ON CONFLICT DO
-- NOTHING). No se aplica a Supabase remoto sin pasar las pruebas.
-- =====================================================================================================

create table if not exists buddys.fidelizacion (
  id                smallint    primary key default 1 constraint fidelizacion_una_fila check (id = 1),
  sellos_cada       smallint    not null default 10 constraint fidelizacion_sellos_rango check (sellos_cada between 2 and 50),
  premio            text        not null default 'gratis' constraint fidelizacion_premio_valido check (premio in ('gratis', 'descuento')),
  premio_porcentaje smallint    constraint fidelizacion_porcentaje_rango check (premio_porcentaje between 1 and 99),
  inactivos_dias    smallint    not null default 30 constraint fidelizacion_inactivos_rango check (inactivos_dias between 7 and 365),
  updated_at        timestamptz not null default now(),
  constraint fidelizacion_porcentaje_con_descuento check (
    (premio = 'descuento' and premio_porcentaje is not null) or (premio = 'gratis' and premio_porcentaje is null))
);

comment on table buddys.fidelizacion is
  'Tarjeta de sellos y clientes inactivos (una sola fila). Cada sellos_cada visitas, la siguiente es el premio.';

insert into buddys.fidelizacion (id) values (1) on conflict (id) do nothing;

drop trigger if exists fidelizacion_set_updated_at on buddys.fidelizacion;
create trigger fidelizacion_set_updated_at
  before update on buddys.fidelizacion
  for each row execute function buddys.set_updated_at();

alter table buddys.fidelizacion enable row level security;
revoke all on buddys.fidelizacion from public, anon, authenticated, service_role;
grant select on buddys.fidelizacion to buddys_app;
grant update (sellos_cada, premio, premio_porcentaje, inactivos_dias, updated_at) on buddys.fidelizacion to buddys_app;

drop policy if exists fidelizacion_app_select on buddys.fidelizacion;
drop policy if exists fidelizacion_app_update on buddys.fidelizacion;
create policy fidelizacion_app_select on buddys.fidelizacion for select to buddys_app using (true);
create policy fidelizacion_app_update on buddys.fidelizacion for update to buddys_app using (true) with check (true);
