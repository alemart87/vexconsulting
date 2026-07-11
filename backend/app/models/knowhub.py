"""KnowHub: artefactos de comprensión del proyecto (estilo NotebookLM).

Cada artefacto (resumen de audio, mapa mental, briefing, FAQ) se genera con IA
a partir del documento maestro y las fuentes, queda versionado y es visible
para todo el equipo del proyecto. El costo de cada generación se registra
para el tablero de Costos IA.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base

KNOWHUB_KINDS = ("audio", "mindmap", "briefing", "faq")


def _uuid() -> str:
    return str(uuid.uuid4())


class KnowHubItem(Base):
    __tablename__ = "knowhub_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # audio | mindmap | briefing | faq
    status: Mapped[str] = mapped_column(String(20), default="running")  # running | done | failed
    title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    content_md: Mapped[str | None] = mapped_column(Text, nullable=True)  # mapa/briefing/faq o guion del audio
    file_path: Mapped[str | None] = mapped_column(String(600), nullable=True)  # mp3 del audio
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str] = mapped_column(String(36))
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
