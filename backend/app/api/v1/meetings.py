"""Vex Meet (zona Vex Cowork): actas de reunión del proyecto.

El consultor registra la reunión con sus notas, asistentes y menciones a
personas (@), fuentes internas (archivos) y notas de seguimiento. Los
mencionados y asistentes reciben campana, y la reunión queda mencionable
desde el chat del equipo.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.meeting import Meeting
from ...models.note import Note
from ...models.project_member import ProjectMember
from ...models.source import Source
from ...models.user import User
from ...services.audit_service import log_action
from ...services.notification_service import notify
from ..deps import ProjectAccess, client_ip, require_project_read

router = APIRouter(prefix="/projects/{project_id}/meetings", tags=["meetings"])


def _require_meet_access(access: ProjectAccess) -> None:
    if access.user.is_visualizador:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Los visualizadores no acceden a Vex Meet")


class MeetingCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    meeting_date: datetime
    location: Optional[str] = Field(default=None, max_length=200)
    content_md: str = Field(default="", max_length=60000)
    attendees: Optional[list[dict]] = None  # [{"id","name"}]
    mentions: Optional[dict] = None  # {"users":[], "sources":[], "notes":[]}


class MeetingUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=200)
    meeting_date: Optional[datetime] = None
    location: Optional[str] = Field(default=None, max_length=200)
    content_md: Optional[str] = Field(default=None, max_length=60000)
    attendees: Optional[list[dict]] = None
    mentions: Optional[dict] = None


def _clean_people(items: list[dict] | None) -> list[dict]:
    out = []
    for it in items or []:
        if isinstance(it, dict) and it.get("id"):
            out.append({"id": str(it["id"])[:36], "name": str(it.get("name") or "")[:255]})
    return out[:40]


def _clean_mentions(m: dict | None) -> dict:
    m = m or {}
    out: dict = {}
    out["users"] = _clean_people(m.get("users"))
    for key in ("sources", "notes"):
        items = []
        for it in m.get(key) or []:
            if isinstance(it, dict) and it.get("id"):
                items.append({"id": str(it["id"])[:36], "title": str(it.get("title") or "")[:300]})
        out[key] = items[:40]
    return out


def _out(m: Meeting) -> dict:
    return {
        "id": m.id, "title": m.title, "meeting_date": m.meeting_date,
        "location": m.location, "content_md": m.content_md,
        "attendees": m.attendees or [], "mentions": m.mentions or {},
        "created_by": m.created_by, "created_by_name": m.created_by_name,
        "created_at": m.created_at, "updated_at": m.updated_at,
    }


def _summary(m: Meeting) -> dict:
    from ...services.document_service import count_words

    text = (m.content_md or "").strip().replace("#", "").replace("*", "")
    return {
        "id": m.id, "title": m.title, "meeting_date": m.meeting_date,
        "location": m.location,
        "attendees": m.attendees or [],
        "excerpt": text[:180],
        "words": count_words(m.content_md or ""),
        "created_by": m.created_by, "created_by_name": m.created_by_name,
        "updated_at": m.updated_at,
    }


@router.get("")
async def list_meetings(
    project_id: str,
    q: Optional[str] = Query(default=None, max_length=100),
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    _require_meet_access(access)
    query = select(Meeting).where(Meeting.project_id == project_id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.where(Meeting.title.ilike(like) | Meeting.content_md.ilike(like))
    rows = (await db.execute(query.order_by(Meeting.meeting_date.desc()).limit(200))).scalars().all()
    return [_summary(m) for m in rows]


@router.get("/mentionables")
async def meet_mentionables(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Qué se puede citar con @ en las notas de reunión: personas del equipo,
    fuentes internas (archivos/documentos cargados) y notas de seguimiento."""
    _require_meet_access(access)
    members_rows = await db.execute(
        select(User.id, User.full_name)
        .join(ProjectMember, ProjectMember.user_id == User.id)
        .where(ProjectMember.project_id == project_id, User.is_active.is_(True))
    )
    users = [{"id": uid, "name": name} for uid, name in members_rows]
    owner_id = access.project.owner_id
    if owner_id and owner_id != "superadmin" and owner_id not in {u["id"] for u in users}:
        owner = await db.get(User, owner_id)
        if owner:
            users.append({"id": owner.id, "name": owner.full_name})

    sources_rows = await db.execute(
        select(Source.id, Source.title, Source.kind)
        .where(Source.project_id == project_id)
        .order_by(Source.created_at.desc()).limit(80)
    )
    sources = [{"id": sid, "title": title, "kind": kind} for sid, title, kind in sources_rows]

    notes_rows = await db.execute(
        select(Note.id, Note.title, Note.status)
        .where(Note.project_id == project_id)
        .order_by(Note.updated_at.desc()).limit(50)
    )
    notes = [{"id": nid, "title": title, "status": st} for nid, title, st in notes_rows]
    return {"users": users, "sources": sources, "notes": notes}


async def _notify_meeting(db, access: ProjectAccess, meeting: Meeting, *, created: bool) -> None:
    """Campana a asistentes y mencionados (sin duplicar, sin auto-avisarse)."""
    author = access.user
    link = f"/projects/{meeting.project_id}/meet?open={meeting.id}"
    when = meeting.meeting_date.strftime("%d/%m/%Y") if meeting.meeting_date else ""
    mentioned = {u["id"] for u in (meeting.mentions or {}).get("users", [])} - {author.id}
    attendees = {a["id"] for a in (meeting.attendees or [])} - {author.id} - mentioned
    verb = "registró" if created else "actualizó"
    if mentioned:
        await notify(
            db, recipients=mentioned, project_id=meeting.project_id, kind="reunion",
            title=f"{author.full_name} te mencionó en la reunión «{meeting.title}»",
            body=f"{when} · {access.project.name}", link=link,
            entity_id=meeting.id, actor_name=author.full_name,
        )
    if attendees:
        await notify(
            db, recipients=attendees, project_id=meeting.project_id, kind="reunion",
            title=f"{author.full_name} {verb} la reunión «{meeting.title}»",
            body=f"Figurás como asistente · {when} · {access.project.name}", link=link,
            entity_id=meeting.id, actor_name=author.full_name,
        )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_meeting(
    project_id: str,
    payload: MeetingCreate,
    request: Request,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_meet_access(access)
    meeting = Meeting(
        project_id=project_id,
        title=payload.title.strip(),
        meeting_date=payload.meeting_date,
        location=(payload.location or "").strip()[:200] or None,
        content_md=payload.content_md,
        attendees=_clean_people(payload.attendees),
        mentions=_clean_mentions(payload.mentions),
        created_by=access.user.id,
        created_by_name=access.user.full_name,
    )
    db.add(meeting)
    await _notify_meeting(db, access, meeting, created=True)
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="meeting.create", project_id=project_id, entity_type="meeting",
        entity_id=meeting.id, detail={"title": meeting.title}, ip=client_ip(request),
    )
    await db.refresh(meeting)
    return _out(meeting)


@router.get("/{meeting_id}")
async def get_meeting(
    project_id: str,
    meeting_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_meet_access(access)
    m = await db.get(Meeting, meeting_id)
    if not m or m.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reunión no encontrada")
    return _out(m)


@router.patch("/{meeting_id}")
async def update_meeting(
    project_id: str,
    meeting_id: str,
    payload: MeetingUpdate,
    request: Request,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_meet_access(access)
    m = await db.get(Meeting, meeting_id)
    if not m or m.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reunión no encontrada")
    if m.created_by != access.user.id and access.permission != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo quien la registró (o un admin) puede editarla")

    prev_mentioned = {u["id"] for u in (m.mentions or {}).get("users", [])}
    prev_attendees = {a["id"] for a in (m.attendees or [])}
    if payload.title is not None:
        m.title = payload.title.strip()
    if payload.meeting_date is not None:
        m.meeting_date = payload.meeting_date
    if payload.location is not None:
        m.location = payload.location.strip()[:200] or None
    if payload.content_md is not None:
        m.content_md = payload.content_md
    if payload.attendees is not None:
        m.attendees = _clean_people(payload.attendees)
    if payload.mentions is not None:
        m.mentions = _clean_mentions(payload.mentions)
    m.updated_at = datetime.now(timezone.utc)

    # Avisar solo a los NUEVOS mencionados/asistentes (sin spamear a los demás)
    author = access.user
    link = f"/projects/{project_id}/meet?open={m.id}"
    new_mentioned = ({u["id"] for u in (m.mentions or {}).get("users", [])}
                     - prev_mentioned - {author.id})
    new_attendees = ({a["id"] for a in (m.attendees or [])}
                     - prev_attendees - {author.id} - new_mentioned)
    if new_mentioned:
        await notify(
            db, recipients=new_mentioned, project_id=project_id, kind="reunion",
            title=f"{author.full_name} te mencionó en la reunión «{m.title}»",
            body=access.project.name, link=link, entity_id=m.id, actor_name=author.full_name,
        )
    if new_attendees:
        await notify(
            db, recipients=new_attendees, project_id=project_id, kind="reunion",
            title=f"{author.full_name} te sumó a la reunión «{m.title}»",
            body=access.project.name, link=link, entity_id=m.id, actor_name=author.full_name,
        )
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="meeting.update", project_id=project_id, entity_type="meeting",
        entity_id=m.id, detail={"title": m.title}, ip=client_ip(request),
    )
    await db.refresh(m)
    return _out(m)


@router.delete("/{meeting_id}")
async def delete_meeting(
    project_id: str,
    meeting_id: str,
    request: Request,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_meet_access(access)
    m = await db.get(Meeting, meeting_id)
    if not m or m.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reunión no encontrada")
    if m.created_by != access.user.id and access.permission != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo quien la registró (o un admin) puede borrarla")
    title = m.title
    await db.delete(m)
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="meeting.delete", project_id=project_id, entity_type="meeting",
        entity_id=meeting_id, detail={"title": title}, ip=client_ip(request),
    )
    await db.commit()
    return {"ok": True}
