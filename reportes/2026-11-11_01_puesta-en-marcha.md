# 01 — Puesta en marcha de Buddys Wash Detail

> **Actualización (informe 02):** el frontend se sacó; el sistema es solo la API, con "Registrar lavado". Lo de
> colores, logo y capturas de este informe ya no aplica.

Fecha: 2026-11-11

## Qué se hizo

Se copió el sistema completo de MgDetailing (backend Express + Supabase, frontend React con landing y panel `/admin`)
y se adaptó a la marca **Buddys Wash Detail**:

- **Nombre**: "MgDetailing" → "Buddys Wash Detail" en textos, títulos, PDFs, avisos y el panel instalable ("Buddys Panel").
- **Base de datos**: esquema `buddys`, rol de la app `buddys_app` y esquema privado `buddys_private` (las migraciones de
  `backend/supabase/migrations/` ya usan estos nombres). Es una base **nueva**: no comparte datos con MgDetailing.
- **Sesión**: cookies `bd_at` / `bd_rt` (antes `mg_at` / `mg_rt`) y claves de `localStorage` `buddys-*`, así las
  sesiones de un sistema no se cruzan con las del otro en el mismo navegador.
- **Colores**: el rojo de MG pasó al rosa del logo (`--rosa-500` #e070b2 para filetes y foco, `--rosa-600` #b8327f
  para el botón primario, texto blanco con contraste 5,5:1). Se mantienen el grafito y el cromado.
- **Logo**: `frontend/public/fotos/Buddys-logo.png` (fondo transparente, a partir del logo enviado). `npm --prefix
  frontend run marca` genera cabecera, favicon, íconos de la app, og:image y el cuadro de la landing.
- **Se sacó lo que era de MG**: fotos de trabajos (galería vacía: muestra "Fotos reales muy pronto"), video 3D del
  monograma, precios iniciales de MG, WhatsApp, dirección, horarios, mapa y el proyecto de Supabase de MG en
  `.mcp.json`.

## Pendientes del dueño (para salir)

1. **Crear un proyecto de Supabase para Buddys** y aplicar todas las migraciones de `backend/supabase/migrations/`
   en orden (CLI: `supabase link --project-ref <ref>` y `supabase db push`). Después, seguir
   [backend/README.md](../backend/README.md#conectar-supabase) para crear la contraseña del rol `buddys_app`, cargar
   `backend/.env` y dar de alta al primer superadmin.
2. **Dominio de la API**: hoy figura `api.buddyswashdetail.com.ar` como provisorio en `render.yaml`.
3. **Ciudad**: el sistema usa la hora de La Rioja (Argentina) y textos que dicen "La Rioja". Si Buddys está en otra
   ciudad, avisar para cambiarlo.
4. **Servicios y precios**: se cargan con `PATCH /api/admin/servicios/:id` (el catálogo inicial es el mismo de MG, sin precios).
5. **Trabajadores**: crear los usuarios del equipo con `POST /api/admin/usuarios` (superadmin), así aparecen en los
   lavados y en el ranking de Estadísticas.
6. **Deploy**: `render.yaml` trae solo el servicio `buddys` (la API).

