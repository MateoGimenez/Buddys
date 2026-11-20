-- =====================================================================================================
-- Buddys: insumos que se descuentan solos (contrato: reportes/2026-11-15_03_contrato-mejoras.md, función 15).
--
--  - buddys.servicio_insumos: la "receta" de cada servicio: qué insumo usa y cuánto por vehículo. cantidad es la de
--    auto (y la de cualquier vehículo sin la suya); cantidad_suv, cantidad_pickup y cantidad_moto, null = usa
--    cantidad. servicio_id ON DELETE CASCADE (un servicio no se borra, se desactiva; si se borrara, su receta se va);
--    insumo_id ON DELETE RESTRICT (los insumos no se borran, se desactivan).
--  - movimientos_stock.automatico boolean: el movimiento lo generó el sistema por un lavado o turno (turno_id).
--  - buddys.sincronizar_insumos_turno(turno, perfil, revertir): deja los movimientos automáticos de un turno en lo que
--    corresponde: si está completado (y no se pide revertir), lo de su receta (suma de sus servicios para su
--    vehículo); si no, nada. Compara con lo ya descontado y registra solo la diferencia: una salida ('uso', negativa) o
--    una devolución ('ajuste', positiva), siempre con automatico = true. Nunca deja el stock en negativo: si no
--    alcanza, descuenta lo que hay (y el lavado nunca se frena por eso). Mismo bloqueo por insumo que el backend
--    (pg_advisory_xact_lock(7340010, hashtext(id))). La llama el backend dentro de la transacción del lavado: al
--    registrarlo, al cambiarle estado o servicios, y antes de borrarlo (revertir = true).
--    SECURITY INVOKER y search_path vacío: corre con los permisos de buddys_app (SELECT de la receta, UPDATE del stock,
--    INSERT de movimientos).
--
-- Los movimientos siguen siendo inmutables para la app (sin UPDATE ni DELETE): revertir es registrar la devolución.
--
-- Seguridad, mismo modelo que inventario: RLS habilitado, REVOKE a los roles de la API de Supabase, GRANT mínimo a
-- buddys_app con su policy: servicio_insumos SELECT, INSERT y DELETE (la receta se reemplaza entera); movimientos
-- INSERT de la columna nueva.
--
-- Idempotente. La columna con default constante no reescribe la tabla. No se aplica a Supabase remoto sin pasar las
-- pruebas.
-- =====================================================================================================

create table if not exists buddys.servicio_insumos (
  servicio_id     text          not null
                                constraint servicio_insumos_servicio_fkey references buddys.servicios (id) on update restrict on delete cascade,
  insumo_id       uuid          not null
                                constraint servicio_insumos_insumo_fkey references buddys.insumos (id) on update restrict on delete restrict,
  cantidad        numeric(12,2) not null constraint servicio_insumos_cantidad_rango check (cantidad > 0 and cantidad <= 999999),
  cantidad_suv    numeric(12,2) constraint servicio_insumos_cantidad_suv_rango check (cantidad_suv > 0 and cantidad_suv <= 999999),
  cantidad_pickup numeric(12,2) constraint servicio_insumos_cantidad_pickup_rango check (cantidad_pickup > 0 and cantidad_pickup <= 999999),
  cantidad_moto   numeric(12,2) constraint servicio_insumos_cantidad_moto_rango check (cantidad_moto > 0 and cantidad_moto <= 999999),
  constraint servicio_insumos_pkey primary key (servicio_id, insumo_id)
);

comment on table buddys.servicio_insumos is
  'Receta de cada servicio: insumo y cantidad por vehículo (null = usa cantidad). Se descuenta sola al completar.';

-- La FK insumo_id (y "en qué servicios se usa este insumo").
create index if not exists servicio_insumos_insumo_idx on buddys.servicio_insumos (insumo_id);

alter table buddys.movimientos_stock add column if not exists automatico boolean not null default false;
comment on column buddys.movimientos_stock.automatico is
  'true = lo generó el sistema por un lavado o turno (turno_id): salida al completarlo o devolución al deshacerlo.';

-- Los movimientos automáticos de un turno (la sincronización los suma por insumo).
create index if not exists movimientos_stock_turno_automatico_idx on buddys.movimientos_stock (turno_id, insumo_id)
  where automatico and turno_id is not null;

-- -----------------------------------------------------------------------------------------------------
-- Sincronización de los movimientos automáticos de un turno.
-- -----------------------------------------------------------------------------------------------------
create or replace function buddys.sincronizar_insumos_turno(p_turno uuid, p_perfil uuid, p_revertir boolean)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  r record;
  delta numeric(12,2);
  disponible numeric(12,2);
begin
  for r in
    with objetivo as (
      select si.insumo_id,
             sum(coalesce(case b.vehiculo_tipo
                            when 'suv' then si.cantidad_suv
                            when 'pickup' then si.cantidad_pickup
                            when 'moto' then si.cantidad_moto
                          end, si.cantidad)) as cantidad
      from buddys.bookings b
      join buddys.lavado_servicios ls on ls.booking_id = b.id
      join buddys.servicio_insumos si on si.servicio_id = ls.servicio_id
      where b.id = p_turno and b.estado = 'completado' and not p_revertir
      group by si.insumo_id
    ),
    hecho as (
      select m.insumo_id, -sum(m.cantidad) as cantidad
      from buddys.movimientos_stock m
      where m.turno_id = p_turno and m.automatico
      group by m.insumo_id
    )
    select coalesce(o.insumo_id, h.insumo_id) as insumo_id,
           coalesce(o.cantidad, 0) - coalesce(h.cantidad, 0) as falta
    from objetivo o
    full join hecho h on h.insumo_id = o.insumo_id
    order by 1
  loop
    continue when r.falta = 0;
    perform pg_catalog.pg_advisory_xact_lock(7340010, pg_catalog.hashtext(r.insumo_id::text));
    select i.stock into disponible from buddys.insumos i where i.id = r.insumo_id;
    if r.falta > 0 then
      -- Falta descontar: lo que alcance (nunca negativo).
      delta := least(r.falta, disponible);
      continue when delta <= 0;
      update buddys.insumos set stock = stock - delta where id = r.insumo_id;
      insert into buddys.movimientos_stock (insumo_id, tipo, cantidad, nota, turno_id, perfil_id, automatico)
      values (r.insumo_id, 'uso', -delta, 'Descuento automático del lavado', p_turno, p_perfil, true);
    else
      -- Se descontó de más (salió de completado, cambió de servicios o se borra): se devuelve, con el tope del stock.
      delta := least(-r.falta, 9999999.99 - disponible);
      continue when delta <= 0;
      update buddys.insumos set stock = stock + delta where id = r.insumo_id;
      insert into buddys.movimientos_stock (insumo_id, tipo, cantidad, nota, turno_id, perfil_id, automatico)
      values (r.insumo_id, 'ajuste', delta, 'Devolución automática del lavado', p_turno, p_perfil, true);
    end if;
  end loop;
end;
$$;

comment on function buddys.sincronizar_insumos_turno(uuid, uuid, boolean) is
  'Deja los movimientos automáticos de stock de un turno en lo que pide su receta (o en cero si revertir).';

revoke all on function buddys.sincronizar_insumos_turno(uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function buddys.sincronizar_insumos_turno(uuid, uuid, boolean) to buddys_app;

-- -----------------------------------------------------------------------------------------------------
-- Seguridad
-- -----------------------------------------------------------------------------------------------------
alter table buddys.servicio_insumos enable row level security;
revoke all on buddys.servicio_insumos from public, anon, authenticated, service_role;
grant select, insert, delete on buddys.servicio_insumos to buddys_app;

drop policy if exists servicio_insumos_app_select on buddys.servicio_insumos;
drop policy if exists servicio_insumos_app_insert on buddys.servicio_insumos;
drop policy if exists servicio_insumos_app_delete on buddys.servicio_insumos;
create policy servicio_insumos_app_select on buddys.servicio_insumos for select to buddys_app using (true);
create policy servicio_insumos_app_insert on buddys.servicio_insumos for insert to buddys_app with check (true);
create policy servicio_insumos_app_delete on buddys.servicio_insumos for delete to buddys_app using (true);

alter table buddys.movimientos_stock enable row level security;
revoke all on buddys.movimientos_stock from public, anon, authenticated, service_role;
grant insert (automatico) on buddys.movimientos_stock to buddys_app;
