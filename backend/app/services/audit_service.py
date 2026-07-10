"""Registro de auditoría. Toda acción relevante pasa por log_action()."""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from ..models.audit import AuditLog


async def log_action(
    db: AsyncSession,
    *,
    user_id: str,
    action: str,
    user_email: Optional[str] = None,
    user_role: Optional[str] = None,
    project_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    detail: Optional[dict[str, Any]] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    commit: bool = True,
) -> None:
    entry = AuditLog(
        user_id=user_id,
        user_email=user_email,
        user_role=user_role,
        action=action,
        project_id=project_id,
        entity_type=entity_type,
        entity_id=entity_id,
        detail=detail,
        ip=ip,
        user_agent=(user_agent or "")[:300] or None,
    )
    db.add(entry)
    if commit:
        await db.commit()
