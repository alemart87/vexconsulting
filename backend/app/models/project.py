"""Proyectos de investigación."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base

PROJECT_STATUSES = ("borrador", "publicado")


def _uuid() -> str:
    return str(uuid.uuid4())


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="borrador", index=True)
    template_slug: Mapped[str | None] = mapped_column(String(50), nullable=True)
    agent_role_slug: Mapped[str] = mapped_column(String(50), default="consultor_bpo")
    agent_instructions_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)
    owner_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Vínculo entre proyectos (ej.: material del curso → plan de capacitación)
    related_project_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    published_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
