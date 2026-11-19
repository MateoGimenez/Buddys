-- =====================================================================================================
-- Buddys: etapa del auto en el lavadero y descuentos (contrato: reportes/2026-11-15_03_contrato-mejoras.md,
-- funciones 9 y 12).
--
--  - bookings.etapa text: dónde está el auto de un lavado de mostrador: espera -> lavando -> listo -> entregado. Solo
--    los lavados de mostrador la tienen (CHECK bookings_etapa_solo_mostrador); los turnos de la web o del panel quedan
--    en null. Los lavados ya registrados quedan 'entregado' (ya se fueron). bookings.etapa_at timestamptz: desde
--    cuándo está en esa etapa (para el tablero "autos en el lavadero ahora"); va junto con etapa.
--  - bookings.descuento integer not null default 0: pesos que se le rebajaron al cliente. `monto` sigue siendo lo
--    cobrado (ya con el descuento): el descuento es informativo. Es parte del cobro: solo en turnos completados
--    (CHECK bookings_descuento_solo_completado) y lleva motivo si es mayor que 0 (CHECK bookings_descuento_motivo).
--    bookings.descuento_motivo text (1 a 80 caracteres).
--
-- Corregir el descuento es como corregir el monto: no mueve updated_at (el "actualizado el" del seguimiento). Se
-- recrea el trigger con esas dos columnas en la condición. Cambiar la etapa sí lo mueve (es un cambio del lavado).
--
-- Seguridad, mismo modelo que rol_app_minimo_privilegio: el INSERT de buddys_app es sobre toda la tabla; UPDATE por
-- columna: solo las cuatro nuevas. RLS y policies de bookings ya existen; se repite el REVOKE (defensa en
-- profundidad).
--
-- Idempotente (se puede correr dos veces). La columna con default constante no reescribe la tabla (Postgres 11+).
-- No se aplica a Supabase remoto sin pasar las pruebas.
-- =====================================================================================================

alter table buddys.bookings
  add column if not exists etapa text,
  add column if not exists etapa_at timestamptz,
  add column if not exists descuento integer not null default 0,
  add column if not exists descuento_motivo text;

-- Los lavados de mostrador ya registrados se dan por entregados (desde que se registraron). Es un relleno, no un
-- cambio del lavado: no tiene que mover updated_at (el "actualizado el" del seguimiento), así que el trigger de
-- updated_at se apaga solo para esta sentencia (la migración corre en una transacción).
alter table buddys.bookings disable trigger bookings_set_updated_at;
update buddys.bookings
set etapa = 'entregado', etapa_at = created_at
where origen = 'mostrador' and etapa is null;
alter table buddys.bookings enable trigger bookings_set_updated_at;

alter table buddys.bookings drop constraint if exists bookings_etapa_valida;
alter table buddys.bookings
  add constraint bookings_etapa_valida check (etapa in ('espera', 'lavando', 'listo', 'entregado'));

alter table buddys.bookings drop constraint if exists bookings_etapa_solo_mostrador;
alter table buddys.bookings
  add constraint bookings_etapa_solo_mostrador check (
    (origen = 'mostrador' and etapa is not null and etapa_at is not null)
    or (origen <> 'mostrador' and etapa is null and etapa_at is null));

alter table buddys.bookings drop constraint if exists bookings_descuento_rango;
alter table buddys.bookings
  add constraint bookings_descuento_rango check (descuento between 0 and 99999999);

alter table buddys.bookings drop constraint if exists bookings_descuento_motivo;
alter table buddys.bookings
  add constraint bookings_descuento_motivo check (
    (descuento = 0 and descuento_motivo is null)
    or (descuento > 0 and char_length(descuento_motivo) between 1 and 80 and btrim(descuento_motivo) <> ''));

alter table buddys.bookings drop constraint if exists bookings_descuento_solo_completado;
alter table buddys.bookings
  add constraint bookings_descuento_solo_completado check (descuento = 0 or estado = 'completado');

comment on column buddys.bookings.etapa is
  'Lavados de mostrador: espera, lavando, listo o entregado. Null en los turnos de la web o del panel.';
comment on column buddys.bookings.etapa_at is 'Desde cuándo el lavado está en su etapa. Va junto con etapa.';
comment on column buddys.bookings.descuento is
  'Pesos rebajados al cliente (0 = sin descuento). monto ya es lo cobrado con el descuento. Solo en completados.';
comment on column buddys.bookings.descuento_motivo is 'Motivo del descuento (1 a 80). Obligatorio si descuento > 0.';

-- Un lavado de mostrador que llega sin etapa (un INSERT a mano o del backend anterior, durante un despliegue) nace
-- 'entregado'. SECURITY INVOKER y search_path vacío, como las demás funciones del esquema.
create or replace function buddys.bookings_etapa_por_defecto()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.origen = 'mostrador' and new.etapa is null then
    new.etapa := 'entregado';
  end if;
  if new.etapa is not null and new.etapa_at is null then
    new.etapa_at := coalesce(new.created_at, pg_catalog.now());
  end if;
  return new;
end;
$$;

comment on function buddys.bookings_etapa_por_defecto() is
  'Trigger BEFORE INSERT en bookings: un lavado de mostrador sin etapa nace entregado (con etapa_at).';

revoke all on function buddys.bookings_etapa_por_defecto() from public, anon, authenticated, service_role;

drop trigger if exists bookings_etapa_por_defecto on buddys.bookings;
create trigger bookings_etapa_por_defecto
  before insert on buddys.bookings
  for each row execute function buddys.bookings_etapa_por_defecto();

-- "Autos en el lavadero ahora": los lavados de mostrador de un día que todavía no se entregaron.
create index if not exists bookings_mostrador_en_curso_idx on buddys.bookings (
  (coalesce(fecha_confirmada, fecha_preferida)),
  seq
) where origen = 'mostrador' and etapa <> 'entregado';

-- El trigger de updated_at tampoco corre si la sentencia cambia el descuento (es parte del cobro).
drop trigger if exists bookings_set_updated_at on buddys.bookings;
create trigger bookings_set_updated_at
  before update on buddys.bookings
  for each row
  when (
    old.recordatorio_enviado_at is not distinct from new.recordatorio_enviado_at
    and old.monto is not distinct from new.monto
    and old.trabajador_id is not distinct from new.trabajador_id
    and old.forma_pago is not distinct from new.forma_pago
    and old.registrado_por is not distinct from new.registrado_por
    and old.descuento is not distinct from new.descuento
    and old.descuento_motivo is not distinct from new.descuento_motivo
  )
  execute function buddys.set_updated_at();

alter table buddys.bookings enable row level security;
revoke all on buddys.bookings from public, anon, authenticated, service_role;
grant update (etapa, etapa_at, descuento, descuento_motivo) on buddys.bookings to buddys_app;
