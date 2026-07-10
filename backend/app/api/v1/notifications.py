"""Notificaciones del usuario (campana): listar no leídas y marcar leídas."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.notification import Notification
from ..deps import CurrentUser, get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _out(n: Notification) -> dict:
    return {
        "id": n.id, "kind": n.kind, "title": n.title, "body": n.body,
        "link": n.link, "project_id": n.project_id, "actor_name": n.actor_name,
        "count": n.count or 1, "created_at": n.created_at,
    }


@router.get("")
async def list_notifications(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """No leídas del usuario, más recientes primero (las leídas desaparecen)."""
    rows = await db.execute(
        select(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .order_by(Notification.created_at.desc())
        .limit(30)
    )
    items = rows.scalars().all()
    total = (
        await db.execute(
            select(func.count()).select_from(Notification).where(
                Notification.user_id == user.id, Notification.read_at.is_(None)
            )
        )
    ).scalar_one()
    return {"items": [_out(n) for n in items], "unread": int(total or 0)}


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    notif = await db.get(Notification, notification_id)
    if not notif or notif.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notificación no encontrada")
    if notif.read_at is None:
        notif.read_at = datetime.now(timezone.utc)
        await db.commit()
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return {"ok": True}
