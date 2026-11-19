-- =====================================================================================================
-- Buddys: descripciones de los roles coherentes con la gestión de usuarios nueva
-- (contrato: reportes/2026-11-17_03_gestion-usuarios.md, sección "Permisos").
--
-- La capacidad usuarios.gestionar pasa a "parcial" para el admin: crea, edita, desactiva y da de baja SOLO a
-- empleados. La descripción del admin en buddys.roles decía "No gestiona usuarios." y sale en GET /api/admin/permisos:
-- se corrige. La del superadmin suma la baja sin perder historial. La del empleado no cambia.
--
-- Solo datos: dos UPDATE de buddys.roles (tres filas fijas; no bloquea nada). Las dos descripciones respetan el CHECK
-- roles_descripcion_largo (máx. 300 caracteres).
--
-- Seguridad, mismo modelo que las migraciones anteriores: RLS de roles habilitado y su policy de select para
-- buddys_app sin cambios; buddys_app sigue con solo SELECT (no escribe roles). Se repite el REVOKE a los roles de la API
-- de Supabase (defensa en profundidad).
--
-- Idempotente (se puede correr dos veces). No se aplica a Supabase remoto sin pasar las pruebas.
-- =====================================================================================================

update buddys.roles set descripcion =
  'Puede todo lo del administrador y, además, gestionar a todos los usuarios: alta, rol, acceso al panel y baja (sin perder su historial).'
  where id = 'superadmin';

update buddys.roles set descripcion =
  'Gestiona turnos, el cobro de cada trabajo, catálogo y disponibilidad; ve estadísticas con importes; lleva gastos, metas, presupuestos, comprobantes, datos del taller e inventario. Gestiona solo a los empleados.'
  where id = 'admin';

alter table buddys.roles enable row level security;
revoke all on buddys.roles from public, anon, authenticated, service_role;
grant select on buddys.roles to buddys_app;
