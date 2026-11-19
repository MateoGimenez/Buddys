-- =====================================================================================================
-- Buddys: foto de perfil de cada usuario del panel (contrato: reportes/2026-11-16_04_contrato-perfil.md).
-- Esta migración es SOLO lo del esquema buddys; el bucket de Storage y su policy van aparte, en
-- 20261116110000_storage_bucket_avatares.sql.
--
-- Mismo flujo de 3 pasos que las fotos de los lavados (20261115140000_lavado_fotos.sql):
--   1. pedir la URL firmada de subida: el backend guarda la ruta en avatar_pendiente_path y hasta cuándo vale el
--      token (avatar_subida_vence_at = ahora + 2 horas, lo que fija Supabase);
--   2. el panel sube el archivo con PUT a esa URL;
--   3. confirmar: el backend verifica en Storage que el objeto exista con un tipo y un tamaño válidos y lo pasa a
--      avatar_path (la foto anterior, si había, queda anotada para borrar).
--
--  - buddys.perfiles suma tres columnas, todas null por defecto (no reescribe nada):
--      avatar_path            la foto vigente: '<perfil_id>/<uuid>.(jpg|webp)' en el bucket perfiles-avatares;
--      avatar_pendiente_path  la subida pedida y todavía no confirmada (misma forma);
--      avatar_subida_vence_at hasta cuándo vale el token de la última subida pedida.
--    Un CHECK exige el formato y que la carpeta sea el propio perfil (nadie apunta a la foto de otro).
--  - buddys.avatares_a_borrar: objetos del bucket perfiles-avatares que hay que (volver a) borrar. Es una tabla
--    ANÁLOGA a fotos_a_borrar, no la misma: fotos_a_borrar no dice de qué bucket es cada ruta (su clave es solo el
--    path, con el mismo formato <uuid>/<uuid>.<ext>) y ya está aplicada en Supabase; ampliarla obligaba a cambiar su
--    clave primaria y la conciliación de las fotos. Separadas, cada conciliación borra solo en su bucket.
--  - El trigger perfiles_avatar_a_borrar anota la ruta cada vez que una foto deja de estar en el perfil:
--      * avatar_path cambia (reemplazo o borrado) o se borra el perfil: borrar_desde = avatar_subida_vence_at;
--      * avatar_pendiente_path cambia sin pasar a avatar_path (otra subida pedida, vencida o rechazada) o se borra
--        el perfil: borrar_desde = avatar_subida_vence_at (antes de eso el token todavía sirve para volver a subir).
--    El backend además borra el objeto enseguida; la conciliación (al arrancar y cada hora) lo vuelve a borrar desde
--    borrar_desde, limpia las subidas pendientes vencidas y borra los objetos del bucket que la base no conoce.
--    Es SECURITY DEFINER (en buddys_private, sin EXECUTE para nadie) porque el perfil también se borra en cascada
--    cuando Supabase Auth borra al usuario, y eso corre como supabase_auth_admin (mismo caso que
--    20261022185000_superadmin_trigger_definer.sql).
--
-- Seguridad, mismo modelo que las migraciones anteriores: RLS habilitado, REVOKE a los roles de la API de Supabase,
-- GRANT mínimo a buddys_app con su policy:
--   perfiles:          UPDATE de las tres columnas nuevas (el SELECT ya lo tenía).
--   avatares_a_borrar: SELECT y DELETE (la conciliación). Las altas las hace solo el trigger.
--
-- Idempotente. No se aplica a Supabase remoto sin pasar las pruebas.
-- =====================================================================================================

alter table buddys.perfiles add column if not exists avatar_path text;
alter table buddys.perfiles add column if not exists avatar_pendiente_path text;
alter table buddys.perfiles add column if not exists avatar_subida_vence_at timestamptz;

alter table buddys.perfiles drop constraint if exists perfiles_avatar_path_formato;
alter table buddys.perfiles add constraint perfiles_avatar_path_formato check (
  avatar_path is null
  or (avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webp)$' and split_part(avatar_path, '/', 1) = id::text)
);
alter table buddys.perfiles drop constraint if exists perfiles_avatar_pendiente_formato;
alter table buddys.perfiles add constraint perfiles_avatar_pendiente_formato check (
  avatar_pendiente_path is null
  or (
    avatar_pendiente_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webp)$'
    and split_part(avatar_pendiente_path, '/', 1) = id::text
    and avatar_subida_vence_at is not null
  )
);

comment on column buddys.perfiles.avatar_path is
  'Foto de perfil vigente: <perfil_id>/<uuid>.<jpg|webp> en el bucket privado perfiles-avatares. null = sin foto.';
comment on column buddys.perfiles.avatar_pendiente_path is
  'Subida de foto pedida y todavía no confirmada (misma forma que avatar_path).';
comment on column buddys.perfiles.avatar_subida_vence_at is
  'Hasta cuándo vale el token de la última URL de subida pedida (2 horas, lo fija Supabase).';

-- La conciliación: subidas pendientes vencidas.
create index if not exists perfiles_avatar_pendiente_idx
  on buddys.perfiles (avatar_subida_vence_at) where avatar_pendiente_path is not null;

-- -----------------------------------------------------------------------------------------------------
-- avatares_a_borrar: objetos del bucket perfiles-avatares que hay que (volver a) borrar.
-- -----------------------------------------------------------------------------------------------------
create table if not exists buddys.avatares_a_borrar (
  path         text        primary key
                           constraint avatares_a_borrar_path_formato check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webp)$'),
  borrar_desde timestamptz not null,
  created_at   timestamptz not null default now()
);

comment on table buddys.avatares_a_borrar is
  'Objetos del bucket perfiles-avatares que ya no usa ningún perfil. La conciliación los borra desde borrar_desde.';

create index if not exists avatares_a_borrar_desde_idx on buddys.avatares_a_borrar (borrar_desde);

create or replace function buddys_private.perfiles_avatar_a_borrar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  desde timestamptz := coalesce(old.avatar_subida_vence_at, old.updated_at);
begin
  if old.avatar_path is not null and (tg_op = 'DELETE' or new.avatar_path is distinct from old.avatar_path) then
    insert into buddys.avatares_a_borrar (path, borrar_desde)
    values (old.avatar_path, desde)
    on conflict (path) do update set borrar_desde = greatest(buddys.avatares_a_borrar.borrar_desde, excluded.borrar_desde);
  end if;
  if old.avatar_pendiente_path is not null and (
    tg_op = 'DELETE'
    or (new.avatar_pendiente_path is distinct from old.avatar_pendiente_path
        and new.avatar_path is distinct from old.avatar_pendiente_path)
  ) then
    insert into buddys.avatares_a_borrar (path, borrar_desde)
    values (old.avatar_pendiente_path, desde)
    on conflict (path) do update set borrar_desde = greatest(buddys.avatares_a_borrar.borrar_desde, excluded.borrar_desde);
  end if;
  return null;
end;
$$;

comment on function buddys_private.perfiles_avatar_a_borrar() is
  'Trigger AFTER UPDATE / DELETE de perfiles: anota en avatares_a_borrar la foto de perfil (vigente o pendiente) que '
  'deja de usarse. SECURITY DEFINER: también corre cuando el borrado viene de Supabase Auth (supabase_auth_admin).';
revoke all on function buddys_private.perfiles_avatar_a_borrar() from public, anon, authenticated, service_role;

drop trigger if exists perfiles_avatar_a_borrar on buddys.perfiles;
create trigger perfiles_avatar_a_borrar
  after update of avatar_path, avatar_pendiente_path on buddys.perfiles
  for each row
  when (old.avatar_path is not null or old.avatar_pendiente_path is not null)
  execute function buddys_private.perfiles_avatar_a_borrar();

drop trigger if exists perfiles_avatar_a_borrar_al_borrar on buddys.perfiles;
create trigger perfiles_avatar_a_borrar_al_borrar
  after delete on buddys.perfiles
  for each row
  when (old.avatar_path is not null or old.avatar_pendiente_path is not null)
  execute function buddys_private.perfiles_avatar_a_borrar();

-- -----------------------------------------------------------------------------------------------------
-- Seguridad
-- -----------------------------------------------------------------------------------------------------
grant update (avatar_path, avatar_pendiente_path, avatar_subida_vence_at) on buddys.perfiles to buddys_app;

alter table buddys.avatares_a_borrar enable row level security;
revoke all on buddys.avatares_a_borrar from public, anon, authenticated, service_role;
grant select, delete on buddys.avatares_a_borrar to buddys_app;

drop policy if exists avatares_a_borrar_app_select on buddys.avatares_a_borrar;
drop policy if exists avatares_a_borrar_app_delete on buddys.avatares_a_borrar;
create policy avatares_a_borrar_app_select on buddys.avatares_a_borrar for select to buddys_app using (true);
create policy avatares_a_borrar_app_delete on buddys.avatares_a_borrar for delete to buddys_app using (true);
