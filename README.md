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
| superadmin | solo en `.env` | todo: ver todos los proyectos, logs, crear líderes |
| consultor_lider | por superadmin | crear proyectos y consultores/visualizadores, asignar permisos, publicar, ver métricas y auditoría del proyecto |
| consultor | por líder o superadmin | trabajar en los proyectos asignados (read/write/admin) |
| visualizador | por líder | ver solo el documento PUBLICADO + chat restringido |

## Estructura

```
backend/app/{core,api,models,schemas,services,jobs}
frontend/src/{app,components,lib}
Dockerfile · start.sh · render.yaml
```

## Migraciones

Sin Alembic: `create_all` + auto-healing de columnas + sentencias idempotentes en el
lifespan (`backend/app/main.py`). Re-ejecutables con `POST /api/v1/admin/migrate`.
