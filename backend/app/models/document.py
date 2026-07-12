"""Documento maestro (1:1 con proyecto). El contenido vigente se cachea acá;
la historia completa vive en document_versions."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    current_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    content_md: Mapped[str] = mapped_column(Text, default="")
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    # Lock blando de edición: TTL renovable; expirado = libre.
    # 64 y no 36: también guarda el id del agente automático («auto:<uuid>» = 41).
    lock_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lock_user_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lock_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Edición final APA (job de fondo): None | running | done | failed
    final_edit_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    final_edit_detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
