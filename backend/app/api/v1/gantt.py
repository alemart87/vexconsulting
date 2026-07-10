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
from ..deps import ProjectAccess, require_project_read, require_project_write

router = APIRouter(prefix="/projects/{project_id}/gantt", tags=["gantt"])


class TaskCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    phase: Optional[str] = None
    start_date: date
    end_date: date
    depends_on: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    phase: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    progress: Optional[int] = Field(default=None, ge=0, le=100)
    status: Optional[str] = None
    order_index: Optional[int] = None


def _out(t: GanttTask) -> dict:
    return {
        "id": t.id, "title": t.title, "phase": t.phase,
        "start_date": str(t.start_date), "end_date": str(t.end_date),
        "progress": t.progress, "status": t.status, "depends_on": t.depends_on,
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
    return [_out(t) for t in result.scalars().all()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_task(
    project_id: str,
    payload: TaskCreate,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if payload.end_date < payload.start_date:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fecha fin no puede ser anterior al inicio")
    task = GanttTask(
        project_id=project_id,
        title=payload.title.strip(),
        phase=payload.phase if payload.phase in GANTT_PHASES else None,
        start_date=payload.start_date,
        end_date=payload.end_date,
        depends_on=payload.depends_on,
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
    return {"draft": tareas}
