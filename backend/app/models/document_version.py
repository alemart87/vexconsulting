"""Versiones inmutables del documento maestro."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (Index("ix_docver_doc_num", "document_id", "version_number"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(String(36), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    content_md: Mapped[str] = mapped_column(Text)
    diff_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Autor denormalizado: la versión sobrevive al borrado del usuario.
    # 64 y no 36: la autoría puede ser el agente automático («auto:<uuid>» = 41).
    author_id: Mapped[str] = mapped_column(String(64))
    author_name: Mapped[str] = mapped_column(String(255))
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    words_added: Mapped[int] = mapped_column(Integer, default=0)
    words_removed: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
