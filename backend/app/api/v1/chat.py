"""Chat interno del equipo del proyecto: temas y mensajes directos, persistente,
con menciones a miembros (@usuario) y a notas de seguimiento (@nota)."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.chat import ChatChannel, ChatMessage
from ...models.note import Note
from ...models.project_member import ProjectMember
from ...models.user import User
from ...services.audit_service import log_action
from ..deps import ProjectAccess, require_project_read

router = APIRouter(prefix="/projects/{project_id}/chat", tags=["chat"])


class ChannelCreate(BaseModel):
    kind: str = "tema"  # tema | dm
    name: Optional[str] = Field(default=None, max_length=120)
    user_id: Optional[str] = None  # destinatario del DM


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    mentions: Optional[dict] = None  # {"users": [...], "notes": [...]}


def _require_chat_access(access: ProjectAccess) -> None:
    if access.user.is_visualizador:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Los visualizadores no acceden al chat interno")


def _dm_key(a: str, b: str) -> str:
    return "|".join(sorted([a, b]))


async def _channel_out(db: AsyncSession, ch: ChatChannel, me_id: str) -> dict:
    name = ch.name
    if ch.kind == "dm" and ch.dm_key:
        other_id = next((uid for uid in ch.dm_key.split("|") if uid != me_id), None)
        if other_id:
            if other_id == "superadmin":
                name = "Superadmin"
            else:
                other = await db.get(User, other_id)
                name = other.full_name if other else name
    last = await db.execute(
        select(ChatMessage.content, ChatMessage.created_at)
        .where(ChatMessage.channel_id == ch.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(1)
    )
    row = last.first()
    return {
        "id": ch.id,
        "kind": ch.kind,
        "name": name,
        "last_message": (row.content[:80] if row else None),
        "last_at": (row.created_at if row else ch.created_at),
    }


async def _get_channel(db: AsyncSession, project_id: str, channel_id: str, me_id: str) -> ChatChannel:
    channel = await db.get(ChatChannel, channel_id)
    if not channel or channel.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal no encontrado")
    if channel.kind == "dm" and me_id not in (channel.dm_key or "").split("|"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No participás de este directo")
    return channel


@router.get("/channels")
async def list_channels(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    _require_chat_access(access)

    # Canal «general» del proyecto, autocreado de forma idempotente
    existing = await db.execute(
        select(ChatChannel).where(
            ChatChannel.project_id == project_id, ChatChannel.kind == "tema"
        )
    )
    temas = existing.scalars().all()
    if not temas:
        general = ChatChannel(
            project_id=project_id, kind="tema", name="general", created_by=access.user.id
        )
        db.add(general)
        await db.commit()
        temas = [general]

    dms = (
        await db.execute(
            select(ChatChannel).where(
                ChatChannel.project_id == project_id,
                ChatChannel.kind == "dm",
                ChatChannel.dm_key.like(f"%{access.user.id}%"),
            )
        )
    ).scalars().all()
    dms = [d for d in dms if access.user.id in (d.dm_key or "").split("|")]

    out = [await _channel_out(db, c, access.user.id) for c in [*temas, *dms]]
    out.sort(key=lambda c: (c["kind"] != "tema", str(c["last_at"] or "")), reverse=False)
    return out


@router.post("/channels", status_code=status.HTTP_201_CREATED)
async def create_channel(
    project_id: str,
    payload: ChannelCreate,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_chat_access(access)

    if payload.kind == "dm":
        if not payload.user_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Falta el destinatario del directo")
        if payload.user_id == access.user.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "No podés abrir un directo con vos mismo")
        key = _dm_key(access.user.id, payload.user_id)
        existing = await db.execute(
            select(ChatChannel).where(
                ChatChannel.project_id == project_id, ChatChannel.dm_key == key
            )
        )
        found = existing.scalar_one_or_none()
        if found:
            return await _channel_out(db, found, access.user.id)
        channel = ChatChannel(
            project_id=project_id, kind="dm", name="directo", dm_key=key,
            created_by=access.user.id,
        )
    else:
        name = (payload.name or "").strip().lstrip("#")
        if len(name) < 2:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "El tema necesita un nombre")
        channel = ChatChannel(
            project_id=project_id, kind="tema", name=name[:120], created_by=access.user.id
        )

    db.add(channel)
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="chat.channel_create", project_id=project_id, entity_type="chat_channel",
        entity_id=channel.id, detail={"kind": channel.kind, "name": channel.name},
    )
    await db.refresh(channel)
    return await _channel_out(db, channel, access.user.id)


@router.get("/channels/{channel_id}/messages")
async def list_messages(
    project_id: str,
    channel_id: str,
    after: Optional[str] = None,
    limit: int = Query(default=100, le=300),
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    _require_chat_access(access)
    await _get_channel(db, project_id, channel_id, access.user.id)

    query = select(ChatMessage).where(ChatMessage.channel_id == channel_id)
    if after:
        try:
            after_dt = datetime.fromisoformat(after.replace("Z", "+00:00"))
            query = query.where(ChatMessage.created_at > after_dt)
        except ValueError:
            pass
    result = await db.execute(query.order_by(ChatMessage.created_at.desc()).limit(limit))
    messages = list(reversed(result.scalars().all()))
    return [
        {
            "id": m.id, "user_id": m.user_id, "user_name": m.user_name,
            "content": m.content, "mentions": m.mentions, "created_at": m.created_at,
        }
        for m in messages
    ]


@router.post("/channels/{channel_id}/messages", status_code=status.HTTP_201_CREATED)
async def send_message(
    project_id: str,
    channel_id: str,
    payload: MessageCreate,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_chat_access(access)
    await _get_channel(db, project_id, channel_id, access.user.id)

    message = ChatMessage(
        channel_id=channel_id,
        project_id=project_id,
        user_id=access.user.id,
        user_name=access.user.full_name,
        content=payload.content.strip(),
        mentions=payload.mentions,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return {
        "id": message.id, "user_id": message.user_id, "user_name": message.user_name,
        "content": message.content, "mentions": message.mentions,
        "created_at": message.created_at,
    }


@router.get("/mentionables")
async def mentionables(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Miembros y notas mencionables con @ en el composer."""
    _require_chat_access(access)
    members_rows = await db.execute(
        select(User.id, User.full_name)
        .join(ProjectMember, ProjectMember.user_id == User.id)
        .where(ProjectMember.project_id == project_id, User.is_active.is_(True))
    )
    users = [{"id": uid, "name": name} for uid, name in members_rows]
    owner_id = access.project.owner_id
    if owner_id and owner_id not in {u["id"] for u in users}:
        if owner_id == "superadmin":
            users.append({"id": "superadmin", "name": "Superadmin"})
        else:
            owner = await db.get(User, owner_id)
            if owner:
                users.append({"id": owner.id, "name": owner.full_name})

    notes_rows = await db.execute(
        select(Note.id, Note.title, Note.status)
        .where(Note.project_id == project_id, Note.status.in_(["pendiente", "en_progreso"]))
        .order_by(Note.updated_at.desc())
        .limit(50)
    )
    notes = [{"id": nid, "title": title, "status": st} for nid, title, st in notes_rows]
    return {"users": users, "notes": notes}
