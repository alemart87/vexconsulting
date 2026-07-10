"""Fragmentos indexados de las fuentes (RAG).

El tipo VECTOR lo entiende Postgres con la extensión pgvector; SQLite (dev)
acepta cualquier nombre de tipo, por lo que create_all no falla — las
operaciones vectoriales simplemente no están disponibles en dev sin Postgres.
La columna tsvector se agrega por migración idempotente solo en Postgres.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from ..core.config import settings

try:
    from pgvector.sqlalchemy import Vector

    _EMBEDDING_TYPE = Vector(settings.embedding_dimensions)
except Exception:  # pragma: no cover - pgvector no instalado
    _EMBEDDING_TYPE = JSON


def _uuid() -> str:
    return str(uuid.uuid4())


class SourceChunk(Base):
    __tablename__ = "source_chunks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    source_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(String(36), index=True)  # denormalizado para RAG
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    embedding = mapped_column(_EMBEDDING_TYPE, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {page, sheet, section}
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
