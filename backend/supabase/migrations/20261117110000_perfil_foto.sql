-- =====================================================================================================
-- Buddys: foto de perfil
-- (contrato: reportes/2026-11-17_04_perfil-y-foto.md, sección "Base de datos").
--
--  - perfiles.foto_actualizada_at timestamptz null: cuándo se subió la foto actual. Null = sin foto. Sirve de versión
--    de la foto (ETag y ?v= en la URL). La ruta en Storage es fija (avatares/<perfil_id>.webp), así que no se guarda.
--    ADD COLUMN nullable y sin default: no reescribe perfiles (solo toma ACCESS EXCLUSIVE un instante para cambiar
--    el catálogo). Ninguna fila existente cambia: todas quedan en null (sin foto).
--  - Bucket privado `avatares` en storage.buckets (public = false, 256 KiB, solo image/webp). Va dentro de un bloque DO
--    que solo corre si existen el esquema storage y la tabla storage.buckets: PGlite (los tests) no tiene Storage.
--    ON CONFLICT (id) DO NOTHING: si el bucket ya existe (creado a mano o por una corrida anterior), no se toca su
--    configuración.
--  - SIN policies en storage.objects, a propósito: el bucket lo usa solo el backend, con la secret key (rol
--    service_role de Storage, que salta RLS). Sin policies, RLS de storage.objects deniega todo a anon y
--    authenticated: nadie puede leer, listar ni subir fotos con la publishable key. La foto se entrega siempre a
--    través de la API del backend, que controla la sesión.
--
-- Seguridad, mismo modelo que las migraciones anteriores: RLS de perfiles habilitado y sus policies (select y update
-- para buddys_app) sin cambios. Se suma GRANT UPDATE (foto_actualizada_at) a buddys_app; los GRANT por columna
-- existentes se mantienen. Sigue sin INSERT ni DELETE sobre perfiles para la app. Se repite el REVOKE a los roles de
-- la API de Supabase (defensa en profundidad). Ningún trigger cambia.
--
-- Idempotente (se puede correr dos veces). No se aplica a Supabase remoto sin pasar las pruebas.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- perfiles.foto_actualizada_at
-- -----------------------------------------------------------------------------------------------------
alter table buddys.perfiles add column if not exists foto_actualizada_at timestamptz;

comment on column buddys.perfiles.foto_actualizada_at is
  'Cuándo se subió la foto actual (versión: ETag y ?v=). Null = sin foto. La foto está en Storage: avatares/<id>.webp.';

alter table buddys.perfiles enable row level security;
revoke all on buddys.perfiles from public, anon, authenticated, service_role;
grant update (foto_actualizada_at) on buddys.perfiles to buddys_app;

-- -----------------------------------------------------------------------------------------------------
-- Bucket privado `avatares` (solo en Supabase: PGlite no tiene el esquema storage)
-- -----------------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatares', 'avatares', false, 262144, array['image/webp'])
    on conflict (id) do nothing;
  end if;
end;
$$;
