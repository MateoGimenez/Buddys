-- =====================================================================================================
-- Buddys: cierre de caja con arqueo (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 11).
--
--  - buddys.cierres_caja: UN cierre por día (fecha es la PK). Lo contado por forma de pago (efectivo obligatorio; las
--    demás null = no se contó), la FOTO de lo esperado al cerrar (lavados de mostrador del día + señas cobradas ese día
--    + saldos de turnos completados ese día, por forma de pago; sin_indicar = lo cobrado sin forma de pago), la
--    diferencia (contado - esperado de las formas contadas; puede ser negativa), una nota y quién cerró
--    (cerrado_por -> perfiles ON DELETE SET NULL). Reabrir = borrar la fila; corregir = actualizarla (solo el
--    superadmin, lo decide el backend).
--  - Importes: pesos enteros de 0 a 999.999.999 (lo de un día entero). Solo los ven admin y superadmin.
--
-- Seguridad, mismo modelo que las migraciones anteriores: RLS habilitado, REVOKE a los roles de la API de Supabase,
-- GRANT mínimo a buddys_app con su policy USING/WITH CHECK (true): SELECT, INSERT, DELETE y UPDATE de las columnas
-- editables (nunca fecha ni created_at). updated_at lo mantiene el trigger set_updated_at existente.
--
-- Idempotente. Tabla nueva: no reescribe nada. No se aplica a Supabase remoto sin pasar las pruebas.
-- =====================================================================================================

create table if not exists buddys.cierres_caja (
  fecha                  date        primary key,
  contado_efectivo       integer     not null constraint cierres_caja_contado_efectivo_rango check (contado_efectivo between 0 and 999999999),
  contado_transferencia  integer     constraint cierres_caja_contado_transferencia_rango check (contado_transferencia between 0 and 999999999),
  contado_debito         integer     constraint cierres_caja_contado_debito_rango check (contado_debito between 0 and 999999999),
  contado_credito        integer     constraint cierres_caja_contado_credito_rango check (contado_credito between 0 and 999999999),
  contado_otro           integer     constraint cierres_caja_contado_otro_rango check (contado_otro between 0 and 999999999),
  esperado_efectivo      integer     not null constraint cierres_caja_esperado_efectivo_rango check (esperado_efectivo between 0 and 999999999),
  esperado_transferencia integer     not null constraint cierres_caja_esperado_transferencia_rango check (esperado_transferencia between 0 and 999999999),
  esperado_debito        integer     not null constraint cierres_caja_esperado_debito_rango check (esperado_debito between 0 and 999999999),
  esperado_credito       integer     not null constraint cierres_caja_esperado_credito_rango check (esperado_credito between 0 and 999999999),
  esperado_otro          integer     not null constraint cierres_caja_esperado_otro_rango check (esperado_otro between 0 and 999999999),
  sin_indicar            integer     not null constraint cierres_caja_sin_indicar_rango check (sin_indicar between 0 and 999999999),
  diferencia             integer     not null constraint cierres_caja_diferencia_rango check (diferencia between -999999999 and 999999999),
  nota                   text        constraint cierres_caja_nota_largo check (char_length(nota) between 1 and 300),
  cerrado_por            uuid        constraint cierres_caja_cerrado_por_fkey references buddys.perfiles (id) on update restrict on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table buddys.cierres_caja is
  'Cierre de caja de cada día: lo contado por forma de pago, la foto de lo esperado al cerrar y la diferencia.';
comment on column buddys.cierres_caja.sin_indicar is 'Lo cobrado ese día sin forma de pago (no se puede arquear).';
comment on column buddys.cierres_caja.diferencia is 'Contado - esperado de las formas contadas. Negativa = falta plata.';

create index if not exists cierres_caja_cerrado_por_idx on buddys.cierres_caja (cerrado_por) where cerrado_por is not null;

drop trigger if exists cierres_caja_set_updated_at on buddys.cierres_caja;
create trigger cierres_caja_set_updated_at
  before update on buddys.cierres_caja
  for each row execute function buddys.set_updated_at();

alter table buddys.cierres_caja enable row level security;
revoke all on buddys.cierres_caja from public, anon, authenticated, service_role;

grant select, delete on buddys.cierres_caja to buddys_app;
grant insert (fecha, contado_efectivo, contado_transferencia, contado_debito, contado_credito, contado_otro,
              esperado_efectivo, esperado_transferencia, esperado_debito, esperado_credito, esperado_otro,
              sin_indicar, diferencia, nota, cerrado_por)
  on buddys.cierres_caja to buddys_app;
grant update (contado_efectivo, contado_transferencia, contado_debito, contado_credito, contado_otro,
              esperado_efectivo, esperado_transferencia, esperado_debito, esperado_credito, esperado_otro,
              sin_indicar, diferencia, nota, cerrado_por, updated_at)
  on buddys.cierres_caja to buddys_app;

drop policy if exists cierres_caja_app_select on buddys.cierres_caja;
drop policy if exists cierres_caja_app_insert on buddys.cierres_caja;
drop policy if exists cierres_caja_app_update on buddys.cierres_caja;
drop policy if exists cierres_caja_app_delete on buddys.cierres_caja;
create policy cierres_caja_app_select on buddys.cierres_caja for select to buddys_app using (true);
create policy cierres_caja_app_insert on buddys.cierres_caja for insert to buddys_app with check (true);
create policy cierres_caja_app_update on buddys.cierres_caja for update to buddys_app using (true) with check (true);
create policy cierres_caja_app_delete on buddys.cierres_caja for delete to buddys_app using (true);
