"""Notas de seguimiento (notas, hipótesis, hallazgos, tareas) con estados."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.note import NOTE_KINDS, NOTE_STATUSES, Note
from ...services.notification_service import notify, project_member_ids
from ..deps import ProjectAccess, require_project_read, require_project_write

router = APIRouter(prefix="/projects/{project_id}/notes", tags=["notes"])


class NoteCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    body_md: Optional[str] = None
    kind: str = "nota"
    assigned_to: Optional[str] = None


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=300)
    body_md: Optional[str] = None
    status: Optional[str] = None
    kind: Optional[str] = None
    assigned_to: Optional[str] = None


def _out(n: Note) -> dict:
    return {
        "id": n.id, "project_id": n.project_id, "title": n.title, "body_md": n.body_md,
        "status": n.status, "kind": n.kind, "created_by": n.created_by,
        "created_by_name": n.created_by_name, "created_by_agent": n.created_by_agent,
        "assigned_to": n.assigned_to, "created_at": n.created_at, "updated_at": n.updated_at,
    }


@router.get("")
async def list_notes(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    result = await db.execute(
        select(Note).where(Note.project_id == project_id).order_by(Note.created_at.desc())
    )
    return [_out(n) for n in result.scalars().all()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_note(
    project_id: str,
    payload: NoteCreate,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if payload.kind not in NOTE_KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"kind inválido: {payload.kind}")
    note = Note(
        project_id=project_id,
        title=payload.title.strip(),
        body_md=payload.body_md,
        kind=payload.kind,
        assigned_to=payload.assigned_to,
        created_by=access.user.id,
        created_by_name=access.user.full_name,
    )
    db.add(note)
    await db.flush()  # asigna note.id ANTES de armar el link de la notificación

    # Notificaciones: el asignado recibe aviso propio; el resto del equipo, uno general.
    kind_label = {"nota": "Nota", "hipotesis": "Hipótesis", "hallazgo": "Hallazgo", "tarea": "Tarea"}
    label = kind_label.get(note.kind, "Nota")
    link = f"/projects/{project_id}/notes?note={note.id}"
    members = await project_member_ids(db, access.project)
    assigned = {payload.assigned_to} if payload.assigned_to else set()
    if assigned - {access.user.id}:
        await notify(
            db, recipients=assigned - {access.user.id}, project_id=project_id,
            kind="mencion",
            title=f"{access.user.full_name} te asignó una {label.lower()} · {access.project.name}",
            body=note.title, link=link, entity_id=note.id, actor_name=access.user.full_name,
            dedupe=False,
        )
    await notify(
        db, recipients=members - {access.user.id} - assigned, project_id=project_id,
        kind="nota", title=f"{label} nueva · {access.project.name}",
        body=f"{access.user.full_name}: {note.title}", link=link, entity_id=note.id,
        actor_name=access.user.full_name, dedupe=False,
    )

    await db.commit()
    await db.refresh(note)
    return _out(note)


@router.patch("/{note_id}")
async def update_note(
    project_id: str,
    note_id: str,
    payload: NoteUpdate,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    note = await db.get(Note, note_id)
    if not note or note.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nota no encontrada")
    if payload.status and payload.status not in NOTE_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Estado inválido: {payload.status}")
    if payload.kind and payload.kind not in NOTE_KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"kind inválido: {payload.kind}")
    for field in ("title", "body_md", "status", "kind", "assigned_to"):
        value = getattr(payload, field)
        if value is not None:
            setattr(note, field, value)
    await db.commit()
    await db.refresh(note)
    return _out(note)


@router.delete("/{note_id}")
async def delete_note(
    project_id: str,
    note_id: str,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    note = await db.get(Note, note_id)
    if not note or note.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nota no encontrada")
    await db.delete(note)
    await db.commit()
    return {"ok": True}
