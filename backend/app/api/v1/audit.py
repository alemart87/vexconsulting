"""Auditoría: global (superadmin) y por proyecto (líder/admin del proyecto)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.audit import AuditLog
from ..deps import CurrentUser, ProjectAccess, require_project_admin, require_superadmin

router = APIRouter(tags=["audit"])


def _row(entry: AuditLog) -> dict:
    return {
        "id": entry.id,
        "user_id": entry.user_id,
        "user_email": entry.user_email,
        "user_role": entry.user_role,
        "action": entry.action,
        "project_id": entry.project_id,
        "entity_type": entry.entity_type,
        "entity_id": entry.entity_id,
        "detail": entry.detail,
        "ip": entry.ip,
        "created_at": entry.created_at,
    }


@router.get("/admin/audit")
async def global_audit(
    action: Optional[str] = None,
    user_email: Optional[str] = None,
    limit: int = Query(default=200, le=1000),
    offset: int = 0,
    _: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    query = select(AuditLog).order_by(AuditLog.created_at.desc())
    if action:
        query = query.where(AuditLog.action == action)
    if user_email:
        query = query.where(AuditLog.user_email.ilike(f"%{user_email}%"))
    result = await db.execute(query.limit(limit).offset(offset))
    return [_row(e) for e in result.scalars().all()]


@router.get("/admin/logins")
async def login_log(
    limit: int = Query(default=200, le=1000),
    _: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.action.in_(["login", "login_failed"]))
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    )
    return [_row(e) for e in result.scalars().all()]


@router.get("/projects/{project_id}/audit")
async def project_audit(
    project_id: str,
    limit: int = Query(default=200, le=1000),
    access: ProjectAccess = Depends(require_project_admin),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.project_id == project_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    )
    return [_row(e) for e in result.scalars().all()]
