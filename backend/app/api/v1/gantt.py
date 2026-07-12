"""Gantt de seguimiento del proyecto, con generación asistida por IA."""
from __future__ import annotations

import json
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.database import get_db
from ...models.document import Document
from ...models.gantt_task import GANTT_PHASES, GanttTask
from ...models.note import Note
from ...models.user import User
from ..deps import ProjectAccess, require_project_read, require_project_write

router = APIRouter(prefix="/projects/{project_id}/gantt", tags=["gantt"])


class TaskCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    phase: Optional[str] = None
    start_date: date
    end_date: date
    depends_on: Optional[str] = None
    assignees: Optional[list[str]] = None  # ids de responsables (varios)


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    phase: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    progress: Optional[int] = Field(default=None, ge=0, le=100)
    status: Optional[str] = None
    order_index: Optional[int] = None
    # [] desasigna a todos; None significa «no tocar»
    assignees: Optional[list[str]] = None


async def _resolve_assignees(db: AsyncSession, ids: list[str] | None) -> list[dict]:
    """Valida y resuelve [{id, name}] de los responsables (máx. 10, sin duplicados)."""
    out: list[dict] = []
    seen: set[str] = set()
    for user_id in (ids or [])[:10]:
        if not user_id or user_id in seen:
            continue
        seen.add(user_id)
        if user_id == "superadmin":
            out.append({"id": "superadmin", "name": "Superadmin"})
            continue
        user = await db.get(User, user_id)
        if not user:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Un responsable no existe")
        out.append({"id": user.id, "name": user.full_name})
    return out


def _task_assignees(t: GanttTask) -> list[dict]:
    if t.assignees:
        return t.assignees
    if t.assigned_to:  # dato legado de responsable único
        return [{"id": t.assigned_to, "name": t.assigned_name or "?"}]
    return []


def _out(t: GanttTask, photos: dict | None = None) -> dict:
    assignees = [
        {**a, "photo_url": (photos or {}).get(a.get("id"))} for a in _task_assignees(t)
    ]
    return {
        "id": t.id, "title": t.title, "phase": t.phase,
        "start_date": str(t.start_date), "end_date": str(t.end_date),
        "progress": t.progress, "status": t.status, "depends_on": t.depends_on,
        "assignees": assignees,
        "order_index": t.order_index, "generated_by_ai": t.generated_by_ai,
    }


@router.get("")
async def list_tasks(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    result = await db.execute(
        select(GanttTask).where(GanttTask.project_id == project_id)
        .order_by(GanttTask.order_index, GanttTask.start_date)
    )
    photos = {
        uid: url for uid, url in await db.execute(select(User.id, User.photo_url)) if url
    }
    return [_out(t, photos) for t in result.scalars().all()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_task(
    project_id: str,
    payload: TaskCreate,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if payload.end_date < payload.start_date:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fecha fin no puede ser anterior al inicio")
    assignees = await _resolve_assignees(db, payload.assignees)
    task = GanttTask(
        project_id=project_id,
        title=payload.title.strip(),
        phase=payload.phase if payload.phase in GANTT_PHASES else None,
        start_date=payload.start_date,
        end_date=payload.end_date,
        depends_on=payload.depends_on,
        assignees=assignees or None,
        created_by=access.user.id,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return _out(task)


@router.patch("/{task_id}")
async def update_task(
    project_id: str,
    task_id: str,
    payload: TaskUpdate,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    task = await db.get(GanttTask, task_id)
    if not task or task.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tarea no encontrada")
    for field in ("title", "phase", "start_date", "end_date", "progress", "status", "order_index"):
        value = getattr(payload, field)
        if value is not None:
            setattr(task, field, value)
    if task.end_date < task.start_date:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fecha fin no puede ser anterior al inicio")
    if payload.assignees is not None:  # [] desasigna a todos
        task.assignees = await _resolve_assignees(db, payload.assignees) or None
        task.assigned_to = None  # el campo legado deja de mandar
        task.assigned_name = None
    await db.commit()
    await db.refresh(task)
    return _out(task)


@router.delete("/{task_id}")
async def delete_task(
    project_id: str,
    task_id: str,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    task = await db.get(GanttTask, task_id)
    if not task or task.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tarea no encontrada")
    await db.delete(task)
    await db.commit()
    return {"ok": True}


@router.post("/generate")
async def generate_tasks(
    project_id: str,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """La IA propone un cronograma a partir del documento y las notas.
    Devuelve un BORRADOR: el consultor confirma cada tarea antes de crearla."""
    if not settings.openai_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "IA no configurada en el servidor")

    doc_result = await db.execute(select(Document).where(Document.project_id == project_id))
    doc = doc_result.scalar_one_or_none()
    notes_result = await db.execute(
        select(Note).where(Note.project_id == project_id).limit(30)
    )
    notes = notes_result.scalars().all()

    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    context = (
        f"Documento (primeros 6000 chars):\n{(doc.content_md if doc else '')[:6000]}\n\n"
        f"Notas: {[f'{n.kind}: {n.title} [{n.status}]' for n in notes]}\n"
        f"Hoy es {date.today().isoformat()}."
    )
    resp = await client.chat.completions.create(
        model=settings.agent_model,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": "Sos un gestor de proyectos de investigación de mercado. "
                "Proponé un cronograma realista con método científico (fases: hipotesis, "
                "fuentes, evidencia, sintesis, evaluacion). Respondé SOLO JSON: "
                '{"tareas":[{"title":str,"phase":str,"start_date":"YYYY-MM-DD",'
                '"end_date":"YYYY-MM-DD"}]} (6 a 12 tareas).',
            },
            {"role": "user", "content": context},
        ],
    )
    try:
        data = json.loads(resp.choices[0].message.content or "{}")
        tareas = data.get("tareas", [])
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "La IA no devolvió un cronograma válido")

    # Costo registrado para Costos IA (bloque de auditoría)
    try:
        from ...services.agent.pricing import compute_cost_usd
        from ...services.audit_service import log_action

        usage = getattr(resp, "usage", None)
        cached = int(getattr(getattr(usage, "prompt_tokens_details", None), "cached_tokens", 0) or 0)
        cost = compute_cost_usd(
            int(getattr(usage, "prompt_tokens", 0) or 0),
            int(getattr(usage, "completion_tokens", 0) or 0),
            cached,
        )
        await log_action(
            db, user_id=access.user.id, user_email=access.user.email,
            user_role=access.user.role, action="gantt.generate",
            project_id=project_id, entity_type="gantt", entity_id=project_id,
            detail={"tareas": len(tareas), "cost_usd": round(cost, 4)},
        )
    except Exception:
        pass
    return {"draft": tareas}
