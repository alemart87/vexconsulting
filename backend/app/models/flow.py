"""Vex Flows (zona Vex Cowork): flujogramas del proyecto.

Canvas de diseño de flujos (estilo Lucidchart) construido con React Flow.
El diagrama completo vive en `data` como JSON: {"nodes": [...], "edges": [...],
"viewport": {...}} — el frontend lo hidrata tal cual.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Flow(Base):
    __tablename__ = "flows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), index=True)
    name: Mapped[str] = mapped_column(String(200))
    # {"nodes": [...], "edges": [...], "viewport": {x,y,zoom}}
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[str] = mapped_column(String(36))
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
