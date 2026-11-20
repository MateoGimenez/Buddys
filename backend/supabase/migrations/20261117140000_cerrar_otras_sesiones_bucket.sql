-- =====================================================================================================
-- Cerrar las OTRAS sesiones al cambiar la propia contraseña, y el bucket `avatares` privado aunque ya exista
-- (auditoría de seguridad del objetivo B, contrato reportes/2026-11-17_04_perfil-y-foto.md, hallazgos M1 y B2).
--
-- M1. Problema: cuando alguien cambia SU contraseña desde "Mi perfil" (PATCH /api/admin/perfil), las demás sesiones
--     que tenía abiertas (otra compu, el celular, una sesión robada) seguían vivas hasta el tope de 12 h. Cambiar la
--     contraseña porque sospechás que alguien entró tiene que sacar a ese alguien.
--     Arreglo: buddys_private.cerrar_otras_sesiones(p_usuario, p_sesion_actual) borra las filas de auth.sessions de
--     ese usuario MENOS la sesión desde la que se hizo el cambio (en Supabase, los refresh tokens se van en cascada con
--     su sesión) y devuelve cuántas borró. El backend ya comprueba en cada request que la sesión siga en auth.sessions
--     (buddys_private.sesion_vigente), así que el corte vale desde el request siguiente. La llama el backend después
--     de cambiar la contraseña, con el session_id del JWT de quien la cambió: esa sesión sigue andando.
--     Mismo modelo que buddys_private.cerrar_sesiones (20261117130000): SECURITY DEFINER (corre como su dueño,
--     postgres; buddys_app no tiene ni debe tener acceso al esquema auth) con search_path vacío y todo calificado, en
--     el esquema NO expuesto buddys_private, EXECUTE solo para buddys_app. Recibe dos uuid y devuelve un entero: no
--     devuelve datos de las sesiones. No usa auth.uid(): la llama el backend con su propio rol y el usuario sale de la
--     sesión validada (nadie puede cerrarle las sesiones a otro por esta vía).
--
-- B2. Problema: 20261117110000_perfil_foto crea el bucket con ON CONFLICT DO NOTHING: si `avatares` ya existía
--     (creado a mano desde el dashboard, por ejemplo público), quedaba como estaba y las fotos se podían bajar sin
--     sesión por la URL pública de Storage.
--     Arreglo: si existe storage.buckets (en Supabase; PGlite, los tests, no tiene Storage), se fuerza
--     public = false, tope de 256 KiB y solo image/webp en el bucket `avatares`. Si el bucket no existe, no hace nada
--     (lo crea la migración anterior). No toca ningún objeto ni otro bucket.
--
--     ATENCIÓN antes de aplicar: un bucket privado solo es privado si RLS de storage.objects no deja pasar. Revisá en
--     Supabase que storage.objects NO tenga policies genéricas para `authenticated` (o `anon`/`public`) sin filtro por
--     bucket_id (por ejemplo "using (true)" o "auth.role() = 'authenticated'"): con una así, cualquiera con la
--     publishable key y una sesión podría leer o listar las fotos aunque el bucket sea privado. Esta migración no crea
--     ni borra policies de Storage (el bucket lo usa solo el backend con la secret key, que salta RLS):
--       select policyname, roles, cmd, qual from pg_policies where schemaname = 'storage' and tablename = 'objects';
--
-- Seguridad: no se crean tablas (no hay RLS nueva que habilitar); REVOKE a public, anon, authenticated y service_role
-- y GRANT EXECUTE mínimo a buddys_app sobre la función nueva. Ningún permiso existente cambia.
-- Idempotente (create or replace, update): se puede volver a aplicar. No se aplica a Supabase remoto sin pasar las
-- pruebas.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- M1: buddys_private.cerrar_otras_sesiones
-- -----------------------------------------------------------------------------------------------------
create or replace function buddys_private.cerrar_otras_sesiones(p_usuario uuid, p_sesion_actual uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cerradas integer;
begin
  delete from auth.sessions as s where s.user_id = p_usuario and s.id <> p_sesion_actual;
  get diagnostics v_cerradas = row_count;
  return v_cerradas;
end;
$$;

comment on function buddys_private.cerrar_otras_sesiones(uuid, uuid) is
  'Borra las sesiones de Supabase Auth (auth.sessions) de ese usuario salvo p_sesion_actual y devuelve cuántas borró. '
  'La llama el backend cuando alguien cambia su propia contraseña. Solo para buddys_app.';

revoke all on function buddys_private.cerrar_otras_sesiones(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function buddys_private.cerrar_otras_sesiones(uuid, uuid) to buddys_app;

-- -----------------------------------------------------------------------------------------------------
-- B2: el bucket `avatares` queda privado aunque ya existiera (solo en Supabase: PGlite no tiene Storage)
-- -----------------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
    set public = false, file_size_limit = 262144, allowed_mime_types = array['image/webp']
    where id = 'avatares';
  end if;
end;
$$;
