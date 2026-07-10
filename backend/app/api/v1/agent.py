"""Agentes de IA: conversaciones por proyecto con streaming SSE.

- acompanante: consultores con permiso read+ en el proyecto.
- visualizador: solo el documento publicado (tools restringidas).
- Autocompletado corto para el editor (sin conversación).
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.database import get_db, session_scope
from ...models.conversation import Conversation, Message
from ...services.agent.context import AgentContext
from ...services.agent.core import (
    AgentNotConfigured,
    build_companion_agent,
    build_viewer_agent,
    stream_agent,
)
from ...services.agent.pricing import compute_cost_usd
from ...services.agent.roles import DEFAULT_ROLE, list_roles
from ...services.audit_service import log_action
from ..deps import ProjectAccess, client_ip, require_project_read, require_project_write

logger = logging.getLogger("vexconsulting")

router = APIRouter(tags=["agent"])


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


class ConversationCreate(BaseModel):
    role_slug: str | None = None


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=20000)


class SuggestRequest(BaseModel):
    context_text: str = Field(min_length=1, max_length=12000)
    instruction: str | None = Field(default=None, max_length=500)


class ResearchRequest(BaseModel):
    query: str = Field(min_length=3, max_length=2000)
    context_text: str | None = Field(default=None, max_length=12000)
    engine: str = "openai"  # openai (web_search) | perplexity (sonar)


@router.get("/agent/roles")
async def get_roles() -> list[dict]:
    return list_roles()


@router.get("/agent/capabilities")
async def get_capabilities() -> dict:
    return {
        "openai": bool(settings.openai_api_key),
        "perplexity": settings.perplexity_enabled,
        "model": settings.agent_model,
        "perplexity_model": settings.perplexity_model,
    }


@router.get("/projects/{project_id}/agent/conversations")
async def list_conversations(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    agent_type = "visualizador" if access.user.is_visualizador else "acompanante"
    result = await db.execute(
        select(Conversation)
        .where(
            Conversation.project_id == project_id,
            Conversation.user_id == access.user.id,
            Conversation.agent_type == agent_type,
        )
        .order_by(Conversation.updated_at.desc())
        .limit(50)
    )
    return [
        {"id": c.id, "title": c.title, "role_slug": c.role_slug,
         "agent_type": c.agent_type, "updated_at": c.updated_at}
        for c in result.scalars().all()
    ]


@router.post("/projects/{project_id}/agent/conversations", status_code=status.HTTP_201_CREATED)
async def create_conversation(
    project_id: str,
    payload: ConversationCreate,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    agent_type = "visualizador" if access.user.is_visualizador else "acompanante"
    conv = Conversation(
        user_id=access.user.id,
        project_id=project_id,
        agent_type=agent_type,
        role_slug=payload.role_slug or access.project.agent_role_slug or DEFAULT_ROLE,
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return {"id": conv.id, "title": conv.title, "role_slug": conv.role_slug,
            "agent_type": conv.agent_type}


@router.get("/agent/conversations/{conv_id}/messages")
async def get_messages(
    conv_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    conv = await _own_conversation(conv_id, request, db)
    result = await db.execute(
        select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at)
    )
    return [
        {"id": m.id, "role": m.role, "content": m.content, "reasoning": m.reasoning,
         "tool_calls": m.tool_calls, "cost_usd": float(m.cost_usd or 0),
         "created_at": m.created_at}
        for m in result.scalars().all()
    ]


@router.delete("/agent/conversations/{conv_id}")
async def delete_conversation(
    conv_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    conv = await _own_conversation(conv_id, request, db)
    await db.delete(conv)
    await db.commit()
    return {"ok": True}


async def _own_conversation(conv_id: str, request: Request, db: AsyncSession) -> Conversation:
    """Carga la conversación y valida que pertenezca al usuario autenticado."""
    from ..deps import get_current_user, bearer

    creds = await bearer(request)
    user = await get_current_user(request, creds, db)
    conv = await db.get(Conversation, conv_id)
    if not conv or (conv.user_id != user.id and not user.is_superadmin):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    return conv


@router.post("/projects/{project_id}/agent/conversations/{conv_id}/messages")
async def send_message(
    project_id: str,
    conv_id: str,
    payload: MessageCreate,
    request: Request,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
):
    conv = await db.get(Conversation, conv_id)
    if not conv or conv.project_id != project_id or conv.user_id != access.user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")

    text = payload.content.strip()
    project = access.project

    db.add(Message(conversation_id=conv_id, role="user", content=text))
    if not conv.title:
        conv.title = text[:60]
    await db.commit()

    rows = await db.execute(
        select(Message).where(Message.conversation_id == conv_id)
        .order_by(Message.created_at.desc()).limit(settings.agent_max_history)
    )
    history = list(reversed(rows.scalars().all()))
    messages = [{"role": m.role, "content": m.content} for m in history if m.content]

    is_viewer = access.user.is_visualizador or conv.agent_type == "visualizador"
    context = AgentContext(
        user_id=access.user.id,
        user_name=access.user.full_name,
        project_id=project_id,
        agent_type="visualizador" if is_viewer else "acompanante",
        published_version_id=project.published_version_id,
    )

    def _build():
        if is_viewer:
            return build_viewer_agent(project)
        return build_companion_agent(project, conv.role_slug)

    uid, uemail, urole = access.user.id, access.user.email, access.user.role
    ip = client_ip(request)

    async def event_stream():
        # Padding anti-buffering de proxies + heartbeats (patrón de referencia).
        yield ":" + (" " * 2048) + "\n\n"
        yield _sse({"type": "start"})

        final: dict = {}
        queue: asyncio.Queue = asyncio.Queue()

        async def _produce():
            try:
                agent = _build()
                async for ev in stream_agent(messages, context, agent):
                    await queue.put(("ev", ev))
            except AgentNotConfigured as exc:
                await queue.put(("err", str(exc)))
            except Exception as exc:  # noqa: BLE001
                if exc.__class__.__name__ == "MaxTurnsExceeded":
                    await queue.put(("err", "La consulta requirió demasiados pasos. Probá acotarla."))
                else:
                    logger.exception("agent error conv=%s", conv_id)
                    await queue.put(("err", "Ocurrió un error procesando la consulta."))
            finally:
                await queue.put(("end", None))

        producer = asyncio.create_task(_produce())
        failed = False
        while True:
            try:
                kind, data = await asyncio.wait_for(queue.get(), timeout=2.0)
            except asyncio.TimeoutError:
                yield ": hb\n\n"
                continue
            if kind == "end":
                break
            if kind == "err":
                failed = True
                yield _sse({"type": "error", "message": data})
                continue
            if data["type"] == "done":
                final = data
            yield _sse(data)
        await producer

        if failed:
            return
        try:
            usage = final.get("usage", {}) or {}
            async with session_scope() as s:
                s.add(Message(
                    conversation_id=conv_id,
                    role="assistant",
                    content=final.get("content", ""),
                    reasoning=final.get("reasoning") or None,
                    tool_calls={"trace": final.get("tool_trace", []),
                                "proposals": final.get("proposals", [])},
                    input_tokens=usage.get("input_tokens", 0),
                    cached_tokens=usage.get("cached_tokens", 0),
                    output_tokens=usage.get("output_tokens", 0),
                    reasoning_tokens=usage.get("reasoning_tokens", 0),
                    total_tokens=usage.get("total_tokens", 0),
                    cost_usd=compute_cost_usd(
                        usage.get("input_tokens", 0), usage.get("output_tokens", 0),
                        usage.get("cached_tokens", 0),
                    ),
                ))
                c = await s.get(Conversation, conv_id)
                if c:
                    c.updated_at = datetime.now(timezone.utc)
                await log_action(
                    s, user_id=uid, user_email=uemail, user_role=urole,
                    action="agent.chat", project_id=project_id,
                    entity_type="conversation", entity_id=conv_id,
                    detail={"tools": [t.get("tool") for t in final.get("tool_trace", [])]},
                    ip=ip, commit=False,
                )
                await s.commit()
        except Exception:
            logger.exception("No se pudo persistir la respuesta del agente")

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
    })


@router.post("/projects/{project_id}/agent/suggest")
async def suggest_text(
    project_id: str,
    payload: SuggestRequest,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Asistente de redacción del editor: continúa, mejora, resume o expande el
    texto según la instrucción, apoyado en las fuentes del proyecto (RAG) con
    citas. Llamada directa (sin agente) para latencia baja."""
    if not settings.openai_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "IA no configurada en el servidor")

    from openai import AsyncOpenAI

    from ...services.rag.retriever import format_citation, search_chunks

    # Grounding: los fragmentos de las fuentes más afines al texto en edición.
    fuentes_block = ""
    try:
        chunks = await search_chunks(db, project_id, payload.context_text[-500:], k=4)
        if chunks:
            fuentes_block = "\n\nFUENTES DEL PROYECTO (usalas si aportan; citá con el formato dado):\n" + "\n\n".join(
                f"{format_citation(c)}\n{c['content'][:800]}" for c in chunks
            )
    except Exception:
        pass

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    instruction = payload.instruction or (
        "Continuá el texto de forma natural, en el mismo registro, con 1 a 3 "
        "oraciones sobrias de informe de investigación. Si el texto termina a "
        "mitad de una idea, completala."
    )
    resp = await client.chat.completions.create(
        model=settings.agent_model,
        max_completion_tokens=700,
        messages=[
            {
                "role": "system",
                "content": "Sos un asistente de redacción de informes de investigación "
                "de mercado en español, registro institucional sobrio (sin grandilocuencia). "
                "Respondé SOLO con el texto sugerido en Markdown, sin preámbulos ni "
                "explicaciones. Si afirmás una cifra tomada de las fuentes, citala "
                "entre corchetes como te la presentan.",
            },
            {
                "role": "user",
                "content": f"INSTRUCCIÓN: {instruction}\n\nTEXTO EN EDICIÓN:\n{payload.context_text}{fuentes_block}",
            },
        ],
    )
    suggestion = (resp.choices[0].message.content or "").strip()
    return {"suggestion": suggestion}


_RESEARCH_SYSTEM = (
    "Sos un investigador de mercado senior redactando para un informe de consultoría "
    "en español, registro institucional sobrio. Investigá la consulta con las "
    "herramientas de búsqueda disponibles y con las fuentes internas provistas. "
    "Respondé SOLO con el bloque de texto en Markdown listo para insertar en el "
    "informe: hallazgos con cifras concretas, cada cifra con su fuente (enlace "
    "markdown para fuentes web; corchetes para fuentes internas del proyecto). "
    "Cerrá con una lista «Fuentes:» con los enlaces usados. Sin preámbulos."
)


async def _perplexity_research(user_prompt: str) -> tuple[str, list[dict]]:
    """Investigación vía el Agent API de Perplexity (POST /v1/agent, multi-proveedor,
    tool web_search nativa). Fallback al /chat/completions clásico si no está
    disponible para la cuenta."""
    import httpx

    model = settings.perplexity_model
    if "/" not in model:
        model = f"perplexity/{model}"

    headers = {"Authorization": f"Bearer {settings.perplexity_api_key}"}
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            settings.perplexity_agent_url,
            headers=headers,
            json={
                "model": model,
                "input": user_prompt,
                "instructions": _RESEARCH_SYSTEM,
                "tools": [{"type": "web_search"}],
            },
        )
        if resp.status_code == 401:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "La API key de Perplexity es inválida")

        if resp.status_code in (404, 405):
            # Cuenta sin Agent API: endpoint clásico con el modelo sin prefijo
            legacy_model = model.split("/", 1)[-1]
            resp = await client.post(
                "https://api.perplexity.ai/chat/completions",
                headers=headers,
                json={
                    "model": legacy_model,
                    "messages": [
                        {"role": "system", "content": _RESEARCH_SYSTEM},
                        {"role": "user", "content": user_prompt},
                    ],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            answer = (data["choices"][0]["message"]["content"] or "").strip()
            citations: list[dict] = []
            for c in data.get("citations") or []:
                citations.append({"url": c, "title": c} if isinstance(c, str) else c)
            for sr in data.get("search_results") or []:
                if isinstance(sr, dict) and sr.get("url"):
                    citations.append({"url": sr["url"], "title": sr.get("title") or sr["url"]})
            return answer, citations

        if resp.status_code == 400:
            detail = ""
            try:
                detail = (resp.json().get("error") or {}).get("message", "")
            except Exception:
                pass
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                f"Perplexity rechazó la consulta: {detail or resp.text[:200]}",
            )
        resp.raise_for_status()
        data = resp.json()

    # Agent API: output = [{type: search_results|message|fetch_url_results, ...}]
    parts: list[str] = []
    citations = []
    for item in data.get("output") or []:
        itype = item.get("type")
        if itype == "message":
            for content in item.get("content") or []:
                if content.get("type") == "output_text":
                    parts.append(content.get("text") or "")
                for ann in content.get("annotations") or []:
                    if ann.get("url"):
                        citations.append({
                            "url": ann["url"],
                            "title": ann.get("title") or ann["url"],
                        })
        elif itype == "search_results":
            for r in item.get("results") or []:
                if r.get("url"):
                    citations.append({"url": r["url"], "title": r.get("title") or r["url"]})
    answer = "\n".join(p for p in parts if p).strip() or (data.get("output_text") or "").strip()
    return answer, citations


async def _project_grounding(db: AsyncSession, project_id: str, query: str) -> str:
    from ...services.rag.retriever import format_citation, search_chunks

    try:
        chunks = await search_chunks(db, project_id, query, k=4)
    except Exception:
        return ""
    if not chunks:
        return ""
    return "\n\nFUENTES INTERNAS DEL PROYECTO (citá con el formato dado):\n" + "\n\n".join(
        f"{format_citation(c)}\n{c['content'][:800]}" for c in chunks
    )


@router.post("/projects/{project_id}/agent/research")
async def research(
    project_id: str,
    payload: ResearchRequest,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Agente de investigación del editor: búsqueda web real (OpenAI web_search
    o Perplexity Sonar) + fuentes internas del proyecto, con citas verificables."""
    grounding = await _project_grounding(db, project_id, payload.query)
    context_block = (
        f"\n\nCONTEXTO DEL DOCUMENTO EN EDICIÓN:\n{payload.context_text[-4000:]}"
        if payload.context_text
        else ""
    )
    user_prompt = f"CONSULTA DE INVESTIGACIÓN: {payload.query}{context_block}{grounding}"

    citations: list[dict] = []

    if payload.engine == "perplexity":
        if not settings.perplexity_enabled:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Perplexity no está configurado: cargá PERPLEXITY_API_KEY en el .env "
                "(la key se genera en perplexity.ai/settings/api).",
            )
        answer, citations = await _perplexity_research(user_prompt)
    else:
        if not settings.openai_api_key:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "IA no configurada en el servidor")
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=180)
        resp = await client.responses.create(
            model=settings.agent_model,
            tools=[{"type": "web_search"}],
            instructions=_RESEARCH_SYSTEM,
            input=user_prompt,
        )
        answer = (getattr(resp, "output_text", "") or "").strip()
        # Extraer citas de las anotaciones url_citation del Responses API
        try:
            for item in getattr(resp, "output", []) or []:
                for content in getattr(item, "content", []) or []:
                    for ann in getattr(content, "annotations", []) or []:
                        if getattr(ann, "type", "") == "url_citation":
                            citations.append({
                                "url": getattr(ann, "url", ""),
                                "title": getattr(ann, "title", "") or getattr(ann, "url", ""),
                            })
        except Exception:
            pass

    # Fallback: extraer los enlaces markdown de la respuesta como citas
    if not citations and answer:
        import re as _re

        for title, url in _re.findall(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", answer):
            citations.append({"url": url, "title": title})

    # Dedupe de citas por URL
    seen: set[str] = set()
    unique_citations = []
    for c in citations:
        url = c.get("url") or ""
        if url and url not in seen:
            seen.add(url)
            unique_citations.append(c)

    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="agent.research", project_id=project_id, entity_type="research",
        detail={"engine": payload.engine, "query": payload.query[:120]},
        ip=client_ip(request),
    )
    return {"answer": answer, "citations": unique_citations, "engine": payload.engine}
