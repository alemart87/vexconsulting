"""Agente Cowork (zona Vex Cowork): el compañero de equipo IA del proyecto.

Distinto del investigador (que busca datos nuevos): el Agente Cowork tiene el
documento maestro LEÍDO y conversa de forma natural con los consultores. Las
conversaciones son COMPARTIDAS por todo el equipo del proyecto: cualquiera
puede sumarse, y con @mención se invita a un compañero (le llega la campana)
para que ambos sigan la conversación con el agente en el mismo hilo.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.database import get_db
from ...models.conversation import Conversation, Message
from ...models.document import Document
from ...models.project_member import ProjectMember
from ...models.user import User
from ...services.notification_service import notify
from ..deps import ProjectAccess, require_project_read

logger = logging.getLogger("vexconsulting")

router = APIRouter(prefix="/projects/{project_id}/cowork", tags=["cowork"])

AGENT_TYPE = "cowork"
MAX_DOC_CHARS = 45_000
HISTORY_MESSAGES = 24

_SYSTEM = """Sos el «Agente Cowork» de VEX Consulting: el compañero de equipo IA \
del proyecto «{project_name}». Tenés LEÍDO el documento maestro completo (va abajo) \
y conversás sobre él de forma natural, directa y útil — como un colega senior que se \
sabe el informe de memoria.

PARTICIPANTES de esta conversación: {participants} ({n_participants}). Cada mensaje \
indica quién habla — tenelo siempre presente.

Cómo trabajás:
- Con UNA persona: conversación uno a uno, directa y al grano.
- Con VARIAS personas: además de responder, FACILITÁ la discusión profesional cuando \
el tema lo amerite — contrastá las posturas de cada uno con la evidencia del \
documento, señalá en qué coinciden y en qué no, hacé preguntas dirigidas por nombre \
para destrabar la decisión («Ana, ¿ustedes ven ese 38 % en la operación?») y cerrá \
con una síntesis o un próximo paso concreto. No inventes desacuerdos que no existen \
ni alargues la charla porque sí.
- Si alguien fue mencionado para sumarse, dale un contexto breve de lo conversado \
antes de seguir.
- Tu foco es el DOCUMENTO: explicá secciones, resumí, compará cifras, detectá huecos \
o contradicciones, proponé mejoras y próximos pasos. Citá la sección de la que sacás \
cada cosa (ej.: «según “4. Evidencia”…»).
- Si algo NO está en el documento, decilo sin vueltas y sugerí investigarlo con el \
investigador (pestaña Documento) o con el modo automático. No inventes datos.
- Registro conversacional: respuestas concisas por defecto (2-6 párrafos o una lista \
corta), markdown liviano, sin encabezados salvo que pidan estructura. Español \
rioplatense profesional.

DOCUMENTO MAESTRO ACTUAL:
{document}"""


class CoworkMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=6000)
    mentions: Optional[dict] = None  # {"users": [{"id","name"}]}


def _require_cowork_access(access: ProjectAccess) -> None:
    if access.user.is_visualizador:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Los visualizadores no acceden al Agente Cowork")


def _can_moderate(access: ProjectAccess) -> bool:
    """Fijar/archivar/borrar hilos: consultor líder, superadmin o admin del proyecto."""
    return (
        access.user.role in ("superadmin", "consultor_lider")
        or access.permission == "admin"
    )


def _require_moderator(access: ProjectAccess) -> None:
    if not _can_moderate(access):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Solo el consultor líder (o un admin del proyecto) puede moderar los hilos",
        )


def _msg_out(m: Message, photos: dict | None = None) -> dict:
    return {
        "id": m.id, "role": m.role, "content": m.content,
        "author_id": m.author_id, "author_name": m.author_name,
        "author_photo_url": (photos or {}).get(m.author_id),
        "mentions": (m.tool_calls or {}).get("mentions"),
        "created_at": m.created_at,
    }


async def _get_conversation(db: AsyncSession, project_id: str, conv_id: str) -> Conversation:
    conv = await db.get(Conversation, conv_id)
    if not conv or conv.project_id != project_id or conv.agent_type != AGENT_TYPE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    return conv


@router.get("/conversations")
async def list_conversations(
    project_id: str,
    archived: bool = False,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Conversaciones del Agente Cowork: COMPARTIDAS por todo el equipo.
    Fijadas primero; las archivadas solo con ?archived=1."""
    _require_cowork_access(access)
    query = select(Conversation).where(
        Conversation.project_id == project_id,
        Conversation.agent_type == AGENT_TYPE,
        Conversation.archived_at.isnot(None) if archived else Conversation.archived_at.is_(None),
    )
    convs = (await db.execute(
        query.order_by(Conversation.pinned_at.desc().nullslast(),
                       Conversation.updated_at.desc()).limit(40)
    )).scalars().all()
    out = []
    for c in convs:
        last = (await db.execute(
            select(Message).where(Message.conversation_id == c.id)
            .order_by(Message.created_at.desc()).limit(1)
        )).scalar_one_or_none()
        participants = [
            name for (name,) in await db.execute(
                select(Message.author_name).where(
                    Message.conversation_id == c.id,
                    Message.author_name.isnot(None),
                ).distinct().limit(6)
            )
        ]
        out.append({
            "id": c.id, "title": c.title or "Conversación",
            "participants": participants,
            "last_message": (last.content[:90] if last else None),
            "last_role": (last.role if last else None),
            "pinned_at": c.pinned_at, "archived_at": c.archived_at,
            "updated_at": c.updated_at,
        })
    return out


@router.get("/conversations/archived-count")
async def archived_count(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_cowork_access(access)
    from sqlalchemy import func as _func

    n = (await db.execute(
        select(_func.count(Conversation.id)).where(
            Conversation.project_id == project_id,
            Conversation.agent_type == AGENT_TYPE,
            Conversation.archived_at.isnot(None),
        )
    )).scalar_one()
    return {"count": int(n or 0)}


@router.post("/conversations/{conv_id}/pin")
async def toggle_pin(
    project_id: str,
    conv_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_cowork_access(access)
    _require_moderator(access)
    conv = await _get_conversation(db, project_id, conv_id)
    conv.pinned_at = None if conv.pinned_at else datetime.now(timezone.utc)
    await db.commit()
    return {"pinned_at": conv.pinned_at}


@router.post("/conversations/{conv_id}/archive")
async def toggle_archive(
    project_id: str,
    conv_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_cowork_access(access)
    _require_moderator(access)
    conv = await _get_conversation(db, project_id, conv_id)
    conv.archived_at = None if conv.archived_at else datetime.now(timezone.utc)
    conv.pinned_at = None
    await db.commit()
    return {"archived_at": conv.archived_at}


@router.delete("/conversations/{conv_id}")
async def delete_conversation(
    project_id: str,
    conv_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Borra el hilo y sus mensajes (solo líder/admin — irreversible)."""
    _require_cowork_access(access)
    _require_moderator(access)
    conv = await _get_conversation(db, project_id, conv_id)
    from sqlalchemy import delete as _delete

    await db.execute(_delete(Message).where(Message.conversation_id == conv_id))
    await db.delete(conv)
    await db.commit()
    return {"ok": True}


@router.post("/conversations", status_code=status.HTTP_201_CREATED)
async def create_conversation(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_cowork_access(access)
    conv = Conversation(
        user_id=access.user.id, project_id=project_id,
        agent_type=AGENT_TYPE, title=None,
    )
    db.add(conv)
    await db.commit()
    return {"id": conv.id, "title": conv.title or "Conversación", "participants": [],
            "last_message": None, "last_role": None, "updated_at": conv.updated_at}


@router.get("/conversations/{conv_id}/messages")
async def get_messages(
    project_id: str,
    conv_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    _require_cowork_access(access)
    await _get_conversation(db, project_id, conv_id)
    rows = (await db.execute(
        select(Message).where(Message.conversation_id == conv_id)
        .order_by(Message.created_at).limit(400)
    )).scalars().all()
    photos = {uid: url for uid, url in await db.execute(select(User.id, User.photo_url)) if url}
    return [_msg_out(m, photos) for m in rows]


@router.get("/mentionables")
async def cowork_mentionables(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Compañeros invitables con @ a la conversación con el agente."""
    _require_cowork_access(access)
    rows = await db.execute(
        select(User.id, User.full_name, User.photo_url)
        .join(ProjectMember, ProjectMember.user_id == User.id)
        .where(ProjectMember.project_id == project_id, User.is_active.is_(True))
    )
    users = [{"id": uid, "name": name, "photo_url": url} for uid, name, url in rows]
    owner_id = access.project.owner_id
    if owner_id and owner_id != "superadmin" and owner_id not in {u["id"] for u in users}:
        owner = await db.get(User, owner_id)
        if owner:
            users.append({"id": owner.id, "name": owner.full_name, "photo_url": owner.photo_url})
    return {"users": users}


async def _ask_model(system: str, history: list[dict]) -> tuple[str, dict]:
    """Llama al modelo del proyecto. Devuelve (respuesta, usage_dict)."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=90, max_retries=1)
    kwargs: dict = dict(
        model=settings.agent_model,
        # Conversación: respuesta ágil (igual que el planner del modo automático)
        reasoning_effort="low",
        messages=[{"role": "system", "content": system}, *history],
    )
    try:
        resp = await client.chat.completions.create(**kwargs)
    except Exception as exc:
        if "reasoning" not in str(exc).lower():
            raise
        kwargs.pop("reasoning_effort", None)
        resp = await client.chat.completions.create(**kwargs)
    usage = getattr(resp, "usage", None)
    return (resp.choices[0].message.content or "").strip(), {
        "input_tokens": int(getattr(usage, "prompt_tokens", 0) or 0),
        "output_tokens": int(getattr(usage, "completion_tokens", 0) or 0),
        "cached_tokens": int(getattr(
            getattr(usage, "prompt_tokens_details", None), "cached_tokens", 0) or 0),
    }


@router.post("/conversations/{conv_id}/messages", status_code=status.HTTP_201_CREATED)
async def send_message(
    project_id: str,
    conv_id: str,
    payload: CoworkMessageCreate,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mensaje del consultor → notifica a los @mencionados → responde el agente
    (que tiene el documento maestro como contexto y ve quién dice qué)."""
    _require_cowork_access(access)
    if not settings.openai_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "IA no configurada en el servidor")
    conv = await _get_conversation(db, project_id, conv_id)
    content = payload.content.strip()

    # Menciones: compañeros invitados a ESTA conversación (campana con deep-link)
    mentioned = []
    for u in (payload.mentions or {}).get("users", [])[:10]:
        if isinstance(u, dict) and u.get("id") and u["id"] != access.user.id:
            mentioned.append({"id": str(u["id"])[:36], "name": str(u.get("name") or "")[:255]})

    user_msg = Message(
        conversation_id=conv_id, role="user", content=content,
        author_id=access.user.id, author_name=access.user.full_name,
        tool_calls={"mentions": mentioned} if mentioned else None,
    )
    db.add(user_msg)
    if not conv.title:
        conv.title = content[:80]
    conv.updated_at = datetime.now(timezone.utc)

    if mentioned:
        await notify(
            db, recipients={m["id"] for m in mentioned}, project_id=project_id,
            kind="mencion",
            title=f"{access.user.full_name} te sumó a una conversación con el Agente Cowork",
            body=f"«{content[:150]}» · {access.project.name}",
            link=f"/projects/{project_id}/agent?conv={conv_id}",
            entity_id=conv_id, actor_name=access.user.full_name,
        )
    await db.commit()

    # Contexto del agente: documento + historial con nombres de quién habla
    doc = (await db.execute(
        select(Document).where(Document.project_id == project_id)
    )).scalar_one_or_none()
    doc_md = (doc.content_md if doc else "") or "(el documento está vacío todavía)"

    rows = (await db.execute(
        select(Message).where(Message.conversation_id == conv_id)
        .order_by(Message.created_at.desc()).limit(HISTORY_MESSAGES)
    )).scalars().all()

    # El agente sabe CUÁNTOS son y QUIÉNES: autores del hilo + mencionados
    participant_names: list[str] = []
    for m in rows:
        if m.author_name and m.author_name not in participant_names:
            participant_names.append(m.author_name)
        for x in ((m.tool_calls or {}).get("mentions") or []):
            if x.get("name") and x["name"] not in participant_names:
                participant_names.append(x["name"])
    if access.user.full_name not in participant_names:
        participant_names.append(access.user.full_name)
    n = len(participant_names)
    system = _SYSTEM.format(
        project_name=access.project.name,
        participants=", ".join(participant_names),
        n_participants=f"{n} persona{'s' if n != 1 else ''}",
        document=doc_md[:MAX_DOC_CHARS],
    )
    history: list[dict] = []
    # El mensaje recién enviado va SIEMPRE al final (los timestamps pueden
    # empatar al segundo y desordenar el cierre del historial)
    ordered = [m for m in reversed(rows) if m.id != user_msg.id] + [user_msg]
    for m in ordered:
        if m.role == "user":
            prefix = f"[{m.author_name or 'Consultor'}]"
            extra = ""
            names = ", ".join(x["name"] for x in ((m.tool_calls or {}).get("mentions") or []))
            if names:
                extra = f" (menciona a {names} para sumarse)"
            history.append({"role": "user", "content": f"{prefix}{extra}: {m.content}"})
        else:
            history.append({"role": "assistant", "content": m.content})

    try:
        answer, usage = await _ask_model(system, history)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Agente Cowork falló en %s", conv_id[:8])
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"El agente no pudo responder: {str(exc)[:200]}. Reintentá.",
        )
    if not answer:
        answer = "No tengo una respuesta para eso — ¿lo reformulás?"

    from ...services.agent.pricing import compute_cost_usd

    cost = compute_cost_usd(usage["input_tokens"], usage["output_tokens"], usage["cached_tokens"])
    agent_msg = Message(
        conversation_id=conv_id, role="assistant", content=answer,
        tool_calls={"status": "done", "engine": "cowork", "cost_openai": cost,
                    "model": settings.agent_model},
        input_tokens=usage["input_tokens"], cached_tokens=usage["cached_tokens"],
        output_tokens=usage["output_tokens"],
        total_tokens=usage["input_tokens"] + usage["output_tokens"],
        cost_usd=cost,
    )
    db.add(agent_msg)
    conv.updated_at = datetime.now(timezone.utc)
    await db.commit()

    photos = {access.user.id: access.user.photo_url} if access.user.photo_url else {}
    return {"user_message": _msg_out(user_msg, photos), "assistant_message": _msg_out(agent_msg)}
