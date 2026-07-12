"""VEX Consulting — API principal.

Migraciones: create_all + auto-healing de columnas (information_schema) +
migraciones idempotentes (extensión pgvector, índices, tsvector). Sin Alembic,
igual que el proyecto de referencia. Todo re-ejecutable sin efectos duplicados.
"""
from __future__ import annotations

import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from . import models  # noqa: F401 — registra todos los modelos en Base.metadata
from .api.deps import CurrentUser, require_superadmin
from .api.v1 import audit as audit_router
from .api.v1 import auth as auth_router
from .api.v1 import documents as documents_router
from .api.v1 import members as members_router
from .api.v1 import projects as projects_router
from .api.v1 import users as users_router
from .api.v1 import versions as versions_router
from .core.config import settings
from .core.database import Base, engine
from .core.logging import configure_logging, logger

VECTOR_AVAILABLE = False

# Columnas que deben existir aunque la tabla se haya creado con un esquema viejo.
# (tabla, columna, tipo SQL) — se agregan con ALTER TABLE ... ADD COLUMN si faltan.
REQUIRED_COLUMNS: list[tuple[str, str, str]] = [
    ("projects", "agent_instructions_override", "TEXT"),
    ("projects", "owner_name", "VARCHAR(255)"),
    ("projects", "related_project_id", "VARCHAR(36)"),
    ("documents", "lock_user_name", "VARCHAR(255)"),
    ("documents", "final_edit_status", "VARCHAR(20)"),
    ("documents", "final_edit_detail", "JSON"),
    ("users", "must_change_password", "BOOLEAN DEFAULT FALSE"),
    ("users", "totp_secret", "VARCHAR(64)"),
    ("users", "totp_enabled", "BOOLEAN DEFAULT FALSE"),
    ("users", "token_version", "INTEGER DEFAULT 0"),
    ("chat_messages", "parent_id", "VARCHAR(36)"),
    ("chat_messages", "reactions", "JSON"),
    ("chat_messages", "edited_at", "TIMESTAMPTZ"),
    ("chat_messages", "deleted_at", "TIMESTAMPTZ"),
    ("chat_messages", "attachments", "JSON"),
    ("chat_messages", "pinned_at", "TIMESTAMPTZ"),
    ("chat_messages", "pinned_by", "VARCHAR(255)"),
    ("gantt_tasks", "assignees", "JSON"),
    ("gantt_tasks", "assigned_to", "VARCHAR(36)"),
    ("gantt_tasks", "assigned_name", "VARCHAR(255)"),
    ("sources", "embedding_cost_usd", "FLOAT"),
    ("conversations", "role_slug", "VARCHAR(50)"),
]

# Sentencias idempotentes que corren en cada arranque (solo Postgres).
MIGRATIONS_IDEMPOTENT: list[str] = [
    (
        "ALTER TABLE source_chunks ADD COLUMN IF NOT EXISTS tsv tsvector "
        "GENERATED ALWAYS AS (to_tsvector('spanish', content)) STORED"
    ),
    "CREATE INDEX IF NOT EXISTS ix_chunks_tsv ON source_chunks USING GIN (tsv)",
    (
        "CREATE INDEX IF NOT EXISTS ix_chunks_embedding ON source_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    ),
]


def _is_postgres() -> bool:
    return engine.url.get_backend_name().startswith("postgres")


async def _ensure_vector_extension() -> None:
    global VECTOR_AVAILABLE
    if not _is_postgres():
        logger.info("DB no-Postgres: búsqueda vectorial deshabilitada (modo dev)")
        return
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        VECTOR_AVAILABLE = True
        logger.info("Extensión pgvector disponible")
    except Exception as exc:  # pragma: no cover
        logger.warning("pgvector no disponible (%s); se degrada a búsqueda por texto", exc)


async def _ensure_required_columns() -> None:
    is_pg = _is_postgres()
    async with engine.begin() as conn:
        for table, column, sql_type in REQUIRED_COLUMNS:
            if is_pg:
                result = await conn.execute(
                    text(
                        "SELECT 1 FROM information_schema.columns "
                        "WHERE table_name=:t AND column_name=:c"
                    ),
                    {"t": table, "c": column},
                )
                missing = result.first() is None
            else:  # SQLite (dev): PRAGMA table_info
                result = await conn.execute(text(f"PRAGMA table_info({table})"))
                missing = column not in {row[1] for row in result.fetchall()}
            if missing:
                logger.info("Auto-healing: agregando %s.%s", table, column)
                await conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}")
                )


async def _run_idempotent_migrations() -> None:
    if not _is_postgres():
        return
    async with engine.begin() as conn:
        for statement in MIGRATIONS_IDEMPOTENT:
            try:
                await conn.execute(text(statement))
            except Exception as exc:
                # El índice HNSW falla si pgvector no está; no es fatal.
                logger.warning("Migración idempotente omitida: %s (%s)", statement[:60], exc)


async def run_migrations() -> None:
    await _ensure_vector_extension()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _ensure_required_columns()
    await _run_idempotent_migrations()


async def _recover_stale_final_edits() -> None:
    """Ediciones finales que quedaron 'running' tras un reinicio → failed."""
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "UPDATE documents SET final_edit_status='failed', "
                "final_edit_detail='{\"error\": \"Interrumpido por reinicio del servidor\"}' "
                "WHERE final_edit_status='running'"
            ))
    except Exception as exc:  # pragma: no cover
        logger.warning("No se pudieron recuperar ediciones finales: %s", exc)


def _security_startup_checks() -> None:
    """Fallos ruidosos ANTES de servir tráfico con configuración insegura."""
    if settings.env == "production":
        if not settings.secret_key or settings.secret_key == "change-me":
            raise RuntimeError(
                "SECRET_KEY sin configurar en producción: cualquiera podría "
                "forjar tokens. Definí SECRET_KEY en el entorno."
            )
        if settings.superadmin_password:
            logger.warning(
                "SUPERADMIN_PASSWORD en texto plano en producción — usá "
                "SUPERADMIN_PASSWORD_HASH (bcrypt)."
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    logger.info("VEX Consulting iniciando (env=%s)", settings.env)
    _security_startup_checks()
    await run_migrations()
    await _recover_stale_final_edits()
    settings.upload_path  # crea el directorio
    settings.export_path

    workers: list = []
    with contextlib.suppress(ImportError):
        from .jobs.runner import start_workers

        workers = await start_workers()

    yield

    for w in workers:
        w.cancel()
    logger.info("VEX Consulting detenido")


app = FastAPI(
    title="VEX Consulting API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.env != "production" else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in settings.cors_origins_list if o != "*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response

API = "/api/v1"
app.include_router(auth_router.router, prefix=API)
app.include_router(users_router.router, prefix=API)
app.include_router(projects_router.router, prefix=API)
app.include_router(members_router.router, prefix=API)
app.include_router(documents_router.router, prefix=API)
app.include_router(versions_router.router, prefix=API)
app.include_router(audit_router.router, prefix=API)

# Routers de fases 2-4 se montan si existen (import tolerante durante el desarrollo)
for module_name in ("sources", "search", "notes", "gantt", "agent", "evaluations", "exports", "metrics", "files", "chat", "notifications", "knowhub"):
    try:
        module = __import__(f"app.api.v1.{module_name}", fromlist=["router"])
        app.include_router(module.router, prefix=API)
    except ImportError:
        logging.getLogger("vexconsulting").debug("Router %s aún no disponible", module_name)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "vector": VECTOR_AVAILABLE}


@app.post(f"{API}/admin/migrate")
async def migrate(_: CurrentUser = Depends(require_superadmin)) -> dict:
    await run_migrations()
    return {"ok": True, "vector": VECTOR_AVAILABLE}
