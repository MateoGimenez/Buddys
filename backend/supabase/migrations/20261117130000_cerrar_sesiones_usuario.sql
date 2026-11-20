-- =====================================================================================================
-- Cerrar todas las sesiones de un usuario del panel (auditoría de seguridad del objetivo A, hallazgo B3).
--
-- Problema: cuando el superadmin o un admin le cambia la contraseña o el email a alguien desde el panel
-- (PATCH /api/admin/usuarios/:id), las sesiones que esa persona ya tenía abiertas seguían vivas: con un refresh
-- token robado o una sesión olvidada en otra compu se seguía entrando hasta el tope de 12 h. "Le cambio la
-- contraseña" tiene que querer decir "de ahora en más entra solo con la nueva".
--
-- Arreglo: buddys_private.cerrar_sesiones(p_usuario) borra las filas de auth.sessions de ese usuario (en Supabase,
-- los refresh tokens se van en cascada con su sesión) y devuelve cuántas borró. El backend ya comprueba en cada
-- request que la sesión siga en auth.sessions (buddys_private.sesion_vigente), así que el corte vale desde el
-- request siguiente. La llama el backend después de cambiarle la contraseña o el email a OTRA persona, y en la baja
-- como refuerzo (el middleware ya la frena por `activo`). Si uno cambia su propia contraseña, su sesión sigue.
--
-- Mismo modelo que buddys_private.sesion_vigente y el trigger del superadmin: SECURITY DEFINER (corre como su dueño,
-- postgres; buddys_app no tiene ni debe tener acceso al esquema auth) con search_path vacío y todo calificado, en el
-- esquema NO expuesto buddys_private, EXECUTE solo para buddys_app. Solo recibe un uuid y devuelve un entero: no
-- devuelve datos de las sesiones. No usa auth.uid(): la llama el backend con su propio rol. Quién puede cerrarle las
-- sesiones a quién lo decide el backend (las mismas reglas que para editarlo).
-- Idempotente (create or replace): se puede volver a aplicar.
-- =====================================================================================================

create or replace function buddys_private.cerrar_sesiones(p_usuario uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cerradas integer;
begin
  delete from auth.sessions as s where s.user_id = p_usuario;
  get diagnostics v_cerradas = row_count;
  return v_cerradas;
end;
$$;

comment on function buddys_private.cerrar_sesiones(uuid) is
  'Borra todas las sesiones de Supabase Auth (auth.sessions) de ese usuario y devuelve cuántas borró. La llama el '
  'backend al cambiarle la contraseña o el email a otra persona y en la baja. Solo para buddys_app.';

revoke all on function buddys_private.cerrar_sesiones(uuid) from public, anon, authenticated, service_role;
grant execute on function buddys_private.cerrar_sesiones(uuid) to buddys_app;
