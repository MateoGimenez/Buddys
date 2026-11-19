-- =====================================================================================================
-- Buddys: aviso push de "meta del mes cumplida" una sola vez por mes (contrato:
-- reportes/2026-11-15_03_contrato-mejoras.md, función 7).
--
--  - metas_mensuales.cumplida_avisada_at timestamptz: cuándo se avisó que la meta de ese mes se cumplió. Null =
--    todavía no. El backend la marca con un UPDATE ... WHERE cumplida_avisada_at IS NULL (el que la marca es el
--    único que avisa, aunque dos lavados entren a la vez). Si se cambia la meta del mes, el backend la vuelve a null.
--  - El aviso de "lavado sin monto" no necesita nada en la base (se manda al registrarlo).
--
-- Seguridad: buddys_app gana UPDATE solo de esa columna (RLS y policies de metas_mensuales ya existen; se repite el
-- REVOKE). Idempotente. Columna nullable sin default: no reescribe la tabla. No se aplica a Supabase remoto sin pasar
-- las pruebas.
-- =====================================================================================================

alter table buddys.metas_mensuales add column if not exists cumplida_avisada_at timestamptz;

comment on column buddys.metas_mensuales.cumplida_avisada_at is
  'Cuándo se mandó el aviso push de meta cumplida (una vez por mes). Null = todavía no; se limpia al cambiar la meta.';

alter table buddys.metas_mensuales enable row level security;
revoke all on buddys.metas_mensuales from public, anon, authenticated, service_role;
grant update (cumplida_avisada_at) on buddys.metas_mensuales to buddys_app;
