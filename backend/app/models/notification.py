"""Notificaciones internas (campana de la barra superior).

Se generan al recibir mensajes de chat, menciones y notas nuevas en los
proyectos donde el usuario participa. Al marcarse como leídas desaparecen
de la campana (read_at). Los mensajes seguidos del mismo canal se agrupan
en una sola notificación (count).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base

NOTIFICATION_KINDS = ("chat", "mencion", "nota")


def _uuid() -> str:
    return str(uuid.uuid4())


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_unread", "user_id", "read_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True)  # destinatario
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    kind: Mapped[str] = mapped_column(String(20))  # chat | mencion | nota
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str | None] = mapped_column(String(500), nullable=True)
    link: Mapped[str | None] = mapped_column(String(300), nullable=True)  # ruta del frontend
    # 64 y no 36: admite ids compuestos (ej. «turno-<uuid>» del pedido de turno = 42).
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)  # canal/nota
    actor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    count: Mapped[int] = mapped_column(Integer, default=1)  # mensajes agrupados
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
