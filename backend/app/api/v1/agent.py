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

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
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
    engine: str = "vex"  # legado; el agente principal orquesta sus propias tools
    rigor: str = "estandar"  # estandar | academico (prioriza fuentes revisadas por pares)
    conversation_id: str | None = None  # hilo de investigación con memoria (30 mensajes)
    attachment_source_ids: list[str] | None = None  # adjuntos de esta consulta (ya indexados)
    focus_source_ids: list[str] | None = None  # fuentes citadas con @ (restringen la base interna)


@router.get("/agent/roles")
async def get_roles() -> list[dict]:
    return list_roles()


_AUDIO_EXTS = (".mp3", ".m4a", ".wav", ".webm", ".ogg", ".mp4", ".mpeg", ".mpga")


@router.post("/projects/{project_id}/agent/attach", status_code=status.HTTP_201_CREATED)
async def attach_for_research(
    project_id: str,
    file: UploadFile,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Entrada multimodal del investigador: imagen (visión) o audio/nota de voz
    (transcripción). Se procesa al instante, queda GUARDADO como fuente del
    proyecto (indexada para RAG) y se puede citar en la consulta en curso."""
    import hashlib
    import uuid as _uuid

    if not settings.openai_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "IA no configurada en el servidor")

    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Archivo vacío")
    if len(data) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Máximo {settings.max_upload_size_mb} MB",
        )

    filename = (file.filename or "adjunto").replace("/", "_").replace("\\", "_")
    mime = (file.content_type or "").lower()
    lower = filename.lower()
    is_image = mime.startswith("image/")
    is_audio = mime.startswith("audio/") or mime.startswith("video/webm") or lower.endswith(_AUDIO_EXTS)

    if not (is_image or is_audio):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Este adjunto acepta imágenes y audio/notas de voz. Para documentos "
            "(PDF, Word, Excel) usá la pestaña Fuentes: se indexan igual.",
        )

    # Extraer contenido con IA
    if is_image:
        from ...services.rag.extractors import _vision_image_text

        extracted = _vision_image_text(data, mime or "image/png")
        kind_label = "imagen"
    else:
        import io

        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=300)
        buffer = io.BytesIO(data)
        buffer.name = filename if "." in filename else f"{filename}.webm"
        try:
            tr = await client.audio.transcriptions.create(model="gpt-4o-transcribe", file=buffer)
        except Exception:
            buffer.seek(0)
            tr = await client.audio.transcriptions.create(model="whisper-1", file=buffer)
        extracted = (getattr(tr, "text", "") or "").strip()
        kind_label = "nota de voz"

    if not extracted:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"La IA no reconoció contenido en la {kind_label}. Verificá calidad/nitidez y reintentá.",
        )

    # Guardar archivo + fuente indexada (lista para RAG al instante)
    source_id = str(_uuid.uuid4())
    folder = settings.upload_path / project_id / "sources" / source_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / filename).write_bytes(data)

    from ...models.source import Source
    from ...models.source_chunk import SourceChunk
    from ...services.rag.chunker import chunk_sections
    from ...services.rag.embedder import embed_texts

    chunks = chunk_sections(
        [{"text": extracted, "meta": {"ocr": is_image, "transcripcion": is_audio}}],
        settings.max_chunks_per_source,
    )
    embeddings = None
    embed_cost = 0.0
    try:
        embeddings, embed_cost = await embed_texts([c["content"] for c in chunks])
    except Exception:
        pass

    source = Source(
        id=source_id,
        project_id=project_id,
        kind="file",
        title=f"{'📷 ' if is_image else '🎙 '}{filename}",
        original_filename=filename,
        mime_type=mime or None,
        sha256=hashlib.sha256(data).hexdigest(),
        stored_path=str(folder / filename),
        size_bytes=len(data),
        status="ready",
        extracted_chars=len(extracted),
        chunk_count=len(chunks),
        embedding_cost_usd=embed_cost or None,
        uploaded_by=access.user.id,
        uploaded_by_name=f"{access.user.full_name} (vía investigador)",
    )
    db.add(source)
    for idx, chunk in enumerate(chunks):
        db.add(SourceChunk(
            source_id=source_id,
            project_id=project_id,
            chunk_index=idx,
            content=chunk["content"],
            embedding=embeddings[idx] if embeddings else None,
            meta=chunk["meta"] or None,
            token_count=chunk["token_count"],
        ))
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="source.attach", project_id=project_id, entity_type="source",
        entity_id=source_id, detail={"tipo": kind_label, "archivo": filename},
        ip=client_ip(request),
    )
    return {
        "source_id": source_id,
        "title": source.title,
        "kind": kind_label,
        "extracted_chars": len(extracted),
        "preview": extracted[:400],
    }


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
    agent_type: str = "acompanante",
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    if access.user.is_visualizador:
        agent_type = "visualizador"
    elif agent_type not in ("acompanante", "investigacion"):
        agent_type = "acompanante"
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
    "Sos «VEX Consulting IA», el investigador experto de una consultora de "
    "investigación de mercado. Redactás en español, registro institucional sobrio, "
    "con método científico. Investigá EN PROFUNDIDAD con las herramientas de búsqueda "
    "y las fuentes internas provistas; si hay historial, CONSTRUÍ sobre él (desagregá, "
    "verificá, no repitas).\n"
    "CALIDAD DE FUENTES: priorizá estadística oficial, reguladores, organismos "
    "internacionales, balances auditados, consultoras reconocidas y asociaciones de "
    "industria; evitá blogs de proveedores y contenido SEO salvo que no exista nada "
    "mejor, y en ese caso marcá la cifra como «fuente de industria, no verificada».\n\n"
    "Estructura obligatoria de tu respuesta (Markdown plano, SIN envolver en bloques "
    "de código ```):\n"
    "## Hallazgos\n"
    "Hallazgos numerados; cada uno con cifra concreta, año y referencia [n]. Nada de "
    "generalidades sin dato.\n"
    "## Comparativa\n"
    "Una tabla Markdown cuando haya datos comparables (países, años, segmentos, "
    "rangos). Si no aplica, omitila.\n"
    "## Análisis\n"
    "Qué significan los datos: tendencias, discrepancias entre fuentes (señalalas "
    "explícitamente con ambas cifras), y qué tan sólida es la evidencia.\n"
    "## Implicancias para la investigación\n"
    "2-4 viñetas conectando los hallazgos con el proyecto del consultor.\n\n"
    "Reglas: cada cifra lleva su referencia numerada [n] correspondiente a los "
    "resultados de búsqueda (no inventes números) o la cita entre corchetes para "
    "fuentes internas. NO agregues lista de fuentes al final (el sistema la agrega). "
    "Sin preámbulos ni cierres de cortesía. Mínimo 400 palabras salvo que la consulta "
    "sea trivial."
)


def _clean_answer(answer: str) -> str:
    """Normaliza la respuesta para que renderice como prosa Markdown:
    quita fences ``` que envuelven todo y des-indenta (líneas con sangría
    uniforme se interpretan como bloque de código y rompen el formato)."""
    text = (answer or "").strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1 and text.rstrip().endswith("```"):
            text = text[first_newline + 1 :].rstrip()
            if text.endswith("```"):
                text = text[:-3].rstrip()

    lines = text.split("\n")
    non_empty = [ln for ln in lines if ln.strip()]
    if non_empty:
        indent = min(len(ln) - len(ln.lstrip(" ")) for ln in non_empty)
        if indent > 0:
            lines = [ln[indent:] if ln.strip() else "" for ln in lines]
            text = "\n".join(lines)
    return text


def _linkify_citations(answer: str, citations: list[dict]) -> str:
    """Convierte las referencias [n] en enlaces y agrega la lista de fuentes
    formateada con títulos (legible en el documento, la vista previa y el export)."""
    import re as _re

    if citations:
        def _link(match: _re.Match) -> str:
            n = int(match.group(1))
            if 1 <= n <= len(citations):
                return f"[[{n}]]({citations[n - 1].get('url', '')})"
            return match.group(0)

        answer = _re.sub(r"\[(\d+)\](?!\()", _link, answer)

        # Quitar una lista final de fuentes cruda si el modelo la agregó igual
        answer = _re.sub(r"\n+\**Fuentes:?\**\s*\n(?:\s*(?:\d+\.\s*)?https?://\S+\s*\n?)+\s*$", "", answer)

        lines = ["\n\n**Fuentes consultadas:**\n"]
        for i, c in enumerate(citations, start=1):
            title = (c.get("title") or c.get("url") or "").strip()
            url = c.get("url") or ""
            if title == url:
                try:
                    from urllib.parse import urlparse

                    title = urlparse(url).netloc or url
                except Exception:
                    pass
            lines.append(f"{i}. [{title}]({url})")
        answer = answer.rstrip() + "\n".join(lines)
    return answer


async def _load_research_history(
    db: AsyncSession, conversation_id: str, generous: bool = False
) -> str:
    """Últimos N mensajes del hilo como transcript.

    generous=True: modo analista — el hilo entra casi completo (analizar toda
    la conversación exige ver toda la conversación)."""
    rows = await db.execute(
        select(Message).where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc()).limit(settings.agent_max_history)
    )
    messages = list(reversed(rows.scalars().all()))
    # Excluir placeholders en curso (contenido vacío)
    messages = [m for m in messages if (m.content or "").strip()]
    if not messages:
        return ""
    parts = ["\n\nHISTORIAL COMPLETO DE LA INVESTIGACIÓN (en orden cronológico):"]
    total = len(messages)
    recent_limit, older_limit, tail_cap = (
        (9000, 3000, 80000) if generous else (6000, 1200, 30000)
    )
    for idx, m in enumerate(messages):
        who = "Consultor" if m.role == "user" else "VEX Consulting IA"
        limit = recent_limit if idx >= total - 6 else older_limit
        parts.append(f"{who}: {(m.content or '')[:limit]}")
    transcript = "\n\n".join(parts)
    return transcript[-tail_cap:]


def _domain_denylist() -> list[str]:
    """Denylist de dominios de baja relevancia (formato Perplexity: prefijo '-')."""
    domains = [d.strip() for d in settings.perplexity_domain_denylist.split(",") if d.strip()]
    return [f"-{d}" for d in domains[:10]]  # la API acepta hasta ~10 entradas


def _apply_domain_policy(answer: str, citations: list[dict]) -> tuple[str, list[dict]]:
    """Post-filtrado de la política de dominios (defensa en profundidad, además
    del filtro nativo del API): elimina citas de dominios excluidos y sus
    enlaces en el texto (queda el texto plano)."""
    import re as _re
    from urllib.parse import urlparse

    deny = {d.strip().lower() for d in settings.perplexity_domain_denylist.split(",") if d.strip()}
    if not deny:
        return answer, citations

    def _denied(url: str) -> bool:
        try:
            host = (urlparse(url).netloc or "").lower().removeprefix("www.")
        except Exception:
            return False
        return any(host == d or host.endswith("." + d) for d in deny)

    citations = [c for c in citations if not _denied(c.get("url") or "")]

    def _strip_link(match: _re.Match) -> str:
        return match.group(1) if _denied(match.group(2)) else match.group(0)

    answer = _re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", _strip_link, answer or "")
    return answer, citations


async def _perplexity_research(user_prompt: str) -> tuple[str, list[dict], float]:
    """Investigación vía el Agent API de Perplexity (POST /v1/agent, multi-proveedor,
    tool web_search nativa). Fallback al /chat/completions clásico si no está
    disponible para la cuenta."""
    import httpx

    model = settings.perplexity_model
    if "/" not in model:
        model = f"perplexity/{model}"

    headers = {"Authorization": f"Bearer {settings.perplexity_api_key}"}
    body = {
        "model": model,
        "input": user_prompt,
        "instructions": _RESEARCH_SYSTEM,
        # El filtro va ANIDADO en `filters` (docs/api-reference/agent-post);
        # puesto directo en la tool el API lo ignora en silencio. fetch_url
        # permite al agente leer páginas completas (informes institucionales).
        "tools": [
            {"type": "web_search", "filters": {"search_domain_filter": _domain_denylist()}},
            {"type": "fetch_url"},
        ],
        "max_output_tokens": 6000,
    }
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(settings.perplexity_agent_url, headers=headers, json=body)
        if resp.status_code == 400:
            # Si esta cuenta/endpoint no acepta el filtro de dominios, reintentar sin él
            body["tools"] = [{"type": "web_search"}]
            resp = await client.post(settings.perplexity_agent_url, headers=headers, json=body)
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
                    "search_domain_filter": _domain_denylist(),
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
            return answer, citations, 0.0

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
    cost = 0.0
    try:
        cost = float(((data.get("usage") or {}).get("cost") or {}).get("total_cost") or 0)
    except Exception:
        pass
    answer, citations = _apply_domain_policy(answer, citations)
    return answer, citations, cost


import re as _re_mod

# Orquestador: pedidos de gráfico/visualización se enrutan al analista GPT,
# que trabaja con los datos ya presentes en el hilo (no vuelve a buscar).
_CHART_INTENT = _re_mod.compile(
    r"gr[aá]fic|chart|visualiz|diagrama|barras|torta|de\s+l[ií]neas|plot", _re_mod.IGNORECASE
)

_ANALYST_SYSTEM = (
    "Sos el analista senior de VEX Consulting, participando en el hilo de una "
    "investigación de mercado. Recibís el HISTORIAL COMPLETO de la conversación y "
    "un pedido del consultor (analizar, sintetizar, concluir, comparar, graficar). "
    "Respondé de forma DIRECTA y conversacional-profesional, como un colega senior: "
    "si pide conclusiones, tomá posición clara; si pide análisis del contexto, "
    "analizá TODO el hilo, no solo el último mensaje. Trabajás SOLO con los datos "
    "del historial y el contexto (no inventes cifras; si un dato viene en rango, "
    "usá el punto medio y aclaralo). Mantené las referencias [n] que ya trae el "
    "historial al citar cifras.\n"
    "Respondé SOLO con JSON válido:\n"
    "{\"analysis_md\": str,  // tu respuesta completa en Markdown: análisis, síntesis "
    "y/o conclusiones. Si un gráfico sustenta un punto, insertá el marcador "
    "[GRAFICO_1] (y [GRAFICO_2], [GRAFICO_3]) en el lugar exacto del texto.\n"
    " \"charts\": [{\"title\": str, \"type\": \"bar\"|\"line\", \"y_label\": str, "
    "\"series\": [{\"name\": str, \"points\": [{\"label\": str, \"value\": number}]}]}]"
    "  // 0 a 3 gráficos con datos del historial; [] si no aportan\n"
    "}\n"
    "Si el pedido requiere datos que el historial no tiene, decilo en analysis_md "
    "e indicá qué habría que investigar (charts: [])."
)

_ROUTER_SYSTEM = (
    "Sos el enrutador de un asistente de investigación. Decidí si el mensaje del "
    "consultor requiere BUSCAR INFORMACIÓN NUEVA en la web (respondé: web) o pide "
    "ANALIZAR/SINTETIZAR/CONCLUIR/GRAFICAR sobre lo ya conversado en el hilo "
    "(respondé: analisis). Ante la duda sobre datos externos nuevos: web. "
    "Respondé UNA sola palabra: web | analisis."
)


async def _route_query(query: str, history_tail: str) -> str:
    """Clasifica el turno: 'web' (investigación externa) o 'analisis' (trabajar
    sobre el hilo). Los pedidos explícitos de gráfico van directo a análisis."""
    if _CHART_INTENT.search(query):
        return "analisis"
    if not settings.openai_api_key:
        return "web"
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=30)
        resp = await client.chat.completions.create(
            model=settings.agent_model,
            max_completion_tokens=2000,
            messages=[
                {"role": "system", "content": _ROUTER_SYSTEM},
                {
                    "role": "user",
                    "content": f"Últimos intercambios del hilo:\n{history_tail[-1200:]}\n\n"
                    f"Mensaje del consultor: {query}",
                },
            ],
        )
        verdict = (resp.choices[0].message.content or "").strip().lower()
        return "analisis" if "analisis" in verdict or "análisis" in verdict else "web"
    except Exception:
        return "web"


async def _chart_task(
    query: str, history_block: str, context_block: str, project_id: str
) -> tuple[str, list[dict], float, str]:
    """Turno del analista integral: GPT analiza el HILO COMPLETO de forma
    conversacional y sustenta con 0-3 gráficos renderizados a SVG de marca."""
    import json as _json
    import uuid as _uuid

    from openai import AsyncOpenAI

    from ...services.agent.pricing import compute_cost_usd
    from ...services.chart_service import render_chart_svg, spec_to_markdown_table

    if not settings.openai_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "IA no configurada en el servidor")

    client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=180)
    resp = await client.chat.completions.create(
        model=settings.agent_model,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _ANALYST_SYSTEM},
            {
                "role": "user",
                "content": f"PEDIDO DEL CONSULTOR: {query}\n{history_block or '(sin historial)'}{context_block}",
            },
        ],
    )
    cost = 0.0
    if resp.usage:
        cost = compute_cost_usd(resp.usage.prompt_tokens or 0, resp.usage.completion_tokens or 0)

    try:
        data = _json.loads(resp.choices[0].message.content or "{}")
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "El analista no devolvió una respuesta válida")

    analysis = (data.get("analysis_md") or "").strip()
    charts = (data.get("charts") or [])[:3]

    images_dir = settings.upload_path / project_id / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    for i, spec in enumerate(charts, start=1):
        title = (spec.get("title") or f"Gráfico {i}").strip()
        try:
            svg = render_chart_svg(spec)
        except Exception:
            continue  # un gráfico fallido no tumba el análisis
        name = f"chart-{_uuid.uuid4().hex[:12]}.svg"
        (images_dir / name).write_text(svg, encoding="utf-8")
        url = f"/api/v1/projects/{project_id}/images/{name}"
        table = spec_to_markdown_table(spec)
        block_parts = [f"![{title}]({url})"]
        if table:
            block_parts += ["", "<details><summary>Datos del gráfico</summary>", "", table, "", "</details>"]
        block = "\n".join(block_parts)

        marker = f"[GRAFICO_{i}]"
        if marker in analysis:
            analysis = analysis.replace(marker, block)
        else:
            analysis += f"\n\n### {title}\n\n{block}"

    if not analysis:
        analysis = "No pude producir el análisis con el contenido disponible del hilo."
    return analysis.strip(), [], cost, "analista"


async def _project_grounding(
    db: AsyncSession, project_id: str, query: str,
    attachment_source_ids: list[str] | None = None,
    focus_source_ids: list[str] | None = None,
) -> str:
    from sqlalchemy import select as _select

    from ...models.document import Document
    from ...models.source import Source
    from ...models.source_chunk import SourceChunk
    from ...services.rag.retriever import format_citation, search_chunks

    parts: list[str] = []

    # Estado actual del informe: el agente entra con el contexto ya cargado
    # (esquema + inicio); el texto completo sigue disponible por tool.
    try:
        doc = (await db.execute(
            _select(Document).where(Document.project_id == project_id)
        )).scalar_one_or_none()
        if doc and (doc.content_md or "").strip():
            outline = [ln.strip() for ln in doc.content_md.splitlines() if ln.startswith("#")][:30]
            parts.append(
                f"ESTADO ACTUAL DEL INFORME ({doc.word_count} palabras). Esquema:\n"
                + "\n".join(outline)
                + "\n\nInicio del informe:\n" + doc.content_md[:1800]
                + "\n(…texto completo disponible con `leer_documento_maestro`)"
            )
    except Exception:
        pass

    # Catálogo: el investigador conoce la base de conocimiento del proyecto
    try:
        catalog = await db.execute(
            _select(Source.title).where(
                Source.project_id == project_id, Source.status == "ready"
            ).limit(20)
        )
        titles = [t for (t,) in catalog]
        if titles:
            parts.append(
                "FUENTES INTERNAS DISPONIBLES EN EL PROYECTO: " + " · ".join(titles)
            )
    except Exception:
        pass

    # Material adjuntado explícitamente en esta consulta: entra COMPLETO (con tope)
    if attachment_source_ids:
        try:
            rows = await db.execute(
                _select(SourceChunk, Source.title)
                .join(Source, Source.id == SourceChunk.source_id)
                .where(
                    SourceChunk.source_id.in_(attachment_source_ids[:5]),
                    SourceChunk.project_id == project_id,
                )
                .order_by(SourceChunk.source_id, SourceChunk.chunk_index)
            )
            budget = 9000
            attached_parts = []
            for chunk, title in rows:
                if budget <= 0:
                    break
                fragment = chunk.content[:budget]
                attached_parts.append(f"[{title}]\n{fragment}")
                budget -= len(fragment)
            if attached_parts:
                parts.append(
                    "MATERIAL ADJUNTADO POR EL CONSULTOR EN ESTA CONSULTA (analizalo y citalo):\n"
                    + "\n\n".join(attached_parts)
                )
        except Exception:
            pass

    # Fuentes citadas con @: entran con prioridad y restringen la base interna
    if focus_source_ids:
        try:
            rows = await db.execute(
                _select(SourceChunk, Source.title)
                .join(Source, Source.id == SourceChunk.source_id)
                .where(
                    SourceChunk.source_id.in_(focus_source_ids[:6]),
                    SourceChunk.project_id == project_id,
                )
                .order_by(SourceChunk.source_id, SourceChunk.chunk_index)
            )
            budget = 8000
            focus_parts = []
            for chunk, title in rows:
                if budget <= 0:
                    break
                fragment = chunk.content[:budget]
                focus_parts.append(f"[{title}]\n{fragment}")
                budget -= len(fragment)
            if focus_parts:
                parts.append(
                    "FUENTES CITADAS CON @ POR EL CONSULTOR — la investigación sobre la "
                    "base interna debe basarse EXCLUSIVAMENTE en estas fuentes (la tool "
                    "`buscar_fuentes_internas` ya viene restringida a ellas):\n"
                    + "\n\n".join(focus_parts)
                )
        except Exception:
            pass

    # Fragmentos afines a la consulta (RAG híbrido; con @ se restringe a las citadas)
    try:
        chunks = await search_chunks(
            db, project_id, query, k=24 if focus_source_ids else 6
        )
        if focus_source_ids:
            allowed = set(focus_source_ids)
            chunks = [c for c in chunks if c.get("source_id") in allowed][:6]
        if chunks:
            parts.append(
                "FRAGMENTOS DE FUENTES INTERNAS AFINES A LA CONSULTA (citá con el formato dado):\n"
                + "\n\n".join(f"{format_citation(c)}\n{c['content'][:800]}" for c in chunks)
            )
    except Exception:
        pass

    return ("\n\n" + "\n\n".join(parts)) if parts else ""


@router.post("/projects/{project_id}/agent/research")
async def research(
    project_id: str,
    payload: ResearchRequest,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """«VEX Consulting IA»: investigador experto con memoria de hilo (30 mensajes).
    Motores: Perplexity Agent API (principal) u OpenAI web_search (tradicional).
    Cada intercambio se persiste en una conversación agent_type='investigacion'."""
    # Hilo de investigación: cargar o crear
    conversation: Conversation | None = None
    if payload.conversation_id:
        conversation = await db.get(Conversation, payload.conversation_id)
        if (
            not conversation
            or conversation.project_id != project_id
            or conversation.user_id != access.user.id
            or conversation.agent_type != "investigacion"
        ):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Hilo de investigación no encontrado")
    if conversation is None:
        conversation = Conversation(
            user_id=access.user.id,
            project_id=project_id,
            agent_type="investigacion",
            role_slug=payload.engine,
            title=payload.query[:60],
        )
        db.add(conversation)
        await db.flush()

    if not conversation.title:
        conversation.title = payload.query[:60]

    # Registro INMEDIATO: la consulta y un placeholder quedan en el hilo, y la
    # investigación corre en segundo plano en el servidor — el consultor puede
    # navegar a cualquier parte de la aplicación sin perder el trabajo.
    db.add(Message(conversation_id=conversation.id, role="user", content=payload.query))
    placeholder = Message(
        conversation_id=conversation.id,
        role="assistant",
        content="",
        tool_calls={"status": "running", "engine": payload.engine},
    )
    db.add(placeholder)
    conversation.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(placeholder)

    asyncio.create_task(_run_research_job(
        message_id=placeholder.id,
        conversation_id=conversation.id,
        project_id=project_id,
        project_name=access.project.name,
        query=payload.query,
        engine=payload.engine,
        rigor=payload.rigor,
        context_text=payload.context_text,
        attachment_ids=payload.attachment_source_ids,
        focus_ids=payload.focus_source_ids,
        user_info={
            "id": access.user.id, "email": access.user.email,
            "role": access.user.role, "name": access.user.full_name,
        },
        ip=client_ip(request),
    ))
    return {
        "conversation_id": conversation.id,
        "message_id": placeholder.id,
        "status": "running",
    }


async def _run_research_job(
    *, message_id: str, conversation_id: str, project_id: str, project_name: str,
    query: str, engine: str, rigor: str, context_text: str | None,
    attachment_ids: list[str] | None, user_info: dict, ip: str,
    focus_ids: list[str] | None = None,
) -> None:
    """Trabajo de investigación en segundo plano (sobrevive a la navegación).

    El agente principal (GPT) orquesta con sus tools: Perplexity (general o
    académico), fuentes internas (RAG), documento maestro y generador de
    gráficos — él decide qué usar en cada turno."""
    answer = ""
    unique_citations: list[dict] = []
    cost_usd = 0.0
    cost_breakdown: dict = {}
    engine_used = "vex"
    error: str | None = None

    try:
        async with session_scope() as db:
            history_block = await _load_research_history(db, conversation_id, generous=True)
            grounding = await _project_grounding(
                db, project_id, query, attachment_ids, focus_ids
            )
        context_block = (
            f"\n\nCONTEXTO DEL DOCUMENTO EN EDICIÓN:\n{context_text[-4000:]}"
            if context_text else ""
        )
        user_prompt = (
            f"PEDIDO DEL CONSULTOR: {query}{history_block}{context_block}{grounding}"
        )

        from ...services.agent.researcher import run_researcher

        answer, citations, cost_usd, cost_breakdown = await run_researcher(
            project_name=project_name,
            project_id=project_id,
            user_id=user_info["id"],
            user_name=user_info.get("name") or "consultor",
            prompt=user_prompt,
            rigor=rigor,
            focus_source_ids=focus_ids,
        )
        if not answer:
            raise RuntimeError("El investigador no produjo respuesta")

        # Fallback: enlaces markdown de la respuesta como citas
        if not citations and answer:
            import re as _re

            for title, url in _re.findall(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", answer):
                citations.append({"url": url, "title": title})

        seen: set[str] = set()
        for c in citations:
            url = c.get("url") or ""
            if url and url not in seen:
                seen.add(url)
                unique_citations.append(c)

        answer = _clean_answer(answer)
        answer = _linkify_citations(answer, unique_citations)
    except HTTPException as exc:
        error = str(exc.detail)
    except Exception as exc:  # noqa: BLE001
        logger.exception("research job %s falló", message_id)
        error = f"Error inesperado: {str(exc)[:300]}"

    try:
        async with session_scope() as db:
            message = await db.get(Message, message_id)
            if not message:
                return
            if error:
                message.content = f"**La investigación falló:** {error}"
                message.tool_calls = {"status": "failed", "engine": engine_used}
            else:
                message.content = answer
                message.tool_calls = {
                    "status": "done", "citations": unique_citations, "engine": engine_used,
                    # Desglose por proveedor/modelo para el tracking de gasto IA
                    "model": cost_breakdown.get("model"),
                    "cost_openai": cost_breakdown.get("openai"),
                    "cost_perplexity": cost_breakdown.get("perplexity"),
                }
                message.cost_usd = cost_usd or None
            conversation = await db.get(Conversation, conversation_id)
            if conversation:
                conversation.updated_at = datetime.now(timezone.utc)
            await log_action(
                db, user_id=user_info["id"], user_email=user_info.get("email"),
                user_role=user_info.get("role"), action="agent.research",
                project_id=project_id, entity_type="research", entity_id=conversation_id,
                detail={"engine": engine_used, "query": query[:120],
                        "status": "failed" if error else "done"},
                ip=ip, commit=False,
            )
            await db.commit()
    except Exception:
        logger.exception("research job %s: no se pudo persistir el resultado", message_id)
