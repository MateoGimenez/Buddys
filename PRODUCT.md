# Product

<!-- impeccable:product-schema 1 -->

> Escrito por el agente de frontend a partir del pedido del dueño y del backend (sin ronda de preguntas: el agente
> corría sin canal para preguntar). Lo marcado como **[inferido]** hay que confirmarlo con Mateo.

## Platform

web

## Stack

Pedido explícito del dueño: `frontend/` con Vite + React + TypeScript estricto, sin framework de UI pesado, que consume
la API de `backend/` (Express + Postgres en Supabase) por el proxy `/api`.

## Users

- **Empleados del lavadero** (rol `empleado`): con el celular en la mano, en el lavadero, a veces con las manos mojadas o
  con guantes, al sol o bajo techo. Su trabajo: anotar cada auto que lavan en segundos. Nunca ven montos.
- **Dueño y encargados** (`admin`, `superadmin`): revisan la planilla del día, corrigen montos y quién lavó, miran
  ingresos y el ranking del equipo, ajustan precios y gestionan al equipo. Celular durante el día, escritorio a la noche
  **[inferido]**.

## Product Purpose

Panel interno de Buddys Wash Detail (lavadero y detailing de autos, Instagram @buddyswashdetail) para registrar cada
lavado con servicio, vehículo, monto y quién lo hizo, y que eso alimente la planilla del día, las estadísticas, las metas
y el ranking "quién lavó más". Éxito: que registrar un lavado lleve menos de 10 segundos y que al cierre del día los
números cierren.

## Positioning

No es un sistema de turnos ni una web pública: es la libreta del lavadero, llevada al celular, con el equipo compitiendo
sanamente por quién lava más.

## Operating Context

- Autos que llegan sin turno ("mostrador"): se registran como trabajo completado en el momento de cobrar.
- Turnos online apagados (`TURNOS_ONLINE=false`): no hay reservas ni web pública.
- Hora de Argentina (La Rioja) para "hoy"; montos en pesos enteros (`es-AR`).
- Vehículos: auto, camioneta, moto; cada servicio dice para cuáles se ofrece.

## Capabilities and Constraints

- Roles `empleado`, `admin`, `superadmin`; la API decide y `GET /api/admin/permisos` dice qué ve cada uno.
- El empleado solo registra lavados a su nombre y nunca recibe importes (la UI no deja huecos donde irían).
- Sesión en cookies HttpOnly (BFF); el navegador nunca ve tokens.
- También existen en la API: gastos, metas, inventario de insumos, presupuestos y comprobantes en PDF, agenda,
  disponibilidad, usuarios.

## Brand Commitments

- Nombre: **Buddys Wash Detail**. Logo en `backend/assets/logo.png` (el de los PDF).
- Textos en español rioplatense (vos, "elegí", "registrá"), claros y simples.
- Nada heredado de MgDetailing (ni nombres, ni colores, ni textos).

## Evidence on Hand

- Contrato de la API: `backend/README.md` y `backend/test/fixtures/respuestas-api.json`.
- No hay fotos, testimonios ni métricas reales: no se inventan.

## Product Principles

1. Registrar primero: lo más frecuente (anotar un lavado) está a un toque y se completa con el pulgar.
2. Lo que el rol no puede hacer, no aparece; lo que no ve, no deja un hueco.
3. Los números del día tienen que poder leerse de un vistazo, al sol.
4. Errores que dicen qué pasó y qué hacer, en el idioma del lavadero.

## Accessibility & Inclusion

Objetivos táctiles grandes (mínimo 44 px, uso con una mano y guantes), contraste alto para leer a pleno sol, WCAG 2.2 AA
**[inferido]**.
