# VEX Consulting

Plataforma colaborativa de investigación de mercado de Voicenter S.A.: proyectos con
documento maestro versionado, fuentes con RAG, agentes de IA (acompañante, evaluador,
investigación profunda y visualizador), jerarquía de usuarios y auditoría total.

## Stack

- **Backend**: FastAPI (async) + SQLAlchemy 2.0 + PostgreSQL (pgvector). SQLite en dev.
- **Frontend**: Next.js 14 (App Router) + Tailwind + TipTap.
- **IA**: OpenAI Agents SDK (agentes con tools y SSE) + embeddings; Perplexity opcional.
- **Deploy**: un solo servicio Docker en Render (Next proxya `/api/*` al FastAPI interno).

## Desarrollo local

```bash
# Backend (puerto 8000) — usa SQLite si no hay DATABASE_URL
cp .env.example .env   # completar SUPERADMIN_* y OPENAI_API_KEY
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (puerto 3000, proxya /api al backend)
cd frontend
npm install
npm run dev
```

Ingresar en `http://localhost:3000` con las credenciales del superadmin del `.env`.

## Jerarquía de usuarios

| Rol | Se crea | Puede |
|---|---|---|
| superadmin | solo en `.env` | todo: ver todos los proyectos, logs, crear líderes y gerentes; acceso a VEXFINANZAS |
| consultor_lider | por superadmin | crear proyectos y consultores/visualizadores, asignar permisos, publicar, ver métricas y auditoría del proyecto |
| consultor | por líder o superadmin | trabajar en los proyectos asignados (read/write/admin) |
| visualizador | por líder | ver solo el documento PUBLICADO + chat restringido |
| gerente_operaciones | solo por superadmin | módulo VEXFINANZAS únicamente (no entra a la consultoría) |

**Cambio de rol y permisos especiales (solo superadmin).** Desde Usuarios el
superadmin cambia el rol de cualquier usuario (p. ej. consultor → gerente) y otorga
módulos extra guardados en `users.extra_modules`: `consultorias` (un gerente entra a
VexConsultorías y puede ser miembro de proyectos) o `finanzas` (un consultor o líder
entra a VEXFINANZAS). Los líderes no pueden otorgarlos. El cambio rige en el próximo
request: la API lee rol y módulos de la base en cada llamada.

## Seguridad: doble factor obligatorio

Todas las cuentas de la base deben activar TOTP (Google Authenticator, 1Password,
Authy). Hasta escanear el QR en «Mi perfil», la API bloquea todo salvo autenticación
(`403 2fa_setup_required`) y el frontend redirige a `/perfil?2fa=obligatorio`. No se
puede desactivar. Se controla con `REQUIRE_2FA` (default `true`).

El superadmin vive en `.env`: su segundo factor es `SUPERADMIN_TOTP_SECRET` (base32,
generar con `python -c "import pyotp; print(pyotp.random_base32())"` y cargar a mano
en la app de autenticación). Si está vacío, ingresa solo con contraseña y el arranque
lo advierte en el log.

## VEXFINANZAS — Análisis de centros de costos

Módulo independiente de la consultoría (`/finanzas`), para superadmin y gerentes de
operaciones. Cada gerente administra sus **sesiones de trabajo**; el superadmin ve todas.

1. Crear sesión (nombre por defecto = mes analizado, editable).
2. Subir los Excel de asientos «A cruzar» (mensualeros, operaciones, egresos,
   complementos). Se valida al subir: hoja «Horas», 14 columnas del export contable.
3. **Ejecutar VeXFinanzas**: job de fondo (`jobs/finance_worker.py`) que cruza a los
   colaboradores por **Funcod** (el nombre es solo etiqueta; los códigos sucios como
   `-5440329--` se limpian y se marcan), clasifica cuentas (5 = gasto, 2 = pasivo,
   1 = descuento al personal), centros de costo y puestos, y guarda:
   - `finance_entries`: cada línea de asiento normalizada,
   - `finance_collaborators`: un registro por Funcod (mensualero / jornalero / egreso),
   - `finance_sessions.summary`: el resumen gerencial (totales, dotación, gasto por
     centro, cliente, concepto y puesto, avisos de cruce).
4. Vistas: Resumen gerencial, Cuentas (clic → movimientos por centro y colaborador),
   Centros de costo, Colaboradores (búsqueda y filtros) y Notas (CRUD, vinculables a
   una cuenta, centro o colaborador). Todo queda en auditoría.

Reglas del cruce documentadas en `backend/app/services/finance_service.py`.

## Estructura

```
backend/app/{core,api,models,schemas,services,jobs}
  services/finance_service.py · api/v1/finanzas.py · jobs/finance_worker.py · models/finance.py
frontend/src/{app,components,lib}
  app/finanzas/** · components/finanzas/ · lib/finanzas.ts
Dockerfile · start.sh · render.yaml
```

## Migraciones

Sin Alembic: `create_all` + auto-healing de columnas + sentencias idempotentes en el
lifespan (`backend/app/main.py`). Re-ejecutables con `POST /api/v1/admin/migrate`.
