"""Vex Meet: actas de reunión del proyecto (zona Vex Cowork).

Cada reunión guarda sus notas en markdown, los asistentes y las menciones a
personas, fuentes (archivos internos) y notas de seguimiento. Las reuniones
son mencionables desde el chat del equipo (@reunión) — la memoria de las
decisiones queda enlazada a la conversación.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), index=True)
    title: Mapped[str] = mapped_column(String(200))
    # Cuándo fue (o será) la reunión — distinto de created_at (cuándo se cargó)
    meeting_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)  # sala o link
    content_md: Mapped[str] = mapped_column(Text, default="")
    # [{"id","name"}] — quiénes participaron
    attendees: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # {"users":[{id,name}], "sources":[{id,title}], "notes":[{id,title}]}
    mentions: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[str] = mapped_column(String(36))
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
