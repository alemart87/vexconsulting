"""Worker del modo automático: el agente planifica, investiga con sus tools
(RAG del proyecto + web + Perplexity sobre gpt-5.6) e inserta el resultado en
el documento maestro como versión nueva.

Arquitectura pensada para Render: el trabajo vive acá (cola en DB + worker),
NUNCA en una conexión HTTP del navegador. El cliente solo hace polls cortos.
Mientras corre, el agente sostiene el lock del documento (el mismo lock
blando que usa la edición humana): nadie puede escribir hasta que termine.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy import select, update

from ..core.config import settings
from ..core.database import session_scope
from ..models.auto_mission import AutoMission
from ..models.conversation import Conversation, Message
from ..models.document import Document
from ..models.project import Project
from ..services import document_service
from ..services.agent.pricing import compute_cost_usd

logger = logging.getLogger("vexconsulting")

_signal = asyncio.Event()

MISSION_TIMEOUT = 30 * 60  # tope duro: nada queda «corriendo» para siempre
PREP_TIMEOUT = 60          # tomar el lock y abrir el hilo son 4 queries: 1 min máximo
PLAN_TIMEOUT = 180         # la planificación es UNA llamada corta: 3 min máximo
TASK_TIMEOUT = 10 * 60     # tope por investigación individual
INTEGRATE_TIMEOUT = 300    # tope de la integración (con fallback determinista)
HEARTBEAT_DEAD = 150       # latido más viejo que esto = motor muerto → se recupera solo
MAX_TASKS = 6
MAX_EVENTS = 80            # historial de actividad que guarda cada misión


def signal_auto_queue() -> None:
    _signal.set()


def _agent_lock_id(mission_id: str) -> str:
    return f"auto:{mission_id}"


async def recover_stale_auto() -> None:
    """Tras un reinicio: misiones running → failed y locks del agente liberados."""
    async with session_scope() as db:
        rows = (await db.execute(
            select(AutoMission).where(AutoMission.status.in_(["running", "cancelling"]))
        )).scalars().all()
        for m in rows:
            m.status = "failed"
            m.last_error = "Interrumpido por reinicio del servidor. Relanzá la investigación."
            m.finished_at = datetime.now(timezone.utc)
            await _release_agent_lock(db, m.project_id, m.id)
        await db.commit()


async def _release_agent_lock(db, project_id: str, mission_id: str) -> None:
    doc = (await db.execute(
        select(Document).where(Document.project_id == project_id)
    )).scalar_one_or_none()
    if doc and doc.lock_user_id == _agent_lock_id(mission_id):
        doc.lock_user_id = None
        doc.lock_user_name = None
        doc.lock_expires_at = None


async def _renew_lock_loop(project_id: str, mission_id: str) -> None:
    """Renueva el lock del agente y el latido cada 15 s mientras la misión corre.
    Si el latido deja de moverse, la UI lo muestra y el endpoint de cancelar
    permite forzar el corte: nunca más un «colgado» sin salida."""
    while True:
        await asyncio.sleep(15)
        try:
            now = datetime.now(timezone.utc)
            async with session_scope() as db:
                await db.execute(
                    update(Document)
                    .where(
                        Document.project_id == project_id,
                        Document.lock_user_id == _agent_lock_id(mission_id),
                    )
                    .values(lock_expires_at=now + timedelta(seconds=90))
                )
                await db.execute(
                    update(AutoMission).where(AutoMission.id == mission_id)
                    .values(heartbeat_at=now)
                )
                await db.commit()
        except Exception:  # pragma: no cover
            logger.warning("No se pudo renovar el lock del modo automático %s", mission_id[:8])


async def _note(mission_id: str, text: str) -> None:
    """Deja registrada la sub-etapa EXACTA (visible en la UI) y en los logs, y
    la acumula en el feed de actividad `events` — la UI muestra el historial en
    vivo, estilo Claude Code. Si algo se cuelga, la nota dice dónde."""
    logger.info("auto %s · %s", mission_id[:8], text)
    try:
        now = datetime.now(timezone.utc)
        async with session_scope() as db:
            events = (await db.execute(
                select(AutoMission.events).where(AutoMission.id == mission_id)
            )).scalar_one_or_none() or []
            events = (list(events) + [{"t": now.isoformat(), "text": text}])[-MAX_EVENTS:]
            await db.execute(
                update(AutoMission).where(AutoMission.id == mission_id)
                .values(stage_note=text, heartbeat_at=now, events=events)
            )
            await db.commit()
    except Exception:  # pragma: no cover
        logger.warning("No se pudo anotar la etapa de la misión %s", mission_id[:8])


async def _claim_next() -> tuple[str, str] | None:
    """Toma la próxima misión pendiente. Devuelve (mission_id, project_id)."""
    async with session_scope() as db:
        result = await db.execute(
            select(AutoMission).where(AutoMission.status == "pending")
            .order_by(AutoMission.created_at).limit(1)
        )
        mission = result.scalar_one_or_none()
        if not mission:
            return None

        # Si un humano tiene el lock activo, la misión espera en cola.
        doc = (await db.execute(
            select(Document).where(Document.project_id == mission.project_id)
        )).scalar_one_or_none()
        if doc and doc.lock_user_id and doc.lock_expires_at:
            expires = doc.lock_expires_at
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires > datetime.now(timezone.utc) and not str(doc.lock_user_id).startswith("auto:"):
                mission.stage_note = (
                    f"En cola: {doc.lock_user_name or 'otro usuario'} está editando "
                    "el documento — arranca en cuanto lo libere."
                )
                await db.commit()
                return None  # reintenta en el próximo tick del worker

        claimed = await db.execute(
            update(AutoMission)
            .where(AutoMission.id == mission.id, AutoMission.status == "pending")
            .values(status="running", started_at=datetime.now(timezone.utc),
                    heartbeat_at=datetime.now(timezone.utc))
        )
        await db.commit()
        return (mission.id, mission.project_id) if claimed.rowcount else None


def _parse_json(text: str) -> dict:
    match = re.search(r"\{.*\}", (text or "").strip(), re.DOTALL)
    if not match:
        raise ValueError("El planificador no devolvió JSON")
    return json.loads(match.group(0))


def _doc_outline(md: str) -> str:
    heads = [l.strip() for l in (md or "").splitlines() if l.strip().startswith("#")]
    return "\n".join(heads[:40])


async def _plan_tasks(brief: str, project_name: str, doc_md: str) -> tuple[list[dict], float]:
    """El planificador convierte el brief en 2-6 tareas. Devuelve (tareas, costo)."""
    from openai import AsyncOpenAI

    # Timeout explícito: el default de la librería (600 s × reintentos) dejaba
    # misiones colgadas media hora en «Planificación» ante fallas de red.
    client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=90, max_retries=1)
    kwargs: dict = dict(
        model=settings.agent_model,
        response_format={"type": "json_object"},
        # Planificar es armar un JSON corto: con esfuerzo de razonamiento alto
        # el modelo se queda «pensando» minutos. Bajo = respuesta en segundos.
        reasoning_effort="low",
        messages=[
            {
                "role": "system",
                "content": (
                    "Sos el planificador del modo automático de una plataforma de "
                    "investigación. Convertí el pedido del consultor en un plan de 2 a "
                    f"{MAX_TASKS} tareas de investigación CONCRETAS y complementarias "
                    "(sin solaparse). Cada tarea indica en qué sección del documento se "
                    "insertará su resultado (usá los títulos existentes del esquema si "
                    "corresponde). Respondé SOLO JSON: "
                    '{"tareas":[{"titulo":"<corto>","consulta":"<instrucción completa '
                    'para el investigador, con qué datos buscar y cómo presentarlos>",'
                    '"seccion":"<título de sección destino>"}]}'
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Proyecto: {project_name}\n\nEsquema actual del documento:\n"
                    f"{_doc_outline(doc_md)}\n\nPedido del consultor:\n{brief}"
                ),
            },
        ],
    )
    try:
        resp = await client.chat.completions.create(**kwargs)
    except Exception as exc:
        # Si el modelo configurado no acepta reasoning_effort, reintento sin él
        if "reasoning" not in str(exc).lower():
            raise
        kwargs.pop("reasoning_effort", None)
        resp = await client.chat.completions.create(**kwargs)
    data = _parse_json(resp.choices[0].message.content or "")
    tareas = [t for t in data.get("tareas", []) if t.get("consulta")][:MAX_TASKS]
    if not tareas:
        raise ValueError("El planificador no propuso tareas")
    usage = getattr(resp, "usage", None)
    cached = int(getattr(getattr(usage, "prompt_tokens_details", None), "cached_tokens", 0) or 0)
    plan_cost = compute_cost_usd(
        int(getattr(usage, "prompt_tokens", 0) or 0),
        int(getattr(usage, "completion_tokens", 0) or 0),
        cached,
    )
    return [
        {
            "titulo": str(t.get("titulo") or f"Tarea {i + 1}")[:120],
            "consulta": str(t["consulta"])[:2000],
            "seccion": str(t.get("seccion") or "")[:200],
            "status": "pending",
        }
        for i, t in enumerate(tareas)
    ], plan_cost


def _insert_into_md(doc_md: str, seccion: str, titulo: str, body: str) -> str:
    """Inserta el bloque al FINAL de la sección destino; si no existe la
    sección, lo agrega al final del documento. Determinista: nada de que un
    modelo reescriba el documento entero."""
    block = f"\n\n### {titulo}\n\n{body.strip()}\n"
    lines = doc_md.splitlines()
    target = (seccion or "").strip().lower()
    if target:
        start = None
        level = 0
        for i, line in enumerate(lines):
            m = re.match(r"^(#{1,4})\s+(.*)$", line.strip())
            if m and target in m.group(2).strip().lower():
                start = i
                level = len(m.group(1))
                break
        if start is not None:
            end = len(lines)
            for j in range(start + 1, len(lines)):
                m = re.match(r"^(#{1,4})\s+", lines[j].strip())
                if m and len(m.group(1)) <= level:
                    end = j
                    break
            return "\n".join(lines[:end]).rstrip() + block + "\n" + "\n".join(lines[end:])
    return doc_md.rstrip() + block


async def _check_cancelled(mission_id: str) -> bool:
    async with session_scope() as db:
        st = (await db.execute(
            select(AutoMission.status).where(AutoMission.id == mission_id)
        )).scalar_one_or_none()
        return st == "cancelling"


async def _set_steps(mission_id: str, steps: list[dict], current: int) -> None:
    async with session_scope() as db:
        await db.execute(
            update(AutoMission).where(AutoMission.id == mission_id)
            .values(steps=steps, current_step=current)
        )
        await db.commit()


async def _force_status(mission_id: str, status: str, error: str | None) -> None:
    """Última línea de defensa: si el cierre normal falla (DB con hipo), la
    misión NO puede quedar «running» para siempre. Escritura mínima y directa:
    estado + error + lock del documento liberado."""
    from ..models.document import Document as _Doc

    try:
        from ..core.database import engine

        async with engine.begin() as conn:
            await conn.execute(
                update(AutoMission).where(AutoMission.id == mission_id)
                .values(status=status, last_error=error,
                        finished_at=datetime.now(timezone.utc))
            )
            await conn.execute(
                update(_Doc).where(_Doc.lock_user_id == _agent_lock_id(mission_id))
                .values(lock_user_id=None, lock_user_name=None, lock_expires_at=None)
            )
    except Exception:  # pragma: no cover
        logger.exception("Ni el cierre forzado pudo escribir la misión %s", mission_id[:8])


async def _finish(mission_id: str, *, status: str, result: dict | None = None,
                  error: str | None = None) -> None:
    try:
        await _finish_inner(mission_id, status=status, result=result, error=error)
    except Exception:
        logger.exception("El cierre de la misión %s falló — cierre forzado", mission_id[:8])
        await _force_status(mission_id, status, error)


async def _finish_inner(mission_id: str, *, status: str, result: dict | None = None,
                        error: str | None = None) -> None:
    async with session_scope() as db:
        mission = await db.get(AutoMission, mission_id)
        if not mission:
            return
        mission.status = status
        finished = datetime.now(timezone.utc)
        if result is not None and mission.started_at:
            started = mission.started_at
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            result = {**result, "duracion_seg": int((finished - started).total_seconds())}
        mission.result = result
        mission.last_error = error
        mission.finished_at = finished
        await _release_agent_lock(db, mission.project_id, mission_id)

        # Campana al solicitante
        try:
            from ..services.notification_service import notify

            link = f"/projects/{mission.project_id}/document"
            if status == "done":
                dur = (result or {}).get("duracion_seg") or 0
                title = (
                    f"Investigación automática lista · versión "
                    f"{(result or {}).get('version_number', '?')}"
                )
                body = (
                    f"{(result or {}).get('tareas', 0)} investigaciones insertadas, "
                    f"+{(result or {}).get('palabras_agregadas', 0)} palabras, "
                    f"en {dur // 60} min {dur % 60} s."
                )
            elif status == "cancelled":
                title = "Investigación automática cancelada"
                body = "El documento quedó liberado, sin cambios."
            else:
                title = "La investigación automática falló"
                body = (error or "")[:200]
            await notify(
                db, recipients={mission.requested_by}, project_id=mission.project_id,
                kind="auto", title=title, body=body, link=link, entity_id=mission_id,
                actor_name="Modo automático",
            )
        except Exception:  # pragma: no cover
            logger.warning("No se pudo notificar la misión %s", mission_id[:8])
        await db.commit()


async def _log_step_messages(conversation_id: str | None, consulta: str,
                             answer: str, citations: list, usage_cost: float,
                             breakdown: dict) -> None:
    """Cada paso queda en el hilo del investigador → Costos IA lo agrega solo."""
    if not conversation_id:
        return
    async with session_scope() as db:
        db.add(Message(conversation_id=conversation_id, role="user", content=consulta))
        db.add(Message(
            conversation_id=conversation_id, role="assistant", content=answer,
            tool_calls={
                "status": "done", "engine": "vex", "citations": citations,
                "auto": True,
                "cost_openai": breakdown.get("openai", 0.0),
                "cost_perplexity": breakdown.get("perplexity", 0.0),
                "model": breakdown.get("model"),
            },
            cost_usd=usage_cost,
        ))
        conv = await db.get(Conversation, conversation_id)
        if conv:
            conv.updated_at = datetime.now(timezone.utc)
        await db.commit()


async def _prepare(mission_id: str) -> dict | None:
    """Toma el lock del documento y abre el hilo de trazabilidad (4 queries)."""
    async with session_scope() as db:
        mission = await db.get(AutoMission, mission_id)
        if not mission:
            return None
        project = await db.get(Project, mission.project_id)
        doc = await document_service.get_or_create_document(db, mission.project_id)

        # El agente toma el lock del documento (nadie escribe mientras corre)
        doc.lock_user_id = _agent_lock_id(mission_id)
        doc.lock_user_name = "🤖 Investigación automática"
        doc.lock_expires_at = datetime.now(timezone.utc) + timedelta(seconds=90)

        # Hilo del investigador para trazabilidad y costos
        conv = Conversation(
            user_id=mission.requested_by, project_id=mission.project_id,
            agent_type="investigacion", title=f"⚡ Auto · {mission.brief[:52]}",
        )
        db.add(conv)
        await db.flush()
        mission.conversation_id = conv.id
        await db.commit()
        return {
            "project_id": mission.project_id,
            "project_name": project.name if project else "Proyecto",
            "brief": mission.brief,
            "requested_by": mission.requested_by,
            "requested_by_name": mission.requested_by_name or "consultor",
            "doc_md": doc.content_md or "",
            "conversation_id": conv.id,
        }


async def _process(mission_id: str, project_id: str) -> None:
    from ..services.agent.researcher import run_researcher

    # El latido arranca ANTES que cualquier trabajo: desde el segundo cero la
    # UI sabe si el motor está vivo (antes arrancaba después de la preparación,
    # y un cuelgue ahí parecía un motor muerto sin serlo… o lo era y no se sabía).
    renewer = asyncio.create_task(_renew_lock_loop(project_id, mission_id))
    try:
        await _note(mission_id, "Preparando: tomando el documento y abriendo el hilo de trazabilidad.")
        try:
            prep = await asyncio.wait_for(_prepare(mission_id), timeout=PREP_TIMEOUT)
        except asyncio.TimeoutError:
            raise ValueError(
                "No se pudo tomar el documento en 1 minuto: la base de datos no "
                "respondió o el documento quedó trabado por otra conexión. "
                "Relanzá la investigación; si se repite, avisá al administrador."
            )
        if not prep:
            return
        project_name = prep["project_name"]
        brief = prep["brief"]
        requested_by = prep["requested_by"]
        requested_by_name = prep["requested_by_name"]
        doc_md = prep["doc_md"]
        conversation_id = prep["conversation_id"]
        # 1) PLAN (su costo también queda registrado para Costos IA)
        await _note(mission_id, "Planificando: convirtiendo el pedido en tareas (una llamada a OpenAI, tope 3 min).")
        try:
            steps, plan_cost = await asyncio.wait_for(
                _plan_tasks(brief, project_name, doc_md), timeout=PLAN_TIMEOUT
            )
        except asyncio.TimeoutError:
            raise ValueError(
                "La planificación no respondió en 3 minutos (demora transitoria "
                "de OpenAI o de red). Relanzá la investigación."
            )
        await _set_steps(mission_id, steps, 0)
        await _note(
            mission_id,
            f"Plan listo: {len(steps)} tareas — " + " · ".join(s["titulo"] for s in steps),
        )
        await _log_step_messages(
            conversation_id,
            "[Plan] Convertir el pedido en tareas de investigación.",
            "[Plan] " + " · ".join(s["titulo"] for s in steps),
            [], plan_cost,
            {"openai": plan_cost, "perplexity": 0.0, "model": settings.agent_model},
        )

        # 2) INVESTIGAR cada tarea (secuencial: es una cola, no una estampida)
        total_cost = plan_cost
        total_citas = 0
        results: list[dict] = []
        for i, step in enumerate(steps):
            if await _check_cancelled(mission_id):
                await _finish(mission_id, status="cancelled")
                return
            steps[i] = {**step, "status": "running"}
            await _set_steps(mission_id, steps, i)
            await _note(
                mission_id,
                f"Investigando tarea {i + 1} de {len(steps)}: «{step['titulo']}» (tope 10 min).",
            )

            prompt = (
                f"MODO AUTOMÁTICO — investigás para insertar directo en el informe "
                f"«{project_name}», sección «{step['seccion'] or 'nueva sección'}».\n"
                f"Pedido general del consultor: {brief}\n\n"
                f"Tu tarea concreta: {step['consulta']}\n\n"
                "Entregá SOLO el texto final listo para el documento (markdown, con "
                "las citas de tus fuentes). Sin preámbulos ni preguntas."
            )
            task_tag = f"Tarea {i + 1}/{len(steps)}"

            async def _task_activity(text: str, _tag: str = task_tag) -> None:
                await _note(mission_id, f"{_tag} · {text}")

            try:
                answer, citations, cost, breakdown = await asyncio.wait_for(
                    run_researcher(
                        project_name=project_name, project_id=project_id,
                        user_id=requested_by, user_name=requested_by_name,
                        prompt=prompt, on_activity=_task_activity,
                    ),
                    timeout=TASK_TIMEOUT,
                )
            except asyncio.TimeoutError:
                raise ValueError(
                    f"La tarea «{step['titulo']}» superó los 10 minutos y se "
                    "canceló. Acotá el pedido y reintentá."
                )
            if not (answer or "").strip():
                raise ValueError(f"La tarea «{step['titulo']}» no devolvió contenido")
            total_cost += cost
            total_citas += len(citations or [])
            results.append({**step, "answer": answer})
            await _log_step_messages(
                conversation_id, step["consulta"], answer, citations or [], cost, breakdown,
            )
            steps[i] = {
                **step, "status": "done",
                "citas": len(citations or []),
                "palabras": document_service.count_words(answer),
            }
            await _set_steps(mission_id, steps, i + 1)
            await _note(
                mission_id,
                f"✓ Tarea {i + 1}/{len(steps)} lista: «{step['titulo']}» "
                f"({steps[i]['palabras']} palabras, {steps[i]['citas']} citas).",
            )

        # 3) INTEGRAR con criterio: el agente editor decide dónde va cada
        # hallazgo dentro de la estructura existente (fallback determinista)
        await _note(mission_id, "Integrando los hallazgos en el documento (tope 5 min).")
        async with session_scope() as db:
            doc = await document_service.get_or_create_document(db, project_id)
            current_md = doc.content_md or ""

        new_md = current_md
        try:
            from ..services.agent.integrator import apply_ops, plan_integration

            combined = "\n\n".join(
                f"## {r['titulo']}\n(Sección sugerida: {r['seccion'] or 'a criterio'})\n\n{r['answer']}"
                for r in results
            )
            ops, integration_summary, int_cost, int_breakdown = await asyncio.wait_for(
                plan_integration(current_md, combined, hint=brief),
                timeout=INTEGRATE_TIMEOUT,
            )
            new_md, _secs = apply_ops(current_md, ops)
            total_cost += int_cost
            await _log_step_messages(
                conversation_id,
                "[Integración] Editar el documento con criterio e insertar los hallazgos donde corresponden.",
                f"[Integración en el documento] {integration_summary or ''} · "
                f"secciones: {', '.join(_secs) or '—'}",
                [], int_cost,
                {"openai": int_cost, "perplexity": 0.0, "model": int_breakdown.get("model")},
            )
        except Exception:
            logger.exception(
                "Integrador falló en misión %s — inserción determinista", mission_id[:8]
            )
            for r in results:
                new_md = _insert_into_md(new_md, r["seccion"], r["titulo"], r["answer"])

        # 4) GUARDAR como versión nueva (autoría del agente, revisable)
        await _note(mission_id, "Guardando la versión nueva del documento.")
        async with session_scope() as db:
            doc = await document_service.get_or_create_document(db, project_id)
            author = SimpleNamespace(
                id=_agent_lock_id(mission_id),
                full_name=f"Investigación automática · pedida por {requested_by_name}",
                is_superadmin=False,
            )
            version = await document_service.save_document(
                db, doc, author, content_md=new_md, base_version_id=None,
                summary=f"Modo automático: {brief[:120]}", force=True,
            )
            version_number = version.version_number
            words_added = version.words_added

        await _finish(mission_id, status="done", result={
            "version_number": version_number,
            "tareas": len(results),
            "palabras_agregadas": words_added,
            "citas": total_citas,
            "cost_usd": round(total_cost, 4),
        })
        logger.info("Modo automático %s OK (v%s, %d tareas, USD %.4f)",
                    mission_id[:8], version_number, len(results), total_cost)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Modo automático %s falló", mission_id[:8])
        await _finish(mission_id, status="failed",
                      error=f"La investigación automática falló: {str(exc)[:400]}")
    finally:
        renewer.cancel()


async def _abort(proc: asyncio.Task) -> None:
    proc.cancel()
    try:
        await proc
    except (asyncio.CancelledError, Exception):  # noqa: BLE001
        pass


async def _heartbeat_dead(mission_id: str) -> bool:
    """True si el latido en DB quedó más viejo que HEARTBEAT_DEAD segundos."""
    try:
        async with session_scope() as db:
            hb = (await db.execute(
                select(AutoMission.heartbeat_at).where(AutoMission.id == mission_id)
            )).scalar_one_or_none()
        if hb is None:
            return False
        if hb.tzinfo is None:
            hb = hb.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - hb).total_seconds() > HEARTBEAT_DEAD
    except Exception:  # pragma: no cover — si la DB no responde, no decidimos acá
        return False


async def reap_zombie_missions() -> None:
    """Auto-recuperación: cualquier misión «running»/«cancelling» cuyo latido
    murió (worker caído, tarea perdida, conexión colgada) pasa a failed y el
    documento queda liberado — sin esperar a que un humano toque «Forzar corte»."""
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=HEARTBEAT_DEAD)
        async with session_scope() as db:
            rows = (await db.execute(
                select(AutoMission).where(AutoMission.status.in_(["running", "cancelling"]))
            )).scalars().all()
            for m in rows:
                hb = m.heartbeat_at or m.started_at or m.created_at
                if hb is not None and hb.tzinfo is None:
                    hb = hb.replace(tzinfo=timezone.utc)
                if hb is not None and hb >= cutoff:
                    continue
                logger.warning("Misión zombie %s (latido muerto) → recuperada", m.id[:8])
                m.status = "cancelled" if m.status == "cancelling" else "failed"
                m.last_error = (
                    "El motor dejó de dar señales y la misión se recuperó sola. "
                    "El documento quedó liberado — relanzá la investigación."
                )
                m.finished_at = datetime.now(timezone.utc)
                await _release_agent_lock(db, m.project_id, m.id)
            await db.commit()
    except Exception:  # pragma: no cover
        logger.warning("El reaper de misiones zombie no pudo revisar la cola")


async def _watch_mission(mission_id: str, project_id: str) -> None:
    """Corre la misión con un vigilante en paralelo: el botón Cancelar corta
    AL INSTANTE (aunque el worker esté dentro de una llamada a OpenAI, que era
    donde antes quedaba sordo), el tope de 30 minutos se aplica acá, y si el
    propio latido muere (DB colgada) la misión se corta en vez de quedar eterna."""
    proc = asyncio.create_task(_process(mission_id, project_id))
    started = asyncio.get_running_loop().time()
    while True:
        done, _ = await asyncio.wait({proc}, timeout=5)
        if done:
            if not proc.cancelled() and proc.exception():
                logger.error("Error en misión %s", mission_id, exc_info=proc.exception())
                await _finish(mission_id, status="failed",
                              error=f"La investigación automática falló: "
                                    f"{str(proc.exception())[:300]}")
            return
        if await _check_cancelled(mission_id):
            await _abort(proc)
            await _finish(mission_id, status="cancelled")
            return
        elapsed = asyncio.get_running_loop().time() - started
        if elapsed > MISSION_TIMEOUT:
            await _abort(proc)
            await _finish(mission_id, status="failed",
                          error="Superó los 30 minutos y se canceló. Acotá el pedido y reintentá.")
            return
        if elapsed > HEARTBEAT_DEAD and await _heartbeat_dead(mission_id):
            await _abort(proc)
            await _finish(mission_id, status="failed",
                          error="El motor quedó sin latido (base de datos o red colgada) "
                                "y la misión se cortó sola. Relanzá la investigación.")
            return


async def auto_worker() -> None:
    logger.info("auto_worker iniciado")
    while True:
        await reap_zombie_missions()
        claimed = await _claim_next()
        if claimed:
            mission_id, project_id = claimed
            try:
                await _watch_mission(mission_id, project_id)
            except Exception:
                logger.exception("Error en misión %s", mission_id)
                await _force_status(
                    mission_id, "failed",
                    "El vigilante de la misión falló de forma inesperada. Relanzá la investigación.",
                )
            continue
        _signal.clear()
        try:
            await asyncio.wait_for(_signal.wait(), timeout=20)
        except asyncio.TimeoutError:
            pass
