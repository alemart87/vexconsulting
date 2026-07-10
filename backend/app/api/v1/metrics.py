"""Métricas de aporte por consultor y métricas globales de la plataforma."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.audit import AuditLog
from ...models.conversation import Conversation, Message
from ...models.document_version import DocumentVersion
from ...models.note import Note
from ...models.project import Project
from ...models.source import Source
from ...models.user import User
from ..deps import CurrentUser, ProjectAccess, require_project_read, require_superadmin

router = APIRouter(tags=["metrics"])


@router.get("/projects/{project_id}/metrics")
async def project_metrics(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    # Aporte por autor sobre las versiones del documento
    versions = await db.execute(
        select(
            DocumentVersion.author_id,
            DocumentVersion.author_name,
            func.count(DocumentVersion.id).label("ediciones"),
            func.sum(DocumentVersion.words_added).label("palabras_agregadas"),
            func.sum(DocumentVersion.words_removed).label("palabras_quitadas"),
            func.max(DocumentVersion.created_at).label("ultima_edicion"),
        )
        .where(DocumentVersion.project_id == project_id)
        .group_by(DocumentVersion.author_id, DocumentVersion.author_name)
        .order_by(func.count(DocumentVersion.id).desc())
    )
    aportes = [
        {
            "author_id": r.author_id,
            "author_name": r.author_name,
            "ediciones": int(r.ediciones or 0),
            "palabras_agregadas": int(r.palabras_agregadas or 0),
            "palabras_quitadas": int(r.palabras_quitadas or 0),
            "ultima_edicion": r.ultima_edicion,
        }
        for r in versions
    ]

    sources = await db.execute(
        select(Source.uploaded_by_name, func.count(Source.id))
        .where(Source.project_id == project_id)
        .group_by(Source.uploaded_by_name)
    )
    fuentes_por_usuario = {name or "—": int(count) for name, count in sources}

    totals = {}
    totals["versiones"] = (await db.execute(
        select(func.count(DocumentVersion.id)).where(DocumentVersion.project_id == project_id)
    )).scalar_one()
    totals["fuentes"] = (await db.execute(
        select(func.count(Source.id)).where(Source.project_id == project_id)
    )).scalar_one()
    totals["notas"] = (await db.execute(
        select(func.count(Note.id)).where(Note.project_id == project_id)
    )).scalar_one()
    totals["consultas_ia"] = (await db.execute(
        select(func.count(Message.id))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Conversation.project_id == project_id, Message.role == "user")
    )).scalar_one()
    costo = (await db.execute(
        select(func.coalesce(func.sum(Message.cost_usd), 0))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Conversation.project_id == project_id)
    )).scalar_one()

    actividad = await db.execute(
        select(AuditLog.action, func.count(AuditLog.id))
        .where(AuditLog.project_id == project_id)
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc())
        .limit(15)
    )

    return {
        "aportes": aportes,
        "fuentes_por_usuario": fuentes_por_usuario,
        "totales": {k: int(v or 0) for k, v in totals.items()},
        "costo_ia_usd": float(costo or 0),
        "actividad": [{"action": a, "count": int(c)} for a, c in actividad],
    }


@router.get("/admin/metrics")
async def admin_metrics(
    _: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    out: dict = {}
    out["usuarios"] = (await db.execute(select(func.count(User.id)))).scalar_one()
    out["proyectos"] = (await db.execute(select(func.count(Project.id)))).scalar_one()
    out["versiones"] = (await db.execute(select(func.count(DocumentVersion.id)))).scalar_one()
    out["fuentes"] = (await db.execute(select(func.count(Source.id)))).scalar_one()
    out["mensajes_ia"] = (await db.execute(select(func.count(Message.id)))).scalar_one()
    costo = (await db.execute(select(func.coalesce(func.sum(Message.cost_usd), 0)))).scalar_one()
    out["costo_ia_usd"] = float(costo or 0)

    por_proyecto = await db.execute(
        select(Project.name, func.coalesce(func.sum(Message.cost_usd), 0))
        .join(Conversation, Conversation.project_id == Project.id)
        .join(Message, Message.conversation_id == Conversation.id)
        .group_by(Project.name)
        .order_by(func.sum(Message.cost_usd).desc())
        .limit(20)
    )
    out["costo_por_proyecto"] = [
        {"proyecto": name, "usd": float(usd or 0)} for name, usd in por_proyecto
    ]
    return {k: (int(v) if isinstance(v, (int,)) else v) for k, v in out.items()}
