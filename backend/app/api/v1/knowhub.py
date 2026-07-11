"""KnowHub: artefactos de comprensión del proyecto (audio, mapa, briefing, FAQ).

Las generaciones corren en segundo plano (sobreviven a la navegación), avisan
al equipo por la campana al terminar y registran su costo para Costos IA.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db, session_scope
from ...models.knowhub import KNOWHUB_KINDS, KnowHubItem
from ...services.audit_service import log_action
from ...services.knowhub_service import GENERATORS
from ...services.notification_service import notify, project_member_ids
from ..deps import ProjectAccess, client_ip, require_project_read, require_project_write

logger = logging.getLogger("vexconsulting")

router = APIRouter(tags=["knowhub"])

KIND_LABELS = {
    "audio": "🎧 Resumen de audio",
    "mindmap": "🧠 Mapa mental",
    "briefing": "📋 Briefing ejecutivo",
    "faq": "❓ Preguntas frecuentes",
}


def _out(item: KnowHubItem) -> dict:
    return {
        "id": item.id, "kind": item.kind, "status": item.status,
        "title": item.title, "content_md": item.content_md,
        "duration_seconds": item.duration_seconds, "error": item.error,
        "cost_usd": item.cost_usd, "version": item.version,
        "created_by_name": item.created_by_name,
        "created_at": item.created_at, "finished_at": item.finished_at,
        "has_audio": bool(item.file_path),
    }


@router.get("/projects/{project_id}/knowhub")
async def list_items(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    rows = (await db.execute(
        select(KnowHubItem).where(KnowHubItem.project_id == project_id)
        .order_by(KnowHubItem.created_at.desc()).limit(60)
    )).scalars().all()
    return [_out(i) for i in rows]


async def _generate_job(item_id: str, kind: str, project_id: str,
                        project_name: str, description: str | None,
                        user_info: dict) -> None:
    error: str | None = None
    result: dict = {}
    try:
        async with session_scope() as db:
            result = await GENERATORS[kind](db, project_id, project_name, description)
    except Exception as exc:  # noqa: BLE001
        logger.exception("KnowHub %s falló en proyecto %s", kind, project_id[:8])
        error = str(exc)[:400]

    async with session_scope() as db:
        item = await db.get(KnowHubItem, item_id)
        if not item:
            return
        if error:
            item.status = "failed"
            item.error = error
        else:
            item.status = "done"
            item.title = result.get("title")
            item.content_md = result.get("content_md")
            item.file_path = result.get("file_path")
            item.duration_seconds = result.get("duration_seconds")
            item.cost_usd = result.get("cost_usd")
        item.finished_at = datetime.now(timezone.utc)

        if not error:
            # Aviso a todo el equipo (menos quien lo generó)
            from ...models.project import Project

            project = await db.get(Project, project_id)
            if project:
                members = await project_member_ids(db, project)
                await notify(
                    db, recipients=members - {user_info["id"]},
                    project_id=project_id, kind="nota",
                    title=f"{KIND_LABELS.get(kind, kind)} nuevo en KnowHub · {project_name}",
                    body=f"{user_info.get('name')}: {result.get('title') or ''}",
                    link=f"/projects/{project_id}/knowhub",
                    entity_id=item.id, actor_name=user_info.get("name"),
                    dedupe=False,
                )
        await log_action(
            db, user_id=user_info["id"], user_email=user_info.get("email"),
            user_role=user_info.get("role"), action="knowhub.generate",
            project_id=project_id, entity_type="knowhub", entity_id=item_id,
            detail={"kind": kind, "status": "failed" if error else "done",
                    "cost_usd": result.get("cost_usd")},
            commit=False,
        )
        await db.commit()


@router.post("/projects/{project_id}/knowhub/{kind}", status_code=status.HTTP_201_CREATED)
async def generate(
    project_id: str,
    kind: str,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if kind not in KNOWHUB_KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Tipo inválido: {kind}")
    running = (await db.execute(
        select(KnowHubItem).where(
            KnowHubItem.project_id == project_id,
            KnowHubItem.kind == kind,
            KnowHubItem.status == "running",
        ).limit(1)
    )).scalar_one_or_none()
    if running:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya hay una generación en curso")

    last_version = (await db.execute(
        select(KnowHubItem.version).where(
            KnowHubItem.project_id == project_id, KnowHubItem.kind == kind
        ).order_by(KnowHubItem.version.desc()).limit(1)
    )).scalar_one_or_none() or 0

    item = KnowHubItem(
        project_id=project_id, kind=kind, status="running",
        version=last_version + 1,
        created_by=access.user.id, created_by_name=access.user.full_name,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)

    asyncio.create_task(_generate_job(
        item.id, kind, project_id, access.project.name,
        access.project.description,
        {"id": access.user.id, "name": access.user.full_name,
         "email": access.user.email, "role": access.user.role},
    ))
    return _out(item)


@router.delete("/projects/{project_id}/knowhub/{item_id}")
async def delete_item(
    project_id: str,
    item_id: str,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    item = await db.get(KnowHubItem, item_id)
    if not item or item.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artefacto no encontrado")
    if item.file_path:
        Path(item.file_path).unlink(missing_ok=True)
    await db.delete(item)
    await db.commit()
    return {"ok": True}


@router.get("/projects/{project_id}/knowhub/{item_id}/audio")
async def stream_audio(project_id: str, item_id: str, db: AsyncSession = Depends(get_db)) -> FileResponse:
    """El <audio> del navegador no envía el JWT: URL-capacidad (los ids UUID
    son inadivinables), mismo patrón que las imágenes del proyecto."""
    item = await db.get(KnowHubItem, item_id)
    if (not item or item.project_id != project_id or not item.file_path
            or not Path(item.file_path).exists()):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Audio no disponible")
    return FileResponse(
        item.file_path, media_type="audio/mpeg",
        filename=f"knowhub-{item.kind}-v{item.version}.mp3",
        content_disposition_type="inline",
        headers={"Cache-Control": "private, max-age=3600"},
    )
