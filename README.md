# Buddys Wash Detail — sistema interno

Sistema interno de **Buddys Wash Detail** ([@buddyswashdetail](https://www.instagram.com/buddyswashdetail/)) para
registrar los lavados y llevar el seguimiento del taller: cuántos autos se lavan, quién registró cada uno, los
ingresos y qué hay que reponer. Tiene dos partes: la **API** (`backend/`, el backend del sistema de MgDetailing
adaptado a Buddys) y el **panel web** (`frontend/`, Vite + React), que se usa desde el celular y llama a la API por
`/api`. En producción los dos van juntos en un solo servicio de Render (`render.yaml`): la API sirve también el panel
compilado. Cómo publicarlo y cómo cargar o borrar los datos de ejemplo para una demo:
[backend/README.md, "Despliegue"](backend/README.md#despliegue).

## Qué hace

- **Registrar lavado** (`POST /api/admin/lavados`): servicios, vehículo, cuánto se cobró y cómo pagó. Queda registrado
  a nombre de quien lo carga; si no se indica, la fecha es hoy y el cliente queda como "Cliente de mostrador".
- **Planilla del día** (`GET /api/admin/lavados`): los lavados del día, quién registró cada uno, el total cobrado y la
  caja por forma de pago. Sin ranking: el sistema no compara a las personas.
- **Estadísticas** (`GET /api/admin/estadisticas`): ingresos, gastos, ganancia y servicios más pedidos por día, mes o
  año; cada uno ve además sus propios trabajos (`/estadisticas/mias`, sin importes).
- **Finanzas**: gastos y metas del mes. **Inventario** de insumos. **Presupuestos y comprobantes** en PDF.
- **Usuarios y roles** (`superadmin`, `admin`, `empleado`) con Supabase Auth. El empleado registra lavados a su
  nombre y no ve importes.
- Turnos y agenda (de MgDetailing). Las rutas **públicas** para pedir turno quedan apagadas (`TURNOS_ONLINE=false`).

Todos los endpoints, con ejemplos `curl`, están en [backend/README.md](backend/README.md).

## Estructura

| Carpeta | Qué es |
|---|---|
| `backend/` | La API: Node 24 + TypeScript + Express 5, Postgres en Supabase (esquema `buddys`) y Supabase Auth. |
| `backend/supabase/migrations/` | Las migraciones de la base, en orden. |
| `backend/test/fixtures/respuestas-api.json` | Respuestas reales de la API: el contrato que usa el frontend. |
| `frontend/` | El panel web: Vite + React + TypeScript estricto. Llama a `/api` relativo (en desarrollo, por el proxy de Vite a `localhost:4000`). |
| `reportes/` | Informes del proyecto. |

## Uso

```bash
npm run instalar
```

```bash
npm run dev
npm run dev:front
```

La API queda en `http://localhost:4000` (salud: `http://localhost:4000/api/health`) y el panel en
`http://localhost:5173`. La API necesita `backend/.env` con la conexión a Supabase: ver
[backend/README.md](backend/README.md#conectar-supabase).

| Script | Qué hace |
|---|---|
| `npm run instalar` | Instala las dependencias del backend y del frontend. |
| `npm run instalar:front` | Instala solo las del frontend. |
| `npm run dev` | La API en desarrollo, con recarga automática. |
| `npm run dev:front` | El panel en desarrollo (Vite, `http://localhost:5173`, con proxy de `/api` a la API). |
| `npm run build` / `npm start` | Compila y arranca la API compilada. |
| `npm run build:front` | Compila el panel (`frontend/dist`). |
| `npm test` | Tests del backend (Postgres en memoria con PGlite: no tocan Supabase). |
| `npm run test:front` | Tests del frontend. |
| `npm run verificar` | Tipos, lint y tests del backend. |
| `npm run verificar:front` | Tipos, lint, tests y build del frontend. |

## Pendientes para salir

Ver [reportes/2026-11-11_01_puesta-en-marcha.md](reportes/2026-11-11_01_puesta-en-marcha.md).
