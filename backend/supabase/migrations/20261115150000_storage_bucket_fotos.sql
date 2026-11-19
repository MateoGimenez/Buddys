-- =====================================================================================================
-- Buddys: bucket de Supabase Storage para las fotos antes/después (contrato:
-- reportes/2026-11-15_03_contrato-mejoras.md, función 13). Va SEPARADA de la tabla (20261115140000_lavado_fotos.sql)
-- porque toca el esquema `storage` de Supabase, no el de la app.
--
-- Qué hace:
--  1. Crea (o deja en su lugar) el bucket `lavados-fotos`:
--       - PRIVADO (public = false): ningún archivo tiene URL pública permanente. Para verlo hace falta una URL
--         firmada, que arma el backend con la secret key y vence a los 5 minutos.
--       - file_size_limit = 1.572.864 bytes (1,5 MB) y allowed_mime_types = image/jpeg, image/webp: Storage rechaza
--         cualquier otro archivo aunque alguien tuviera una URL de subida firmada.
--  2. Una policy RESTRICTIVA en storage.objects que deja a los roles de la API pública de Supabase (anon y
--     authenticated) sin ningún acceso a los objetos de este bucket. Las restrictivas se combinan con AND: aunque
--     mañana alguien agregue una policy permisiva amplia ("authenticated puede leer todo"), este bucket sigue cerrado.
--     El backend no la necesita: usa la secret key (rol service_role, que no pasa por RLS) y nunca la manda al
--     navegador. El panel sube con la URL firmada de subida (el token de la URL es el permiso, de un solo uso).
--
-- No hay policies permisivas para este bucket a propósito: nadie, salvo el backend, lista, lee, sube ni borra.
--
-- Fuera de Supabase (PGlite de los tests, un Postgres local) no existe el esquema `storage`: la migración no hace
-- nada y lo avisa con un NOTICE. Idempotente: el bucket se crea con ON CONFLICT (y se corrigen sus límites si ya
-- estaba) y la policy se borra y se vuelve a crear.
--
-- NO la aplica el backend ni este agente: la aplica el dueño en el proyecto de Buddys (nunca en el de MgDetail).
-- Para revisarla después: Storage > Buckets > lavados-fotos (Private, 1.5 MB, image/jpeg y image/webp) y
-- Storage > Policies (la restrictiva `lavados_fotos_sin_acceso_api`).
-- =====================================================================================================

do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is null or pg_catalog.to_regclass('storage.objects') is null then
    raise notice 'No hay esquema storage (esto no es Supabase): no se crea el bucket lavados-fotos.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('lavados-fotos', 'lavados-fotos', false, 1572864, array['image/jpeg', 'image/webp'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists lavados_fotos_sin_acceso_api on storage.objects;
  create policy lavados_fotos_sin_acceso_api on storage.objects
    as restrictive
    for all
    to anon, authenticated
    using (bucket_id <> 'lavados-fotos')
    with check (bucket_id <> 'lavados-fotos');

  comment on policy lavados_fotos_sin_acceso_api on storage.objects is
    'Buddys: los roles de la API pública no tocan el bucket privado lavados-fotos (solo el backend, con URLs firmadas).';
end;
$$;
