"""Chat interno del proyecto: canales por tema y mensajes directos."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class ChatChannel(Base):
    __tablename__ = "chat_channels"
    __table_args__ = (
        UniqueConstraint("project_id", "dm_key", name="uq_chat_dm"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(36), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="tema")  # tema | dm
    name: Mapped[str] = mapped_column(String(120))
    # DM: "uid_menor|uid_mayor" para deduplicar; NULL en temas.
    dm_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (Index("ix_chatmsg_channel_created", "channel_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    channel_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(String(36))
    user_name: Mapped[str] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text)
    # {"users": [{"id","name"}], "notes": [{"id","title"}]}
    mentions: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
