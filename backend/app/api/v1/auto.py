"""Modo automático del agente: el consultor describe QUÉ investigar e
insertar, y la misión entra en una cola de fondo (ver jobs/auto_worker)."""
from __future__ import annotations

from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.database import get_db
from ...jobs.auto_worker import signal_auto_queue
from ...models.auto_mission import AutoMission
from ...models.document import Document
from ...services.audit_service import log_action
from ..deps import ProjectAccess, client_ip, require_project_read, require_project_write

router = APIRouter(prefix="/projects/{project_id}/agent/auto", tags=["auto"])

ACTIVE = ("pending", "running", "cancelling")


class MissionCreate(BaseModel):
    brief: str = Field(min_length=20, max_length=4000)


def _out(m: AutoMission) -> dict:
    return {
        "id": m.id, "status": m.status, "brief": m.brief,
        "steps": m.steps or [], "current_step": m.current_step,
        "result": m.result, "last_error": m.last_error,
        "requested_by": m.requested_by, "requested_by_name": m.requested_by_name,
        "created_at": m.created_at, "started_at": m.started_at,
        "finished_at": m.finished_at,
    }


@router.get("")
async def list_missions(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    rows = (await db.execute(
        select(AutoMission).where(AutoMission.project_id == project_id)
        .order_by(AutoMission.created_at.desc()).limit(10)
    )).scalars().all()
    return [_out(m) for m in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_mission(
    project_id: str,
    payload: MissionCreate,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not settings.openai_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "IA no configurada en el servidor")

    active = (await db.execute(
        select(AutoMission).where(
            AutoMission.project_id == project_id, AutoMission.status.in_(ACTIVE)
        )
    )).scalar_one_or_none()
    if active:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Ya hay una investigación automática en cola o en curso en este proyecto",
        )

    # Si un humano está editando AHORA, mejor avisar antes de encolar
    doc = (await db.execute(
        select(Document).where(Document.project_id == project_id)
    )).scalar_one_or_none()
    if doc and doc.lock_user_id and doc.lock_expires_at and doc.lock_user_id != access.user.id:
        expires = doc.lock_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        from datetime import datetime as _dt

        if expires > _dt.now(timezone.utc) and not str(doc.lock_user_id).startswith("auto:"):
            raise HTTPException(
                status.HTTP_423_LOCKED,
                f"{doc.lock_user_name or 'Otro usuario'} está editando el documento. "
                "Esperá a que termine para lanzar el modo automático.",
            )

    mission = AutoMission(
        project_id=project_id,
        brief=payload.brief.strip(),
        requested_by=access.user.id,
        requested_by_name=access.user.full_name,
    )
    db.add(mission)
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="agent.auto", project_id=project_id, entity_type="auto_mission",
        entity_id=mission.id, detail={"brief": payload.brief[:200]}, ip=client_ip(request),
    )
    await db.refresh(mission)
    signal_auto_queue()
    return _out(mission)


@router.post("/{mission_id}/cancel")
async def cancel_mission(
    project_id: str,
    mission_id: str,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    mission = await db.get(AutoMission, mission_id)
    if not mission or mission.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Misión no encontrada")
    if mission.requested_by != access.user.id and access.permission != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo quien la pidió (o un admin) puede cancelar")
    if mission.status == "pending":
        mission.status = "cancelled"
        mission.last_error = None
        await db.commit()
    elif mission.status == "running":
        mission.status = "cancelling"  # el worker corta entre tareas
        await db.commit()
    return _out(mission)
