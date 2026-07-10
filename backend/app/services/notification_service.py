"""Creación de notificaciones internas (campana de la barra superior).

Las funciones agregan filas a la sesión SIN commitear: el endpoint que
genera el evento (mensaje, nota) hace su commit habitual y arrastra las
notificaciones en la misma transacción.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.notification import Notification
from ..models.project import Project
from ..models.project_member import ProjectMember


async def project_member_ids(db: AsyncSession, project: Project) -> set[str]:
    """Miembros del proyecto + dueño (incluye al superadmin sintético)."""
    rows = await db.execute(
        select(ProjectMember.user_id).where(ProjectMember.project_id == project.id)
    )
    ids = {uid for (uid,) in rows}
    if project.owner_id:
        ids.add(project.owner_id)
    return ids


async def notify(
    db: AsyncSession,
    *,
    recipients: set[str] | list[str],
    project_id: str | None,
    kind: str,
    title: str,
    body: str | None,
    link: str | None,
    entity_id: str | None,
    actor_name: str | None,
    dedupe: bool = True,
) -> None:
    """Crea una notificación por destinatario. Si dedupe y ya existe una NO
    leída del mismo tipo y entidad, la agrupa (count += 1, texto renovado)."""
    for user_id in {r for r in recipients if r}:
        existing = None
        if dedupe and entity_id:
            existing = (
                await db.execute(
                    select(Notification)
                    .where(
                        Notification.user_id == user_id,
                        Notification.kind == kind,
                        Notification.entity_id == entity_id,
                        Notification.read_at.is_(None),
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
        if existing:
            existing.count = (existing.count or 1) + 1
            existing.title = title
            existing.body = body
            existing.actor_name = actor_name
            existing.created_at = datetime.now(timezone.utc)
        else:
            db.add(
                Notification(
                    user_id=user_id,
                    project_id=project_id,
                    kind=kind,
                    title=title[:300],
                    body=(body or "")[:500] or None,
                    link=link,
                    entity_id=entity_id,
                    actor_name=actor_name,
                )
            )
