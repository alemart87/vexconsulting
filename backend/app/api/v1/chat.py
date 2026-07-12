"""Chat interno del equipo del proyecto: temas y mensajes directos, persistente,
con menciones a miembros (@usuario) y a notas de seguimiento (@nota)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.chat import ChatChannel, ChatMessage, ChatRead
from ...models.note import Note
from ...models.project_member import ProjectMember
from ...models.user import User
from ...services.audit_service import log_action
from ...services.notification_service import notify, project_member_ids
from ..deps import ProjectAccess, require_project_read

router = APIRouter(prefix="/projects/{project_id}/chat", tags=["chat"])


class ChannelCreate(BaseModel):
    kind: str = "tema"  # tema | dm
    name: Optional[str] = Field(default=None, max_length=120)
    user_id: Optional[str] = None  # destinatario del DM


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    mentions: Optional[dict] = None  # {"users": [...], "notes": [...]}
    parent_id: Optional[str] = None  # respuesta en hilo


class MessageEdit(BaseModel):
    content: str = Field(min_length=1, max_length=8000)


class ReactionToggle(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


def _msg_out(m: ChatMessage, photos: dict, reply_counts: dict | None = None) -> dict:
    deleted = m.deleted_at is not None
    return {
        "id": m.id, "user_id": m.user_id, "user_name": m.user_name,
        "user_photo_url": photos.get(m.user_id),
        "content": "" if deleted else m.content,
        "deleted": deleted,
        "mentions": None if deleted else m.mentions,
        "parent_id": m.parent_id,
        "reactions": m.reactions or {},
        "edited_at": m.edited_at,
        "reply_count": (reply_counts or {}).get(m.id, 0),
        "created_at": m.created_at,
    }


async def _user_photos(db: AsyncSession) -> dict:
    return {uid: url for uid, url in await db.execute(select(User.id, User.photo_url)) if url}


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
        .where(ChatMessage.channel_id == ch.id, ChatMessage.deleted_at.is_(None))
        .order_by(ChatMessage.created_at.desc())
        .limit(1)
    )
    row = last.first()

    # No leídos: mensajes raíz ajenos posteriores a la última lectura
    last_read = (await db.execute(
        select(ChatRead.last_read_at).where(
            ChatRead.channel_id == ch.id, ChatRead.user_id == me_id
        )
    )).scalar_one_or_none()
    unread_q = select(func.count(ChatMessage.id)).where(
        ChatMessage.channel_id == ch.id,
        ChatMessage.user_id != me_id,
        ChatMessage.deleted_at.is_(None),
        ChatMessage.parent_id.is_(None),
    )
    if last_read:
        unread_q = unread_q.where(ChatMessage.created_at > last_read)
    unread = (await db.execute(unread_q)).scalar_one() or 0

    return {
        "id": ch.id,
        "kind": ch.kind,
        "name": name,
        "last_message": (row.content[:80] if row else None),
        "last_at": (row.created_at if row else ch.created_at),
        "unread_count": int(unread),
        "last_read_at": last_read,
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

    # Solo mensajes raíz: las respuestas viven en su hilo
    query = select(ChatMessage).where(
        ChatMessage.channel_id == channel_id, ChatMessage.parent_id.is_(None)
    )
    if after:
        try:
            after_dt = datetime.fromisoformat(after.replace("Z", "+00:00"))
            query = query.where(ChatMessage.created_at > after_dt)
        except ValueError:
            pass
    result = await db.execute(query.order_by(ChatMessage.created_at.desc()).limit(limit))
    messages = list(reversed(result.scalars().all()))
    photos = await _user_photos(db)
    counts = {
        pid: int(n) for pid, n in await db.execute(
            select(ChatMessage.parent_id, func.count(ChatMessage.id))
            .where(
                ChatMessage.channel_id == channel_id,
                ChatMessage.parent_id.isnot(None),
                ChatMessage.deleted_at.is_(None),
            )
            .group_by(ChatMessage.parent_id)
        )
    }
    return [_msg_out(m, photos, counts) for m in messages]


@router.get("/channels/{channel_id}/messages/{message_id}/thread")
async def get_thread(
    project_id: str,
    channel_id: str,
    message_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """El hilo: mensaje raíz + respuestas en orden cronológico."""
    _require_chat_access(access)
    await _get_channel(db, project_id, channel_id, access.user.id)
    root = await db.get(ChatMessage, message_id)
    if not root or root.channel_id != channel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mensaje no encontrado")
    replies = (await db.execute(
        select(ChatMessage).where(ChatMessage.parent_id == message_id)
        .order_by(ChatMessage.created_at)
    )).scalars().all()
    photos = await _user_photos(db)
    alive = sum(1 for r in replies if r.deleted_at is None)
    return {
        "root": _msg_out(root, photos, {root.id: alive}),
        "replies": [_msg_out(r, photos) for r in replies],
    }


@router.post("/channels/{channel_id}/read")
async def mark_channel_read(
    project_id: str,
    channel_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Marca el canal como leído (badges de no leídos)."""
    _require_chat_access(access)
    await _get_channel(db, project_id, channel_id, access.user.id)
    existing = (await db.execute(
        select(ChatRead).where(
            ChatRead.channel_id == channel_id, ChatRead.user_id == access.user.id
        )
    )).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if existing:
        existing.last_read_at = now
    else:
        db.add(ChatRead(channel_id=channel_id, user_id=access.user.id, last_read_at=now))
    await db.commit()
    return {"ok": True}


@router.patch("/channels/{channel_id}/messages/{message_id}")
async def edit_message(
    project_id: str,
    channel_id: str,
    message_id: str,
    payload: MessageEdit,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_chat_access(access)
    m = await db.get(ChatMessage, message_id)
    if not m or m.channel_id != channel_id or m.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mensaje no encontrado")
    if m.user_id != access.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el autor puede editar su mensaje")
    m.content = payload.content.strip()
    m.edited_at = datetime.now(timezone.utc)
    await db.commit()
    photos = await _user_photos(db)
    return _msg_out(m, photos)


@router.delete("/channels/{channel_id}/messages/{message_id}")
async def delete_message(
    project_id: str,
    channel_id: str,
    message_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_chat_access(access)
    m = await db.get(ChatMessage, message_id)
    if not m or m.channel_id != channel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mensaje no encontrado")
    if m.user_id != access.user.id and access.permission != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el autor (o un admin) puede borrar")
    m.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}


@router.post("/channels/{channel_id}/messages/{message_id}/reactions")
async def toggle_reaction(
    project_id: str,
    channel_id: str,
    message_id: str,
    payload: ReactionToggle,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Agrega o quita (toggle) la reacción del usuario sobre el mensaje."""
    _require_chat_access(access)
    m = await db.get(ChatMessage, message_id)
    if not m or m.channel_id != channel_id or m.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mensaje no encontrado")
    reactions = dict(m.reactions or {})
    users = list(reactions.get(payload.emoji, []))
    if access.user.id in users:
        users.remove(access.user.id)
    else:
        users.append(access.user.id)
    if users:
        reactions[payload.emoji] = users
    else:
        reactions.pop(payload.emoji, None)
    m.reactions = reactions
    await db.commit()
    return {"reactions": reactions}


@router.post("/channels/{channel_id}/messages", status_code=status.HTTP_201_CREATED)
async def send_message(
    project_id: str,
    channel_id: str,
    payload: MessageCreate,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_chat_access(access)
    channel = await _get_channel(db, project_id, channel_id, access.user.id)

    # Respuesta en hilo: validar que el padre exista en este canal
    parent: ChatMessage | None = None
    if payload.parent_id:
        parent = await db.get(ChatMessage, payload.parent_id)
        if not parent or parent.channel_id != channel_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "El hilo no existe")
        if parent.parent_id:
            parent = await db.get(ChatMessage, parent.parent_id)  # un solo nivel

    message = ChatMessage(
        channel_id=channel_id,
        project_id=project_id,
        user_id=access.user.id,
        user_name=access.user.full_name,
        content=payload.content.strip(),
        mentions=payload.mentions,
        parent_id=parent.id if parent else None,
    )
    db.add(message)

    # --- Notificaciones (campana): menciones > hilo > directo > tema ---
    author = access.user
    preview = f"{author.full_name}: {message.content[:120]}"
    link = f"/projects/{project_id}/chat?channel={channel_id}"
    raw_mentions = (payload.mentions or {}).get("users") or []
    mentioned = {
        (m.get("id") if isinstance(m, dict) else m) for m in raw_mentions
    } - {author.id, None}
    if mentioned:
        await notify(
            db, recipients=mentioned, project_id=project_id, kind="mencion",
            title=f"{author.full_name} te mencionó en #{channel.name} · {access.project.name}",
            body=message.content[:200], link=link, entity_id=channel_id,
            actor_name=author.full_name,
        )
    if parent:
        # En un hilo solo se avisa al autor del mensaje raíz (no a todo el canal)
        await notify(
            db, recipients={parent.user_id} - {author.id} - mentioned,
            project_id=project_id, kind="chat",
            title=f"{author.full_name} respondió en tu hilo · #{channel.name}",
            body=message.content[:200], link=link, entity_id=parent.id,
            actor_name=author.full_name,
        )
    elif channel.kind == "dm":
        others = set((channel.dm_key or "").split("|")) - {author.id} - mentioned
        await notify(
            db, recipients=others, project_id=project_id, kind="chat",
            title=f"Directo de {author.full_name} · {access.project.name}",
            body=message.content[:200], link=link, entity_id=channel_id,
            actor_name=author.full_name,
        )
    else:
        members = await project_member_ids(db, access.project)
        await notify(
            db, recipients=members - {author.id} - mentioned, project_id=project_id,
            kind="chat", title=f"#{channel.name} · {access.project.name}",
            body=preview, link=link, entity_id=channel_id,
            actor_name=author.full_name,
        )

    await db.commit()
    await db.refresh(message)
    return _msg_out(message, {author.id: author.photo_url})


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
