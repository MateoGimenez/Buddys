-- =====================================================================================================
-- Finanzas: gastos, metas mensuales y datos del taller
-- (contrato: reportes/2026-10-27_17_finanzas-inventario-documentos.md, migración M1).
--
--  - buddys.gastos: lo que el taller gasta (insumos, alquiler, servicios, sueldos...). Pesos enteros (1 a
--    99.999.999). `origen = 'inventario'` marca los gastos que crea solo una compra de inventario (migración M2):
--    el backend no deja editarlos ni borrarlos desde Gastos (409 GASTO_DE_INVENTARIO). `creado_por` -> perfiles
--    ON DELETE SET NULL: si la persona se borra, el gasto queda (sin autor). Índice por fecha (el listado y las
--    estadísticas filtran por rango de fechas) e índice parcial de la FK.
--  - buddys.metas_mensuales: la meta de cada mes (`mes` = siempre el día 1). Meta de ingresos y/o de trabajos
--    completados; al menos una de las dos.
--  - buddys.taller: UNA sola fila (id = 1) con los datos que salen en los PDF (nombre, teléfono, dirección,
--    Instagram, CUIT y una leyenda). Sembrada con los datos que el dueño ya cargó en la web. Sin INSERT ni DELETE
--    para la app: la fila no se crea ni se borra, solo se edita.
--  - Los textos de buddys.roles.descripcion se actualizan para que digan lo mismo que la matriz de permisos
--    (domain/permisos.ts, CAPACIDADES). Respetan el CHECK de 300 caracteres.
--
-- Seguridad, mismo modelo que rol_app_minimo_privilegio: RLS habilitado, sin policies ni privilegios para anon,
-- authenticated ni service_role; GRANT mínimo a buddys_app con su policy USING/WITH CHECK (true):
--   gastos:           SELECT, INSERT, DELETE y UPDATE de las columnas editables.
--   metas_mensuales:  SELECT, INSERT, DELETE y UPDATE de los objetivos.
--   taller:           SELECT y UPDATE de las columnas editables (nunca id).
-- Los CHECK de rango y de largo son la segunda línea de defensa (la API valida con zod). updated_at lo mantiene
-- el trigger set_updated_at existente.
--
-- Tablas nuevas: no se reescribe nada. Esta migración no toca turnos ni catálogo. No se aplica a Supabase remoto
-- sin pasar las pruebas.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- gastos
-- -----------------------------------------------------------------------------------------------------
create table buddys.gastos (
  id          uuid        primary key default gen_random_uuid(),
  fecha       date        not null,
  categoria   text        not null
                          constraint gastos_categoria_valida check (
                            categoria in ('insumos', 'herramientas', 'alquiler', 'servicios', 'sueldos',
                                          'publicidad', 'mantenimiento', 'impuestos', 'otros')),
  descripcion text        not null
                          constraint gastos_descripcion_largo check (char_length(descripcion) between 1 and 120 and btrim(descripcion) <> ''),
  monto       integer     not null
                          constraint gastos_monto_rango check (monto between 1 and 99999999),
  proveedor   text
                          constraint gastos_proveedor_largo check (char_length(proveedor) between 1 and 80),
  origen      text        not null default 'manual'
                          constraint gastos_origen_valido check (origen in ('manual', 'inventario')),
  creado_por  uuid
                          constraint gastos_creado_por_fkey references buddys.perfiles (id) on update restrict on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table buddys.gastos is
  'Gastos del taller (pesos enteros). Ganancia neta = ingresos de los turnos completados - gastos, por fecha.';
comment on column buddys.gastos.origen is
  'manual = cargado en Finanzas; inventario = lo creó una compra de inventario (solo se corrige desde Inventario).';
comment on column buddys.gastos.creado_por is
  'Quién lo cargó (perfiles.id). Null si lo creó el sistema o la persona se borró.';

-- Listado y estadísticas: WHERE fecha BETWEEN $1 AND $2 [AND categoria = ...] ORDER BY fecha DESC.
create index gastos_fecha_idx on buddys.gastos (fecha);
-- La FK creado_por (ON DELETE SET NULL la recorre al borrar una persona).
create index gastos_creado_por_idx on buddys.gastos (creado_por) where creado_por is not null;

create trigger gastos_set_updated_at
  before update on buddys.gastos
  for each row execute function buddys.set_updated_at();

-- -----------------------------------------------------------------------------------------------------
-- metas_mensuales
-- -----------------------------------------------------------------------------------------------------
create table buddys.metas_mensuales (
  mes               date        primary key
                                constraint metas_mensuales_mes_dia_uno check (extract(day from mes) = 1),
  ingresos_objetivo integer
                                constraint metas_mensuales_ingresos_rango check (ingresos_objetivo between 1 and 999999999),
  trabajos_objetivo integer
                                constraint metas_mensuales_trabajos_rango check (trabajos_objetivo between 1 and 9999),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint metas_mensuales_alguna_meta check (ingresos_objetivo is not null or trabajos_objetivo is not null)
);

comment on table buddys.metas_mensuales is
  'Meta de cada mes: ingresos (pesos) y/o trabajos completados. mes = primer día del mes. Al menos una de las dos.';

create trigger metas_mensuales_set_updated_at
  before update on buddys.metas_mensuales
  for each row execute function buddys.set_updated_at();

-- -----------------------------------------------------------------------------------------------------
-- taller (una sola fila)
-- -----------------------------------------------------------------------------------------------------
create table buddys.taller (
  id          smallint    primary key default 1
                          constraint taller_una_sola_fila check (id = 1),
  nombre      text        not null default 'Buddys Wash Detail'
                          constraint taller_nombre_largo check (char_length(nombre) between 1 and 80 and btrim(nombre) <> ''),
  telefono    text
                          constraint taller_telefono_formato check (telefono ~ '^[0-9]{8,15}$'),
  direccion   text
                          constraint taller_direccion_largo check (char_length(direccion) between 1 and 160),
  instagram   text
                          constraint taller_instagram_formato check (instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  cuit        text
                          constraint taller_cuit_formato check (cuit ~ '^([0-9]{11}|[0-9]{2}-[0-9]{8}-[0-9])$'),
  leyenda_pdf text
                          constraint taller_leyenda_pdf_largo check (char_length(leyenda_pdf) between 1 and 300),
  updated_at  timestamptz not null default now()
);

comment on table buddys.taller is
  'Datos del taller que salen en los PDF. Una sola fila (id = 1). telefono: solo dígitos internacionales (8 a 15); instagram sin @.';

create trigger taller_set_updated_at
  before update on buddys.taller
  for each row execute function buddys.set_updated_at();

insert into buddys.taller (id, nombre, telefono, direccion)
values (1, 'Buddys Wash Detail', '5493804781737', 'Calle Olta Pasaje N2, La Rioja');

-- -----------------------------------------------------------------------------------------------------
-- Seguridad
-- -----------------------------------------------------------------------------------------------------
alter table buddys.gastos          enable row level security;
alter table buddys.metas_mensuales enable row level security;
alter table buddys.taller          enable row level security;

-- Las default privileges del esquema ya lo revocan; se repite explícito (defensa en profundidad).
revoke all on buddys.gastos          from public, anon, authenticated, service_role;
revoke all on buddys.metas_mensuales from public, anon, authenticated, service_role;
revoke all on buddys.taller          from public, anon, authenticated, service_role;

grant select, delete on buddys.gastos to buddys_app;
grant insert (fecha, categoria, descripcion, monto, proveedor, origen, creado_por) on buddys.gastos to buddys_app;
grant update (fecha, categoria, descripcion, monto, proveedor, updated_at) on buddys.gastos to buddys_app;

grant select, delete on buddys.metas_mensuales to buddys_app;
grant insert (mes, ingresos_objetivo, trabajos_objetivo) on buddys.metas_mensuales to buddys_app;
grant update (ingresos_objetivo, trabajos_objetivo, updated_at) on buddys.metas_mensuales to buddys_app;

grant select on buddys.taller to buddys_app;
grant update (nombre, telefono, direccion, instagram, cuit, leyenda_pdf, updated_at) on buddys.taller to buddys_app;

create policy gastos_app_select on buddys.gastos
  for select to buddys_app using (true);
create policy gastos_app_insert on buddys.gastos
  for insert to buddys_app with check (true);
create policy gastos_app_update on buddys.gastos
  for update to buddys_app using (true) with check (true);
create policy gastos_app_delete on buddys.gastos
  for delete to buddys_app using (true);

create policy metas_mensuales_app_select on buddys.metas_mensuales
  for select to buddys_app using (true);
create policy metas_mensuales_app_insert on buddys.metas_mensuales
  for insert to buddys_app with check (true);
create policy metas_mensuales_app_update on buddys.metas_mensuales
  for update to buddys_app using (true) with check (true);
create policy metas_mensuales_app_delete on buddys.metas_mensuales
  for delete to buddys_app using (true);

create policy taller_app_select on buddys.taller
  for select to buddys_app using (true);
create policy taller_app_update on buddys.taller
  for update to buddys_app using (true) with check (true);

-- -----------------------------------------------------------------------------------------------------
-- Descripciones de los roles (coherentes con la matriz de permisos; máx. 300 caracteres)
-- -----------------------------------------------------------------------------------------------------
update buddys.roles set descripcion =
  'Puede todo lo del administrador y, además, gestionar usuarios: alta, baja, rol y acceso al panel.'
  where id = 'superadmin';

update buddys.roles set descripcion =
  'Gestiona turnos, el cobro de cada trabajo, catálogo y disponibilidad; ve estadísticas con importes; lleva gastos, metas, presupuestos, comprobantes, datos del taller e inventario. No gestiona usuarios.'
  where id = 'admin';

update buddys.roles set descripcion =
  'Ve turnos y agenda, escribe notas y marca turnos como completados (sin cargar el monto). Ve sus propios trabajos, sin importes, y el inventario, donde registra el uso de insumos. No ve gastos ni metas.'
  where id = 'empleado';
