-- Datos de ejemplo para mostrar el panel (demo). NO es una migración: se corre a mano, una vez, en el SQL Editor de
-- Supabase (proyecto Buddys). Todo lo que crea tiene un id que empieza con "de30000": borrar.sql lo saca entero sin
-- tocar los datos reales. Se puede volver a correr: primero borra lo de demo anterior.
--
-- Qué carga (fechas relativas al día en que se corre, hora de Argentina):
--  - Lavados de mostrador de los últimos ~75 días (sin domingos), entre 3 y 8 por día, con servicio, vehículo, forma
--    de pago y algún descuento. Los de hoy quedan repartidos en las etapas (en espera, lavando, listo, entregado).
--  - Turnos confirmados para los próximos días (agenda).
--  - Gastos de los últimos 3 meses, insumos con stock (uno por debajo del mínimo) y la meta del mes.
-- Los lavados quedan a nombre de los perfiles activos o existentes (el dueño y los empleados que ya haya).

begin;

-- Lo de demo anterior (igual que borrar.sql).
delete from buddys.movimientos_stock where insumo_id::text like 'de30000%';
delete from buddys.recetas where insumo_id::text like 'de30000%';
delete from buddys.lavado_servicios where booking_id::text like 'de30000%';
delete from buddys.bookings where id::text like 'de30000%';
delete from buddys.gastos where id::text like 'de30000%';
delete from buddys.insumos where id::text like 'de30000%';

select setseed(0.42);

-- Quiénes figuran como que registraron y lavaron: los perfiles con nombre que no fueron eliminados.
create temp table demo_personas on commit drop as
select id, row_number() over (order by rol_id = 'superadmin' desc, created_at) - 1 as n
from buddys.perfiles
where eliminado_at is null and nombre is not null;

create temp table demo_servicios (id text, peso int) on commit drop;
insert into demo_servicios values
  ('limpieza-nivel-1', 30), ('limpieza-nivel-2', 22), ('limpieza-nivel-3', 10), ('limpieza-motor', 6),
  ('higienizacion-profunda', 5), ('pulido-opticas', 4), ('pulido-basico', 3), ('tratamiento-acrilico', 2),
  ('tratamiento-ceramico', 1), ('motos-basico', 6);

-- Un lavado por fila: día y número dentro del día.
create temp table demo_lavados on commit drop as
with hoy as (select (now() at time zone 'America/Argentina/Buenos_Aires')::date as d),
dias as (
  select g::date as fecha
  from hoy, generate_series(hoy.d - 75, hoy.d, interval '1 day') g
  where extract(isodow from g) <> 7
),
cantidad as (
  select fecha,
         case when extract(isodow from fecha) = 6 then 5 + floor(random() * 4)::int else 3 + floor(random() * 4)::int end as n
  from dias
),
filas as (
  select fecha, i, n from cantidad, generate_series(1, n) i
)
select row_number() over (order by fecha, i) as k, fecha, i, n,
       (fecha = (select d from hoy)) as es_hoy,
       random() as r_serv, random() as r_veh, random() as r_pago, random() as r_desc, random() as r_mod, random() as r_nom
from filas;

-- Hoy, como mucho 6.
delete from demo_lavados where es_hoy and i > 6;

create temp table demo_lavados2 on commit drop as
select l.*,
       s.id as servicio_id,
       case when s.id like 'motos-%' then 'moto'
            when l.r_veh < 0.6 then 'auto' when l.r_veh < 0.85 then 'suv' else 'pickup' end as vehiculo,
       (('de300000-0000-4000-8000-' || lpad(to_hex(l.k), 12, '0'))::uuid) as id,
       (('de300001-0000-4000-8000-' || lpad(to_hex(l.k), 12, '0'))::uuid) as id_local,
       -- Hora (Argentina): de 9 a 19 en orden; hoy, uno cada 45 min desde las 9 (así hay autos en el lavadero).
       ((l.fecha + time '09:00' + make_interval(mins => case when l.es_hoy then (l.i - 1) * 45 else (l.i - 1) * 600 / greatest(l.n, 1) end + floor(l.r_mod * 20)::int))
          at time zone 'America/Argentina/Buenos_Aires') as cuando
from demo_lavados l
cross join lateral (
  select ds.id from demo_servicios ds
  -- Elección ponderada por peso (cada lavado sortea la suya: la referencia a l.k la hace correlacionada).
  order by -ln(greatest(random(), 1e-9)) / ds.peso + 0 * l.k
  limit 1
) s;

-- Hoy, solo los que ya pasaron (ninguno con hora futura).
delete from demo_lavados2 where es_hoy and cuando > now();

insert into buddys.bookings (
  id, id_local, nombre, telefono, vehiculo_tipo, vehiculo_modelo, servicio_id, fecha_preferida, franja, estado,
  origen, monto, descuento, descuento_motivo, forma_pago, trabajador_id, registrado_por, etapa, etapa_at,
  created_at, updated_at
)
select
  l.id, l.id_local,
  (array['Cliente de mostrador','Martín G.','Lucía P.','Diego R.','Sofía M.','Javier L.','Carla V.','Nicolás A.',
         'Valentina S.','Federico T.','Romina D.','Pablo C.','Cliente de mostrador'])[1 + floor(l.r_nom * 13)::int],
  null,
  l.vehiculo,
  case l.vehiculo
    when 'moto' then (array['Honda Wave','Yamaha FZ','Motomel Skua','Honda CB 190'])[1 + floor(l.r_mod * 4)::int]
    when 'suv' then (array['Jeep Renegade','VW T-Cross','Toyota Corolla Cross','Renault Duster','Chevrolet Tracker'])[1 + floor(l.r_mod * 5)::int]
    when 'pickup' then (array['Toyota Hilux','Ford Ranger','VW Amarok','Fiat Toro'])[1 + floor(l.r_mod * 4)::int]
    else (array['Fiat Cronos','VW Gol Trend','Peugeot 208','Chevrolet Onix','Toyota Etios','Renault Sandero','Ford Ka'])[1 + floor(l.r_mod * 7)::int]
  end,
  l.servicio_id,
  l.fecha,
  case when extract(hour from l.cuando at time zone 'America/Argentina/Buenos_Aires') < 13 then 'manana' else 'tarde' end,
  'completado',
  'mostrador',
  p.precio - case when l.r_desc < 0.08 then (p.precio / 10) else 0 end,
  case when l.r_desc < 0.08 then (p.precio / 10) else 0 end,
  case when l.r_desc < 0.08 then 'Cliente frecuente' end,
  case when l.r_pago < 0.45 then 'efectivo' when l.r_pago < 0.85 then 'transferencia'
       when l.r_pago < 0.95 then 'debito' else 'credito' end,
  t.id,
  t.id,
  case when not l.es_hoy then 'entregado'
       when l.i = (select max(i) from demo_lavados2 where es_hoy) then 'espera'
       when l.i = (select max(i) from demo_lavados2 where es_hoy) - 1 then 'lavando'
       when l.i = (select max(i) from demo_lavados2 where es_hoy) - 2 then 'listo'
       else 'entregado' end,
  l.cuando,
  l.cuando,
  l.cuando
from demo_lavados2 l
cross join lateral (
  select coalesce(case l.vehiculo when 'moto' then s.precio_desde_moto when 'suv' then s.precio_desde_suv
                                  when 'pickup' then s.precio_desde_pickup else s.precio_desde end,
                  s.precio_desde, s.precio_desde_moto, 25000) as precio
  from buddys.servicios s where s.id = l.servicio_id
) p
cross join lateral (
  select dp.id from demo_personas dp
  where dp.n = l.k % greatest((select count(*) from demo_personas), 1)
) t;

-- lavado_servicios (orden 0, con su precio de lista) lo completa el trigger de bookings.

-- Turnos confirmados para los próximos días (agenda). Teléfonos ficticios.
insert into buddys.bookings (
  id, nombre, telefono, vehiculo_tipo, vehiculo_modelo, servicio_id, fecha_preferida, franja, estado, origen,
  fecha_confirmada, franja_confirmada, comentario, created_at, updated_at
)
select
  (('de300004-0000-4000-8000-' || lpad(to_hex(x.n), 12, '0'))::uuid),
  x.nombre, x.tel, x.veh, x.modelo, x.serv, hoy + x.dias, x.franja, 'confirmado', 'panel',
  hoy + x.dias, x.franja, x.coment, now(), now()
from (select (now() at time zone 'America/Argentina/Buenos_Aires')::date as hoy) h
cross join (values
  (1, 'Gustavo F.',   '3804000101', 'suv',    'Toyota SW4',     'tratamiento-ceramico',   1, 'manana', 'Viene a dejarlo temprano'),
  (2, 'Mariela Q.',   '3804000102', 'auto',   'Peugeot 208',    'pulido-abrillantado',    1, 'tarde',  null),
  (3, 'Esteban K.',   '3804000103', 'pickup', 'Ford Ranger',    'higienizacion-profunda', 2, 'manana', 'Tapizado con manchas de café'),
  (4, 'Laura B.',     '3804000104', 'auto',   'Fiat Cronos',    'preparacion-venta',      3, 'manana', 'Lo vende el sábado'),
  (5, 'Ramiro N.',    '3804000105', 'auto',   'VW Vento',       'restauracion-opticas',   4, 'tarde',  null)
) as x(n, nombre, tel, veh, modelo, serv, dias, franja, coment);

-- Gastos de los últimos 3 meses (el actual incluido).
insert into buddys.gastos (id, fecha, categoria, descripcion, monto, proveedor, origen, creado_por)
select
  (('de300002-0000-4000-8000-' || lpad(to_hex(m.n * 10 + g.n), 12, '0'))::uuid),
  least(m.mes + (g.dia - 1), (now() at time zone 'America/Argentina/Buenos_Aires')::date),
  g.categoria, g.descripcion, g.monto, g.proveedor, 'manual',
  (select id from demo_personas where n = 0)
from (
  select n, (date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires')) - make_interval(months => n))::date as mes
  from generate_series(0, 2) n
) m
cross join (values
  (1, 1,  'alquiler',      'Alquiler del local',              650000, 'Inmobiliaria'),
  (2, 5,  'insumos',       'Shampoo y desengrasante (bidones)', 145000, 'Distribuidora Química'),
  (3, 8,  'servicios',     'Luz',                              98000, 'EDELaR'),
  (4, 10, 'servicios',     'Agua',                             42000, 'Aguas Riojanas'),
  (5, 14, 'insumos',       'Microfibras y esponjas',           68000, 'Distribuidora Química'),
  (6, 18, 'publicidad',    'Publicidad en Instagram',          50000, null),
  (7, 22, 'mantenimiento', 'Service de la hidrolavadora',      85000, 'Taller Kärcher'),
  (8, 25, 'insumos',       'Cera y acondicionador de plásticos', 92000, 'Distribuidora Química')
) as g(n, dia, categoria, descripcion, monto, proveedor)
where m.mes + (g.dia - 1) <= (now() at time zone 'America/Argentina/Buenos_Aires')::date;

-- Insumos (el desengrasante queda por debajo del mínimo: muestra el aviso de reponer).
insert into buddys.insumos (id, nombre, categoria, unidad, stock, stock_minimo, costo_unitario, activo)
values
  ('de300003-0000-4000-8000-000000000001', 'Shampoo neutro',            'Lavado',     'litro',  18,  10, 4500,  true),
  ('de300003-0000-4000-8000-000000000002', 'Desengrasante',             'Lavado',     'litro',   3,  8, 5200,  true),
  ('de300003-0000-4000-8000-000000000003', 'Acondicionador de plásticos','Interior',  'litro',   6,  3, 9800,  true),
  ('de300003-0000-4000-8000-000000000004', 'Microfibras',               'Accesorios', 'unidad', 40, 20, 1500,  true),
  ('de300003-0000-4000-8000-000000000005', 'Cera en pasta',             'Pulido',     'unidad',  5,  2, 18000, true),
  ('de300003-0000-4000-8000-000000000006', 'Pasta de pulir',            'Pulido',     'kg',      2,  1, 32000, true),
  ('de300003-0000-4000-8000-000000000007', 'Limpiavidrios',             'Lavado',     'litro',   9,  4, 3900,  true),
  ('de300003-0000-4000-8000-000000000008', 'Revestimiento cerámico',    'Protección', 'unidad',  3,  2, 95000, true);

-- Meta del mes actual (solo si no hay una real cargada).
insert into buddys.metas_mensuales (mes, ingresos_objetivo, trabajos_objetivo)
values (date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date, 7000000, 160)
on conflict (mes) do nothing;

commit;

-- Resumen
select
  (select count(*) from buddys.bookings where id::text like 'de300000-%') as lavados,
  (select count(*) from buddys.bookings where id::text like 'de300004-%') as turnos,
  (select count(*) from buddys.gastos where id::text like 'de300002-%') as gastos,
  (select count(*) from buddys.insumos where id::text like 'de300003-%') as insumos;
