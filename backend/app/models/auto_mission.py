"""Misiones del modo automático: el agente investiga por su cuenta y lo
inserta en el documento maestro. Cola persistente en DB (sobrevive a
reinicios y no depende de conexiones HTTP abiertas — apto para Render)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base

AUTO_STATUSES = ("pending", "running", "cancelling", "done", "failed", "cancelled")


def _uuid() -> str:
    return str(uuid.uuid4())


class AutoMission(Base):
    __tablename__ = "auto_missions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), index=True)
    # Qué investigar e insertar, descrito por el consultor
    brief: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    # Plan de investigación: [{"titulo","consulta","seccion","status","resumen","citas"}]
    steps: Mapped[list | None] = mapped_column(JSON, nullable=True)
    current_step: Mapped[int] = mapped_column(Integer, default=0)
    # Resultado: {"version_number","tareas","palabras_agregadas","citas","cost_usd"}
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Hilo del investigador donde quedan los pasos (con tokens y costos)
    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Sub-etapa exacta en la que está el worker (visible en la UI) y latido:
    # si heartbeat_at queda viejo, el motor está muerto/colgado y se puede
    # forzar la cancelación desde el endpoint.
    stage_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requested_by: Mapped[str] = mapped_column(String(36))
    requested_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
