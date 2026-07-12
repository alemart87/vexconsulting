"""Worker del agente evaluador: corre la evaluación como job de fondo."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select, update

from ..core.config import settings
from ..core.database import session_scope
from ..models.document import Document
from ..models.evaluation import Evaluation
from ..models.project import Project
from ..services.agent.context import AgentContext
from ..services.agent.core import AgentNotConfigured, build_agent, stream_agent
from ..services.agent.evaluator import build_evaluator_instructions, build_rubric_text
from ..services.agent.pricing import compute_cost_usd

logger = logging.getLogger("vexconsulting")

_signal = asyncio.Event()


def signal_evaluation_queue() -> None:
    _signal.set()


async def recover_stale_evaluations() -> None:
    async with session_scope() as db:
        await db.execute(
            update(Evaluation).where(Evaluation.status == "running")
            .values(status="failed", last_error="Interrumpido por reinicio del servidor")
        )
        await db.commit()


async def _claim_next() -> str | None:
    async with session_scope() as db:
        result = await db.execute(
            select(Evaluation.id).where(Evaluation.status == "pending")
            .order_by(Evaluation.created_at).limit(1)
        )
        ev_id = result.scalar_one_or_none()
        if not ev_id:
            return None
        claimed = await db.execute(
            update(Evaluation).where(Evaluation.id == ev_id, Evaluation.status == "pending")
            .values(status="running")
        )
        await db.commit()
        return ev_id if claimed.rowcount else None


def _parse_json(text: str) -> dict:
    text = text.strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("La respuesta del evaluador no contiene JSON")
    return json.loads(match.group(0))


async def _process(ev_id: str) -> None:
    async with session_scope() as db:
        evaluation = await db.get(Evaluation, ev_id)
        if not evaluation:
            return
        project = await db.get(Project, evaluation.project_id)
        doc_result = await db.execute(
            select(Document).where(Document.project_id == evaluation.project_id)
        )
        doc = doc_result.scalar_one_or_none()
        evaluation.document_version_id = doc.current_version_id if doc else None
        evaluation.rubric_snapshot = evaluation.rubric_snapshot or build_rubric_text(
            evaluation.rubric_slug
        )
        await db.commit()
        project_id = evaluation.project_id
        project_name = project.name if project else "Proyecto"
        rubric_slug = evaluation.rubric_slug
        rubric_snapshot = evaluation.rubric_snapshot
        requested_by = evaluation.requested_by

    error = None
    parsed: dict = {}
    usage: dict = {}
    try:
        instructions = build_evaluator_instructions(
            rubric_slug, project_name,
            custom_rubric=rubric_snapshot if rubric_snapshot and not rubric_snapshot.startswith("Rúbrica:") else None,
        )
        agent = build_agent(
            instructions=instructions,
            include_write_tools=False,
            include_web_tools=False,
            name="Agente evaluador VEX",
        )
        context = AgentContext(
            user_id=requested_by, user_name="evaluador", project_id=project_id,
            agent_type="evaluador",
        )
        async def _run() -> dict:
            final: dict = {}
            async for ev in stream_agent(
                [{"role": "user", "content": "Evaluá el proyecto según tu proceso obligatorio."}],
                context, agent,
            ):
                if ev["type"] == "done":
                    final = ev
            return final

        # Tope duro: una evaluación nunca queda «corriendo» para siempre
        final = await asyncio.wait_for(_run(), timeout=20 * 60)
        parsed = _parse_json(final.get("content", ""))
        usage = final.get("usage", {}) or {}
    except asyncio.TimeoutError:
        error = "La evaluación superó los 20 minutos y se canceló. Reintentá."
    except AgentNotConfigured as exc:
        error = str(exc)
    except Exception as exc:
        logger.exception("Evaluación %s falló", ev_id)
        error = f"La evaluación falló: {str(exc)[:400]}"

    async with session_scope() as db:
        evaluation = await db.get(Evaluation, ev_id)
        if not evaluation:
            return
        if error:
            evaluation.status = "failed"
            evaluation.last_error = error
        else:
            evaluation.status = "done"
            evaluation.scores = parsed.get("scores")
            evaluation.overall_score = parsed.get("overall_score")
            evaluation.report_md = parsed.get("informe_md")
            evaluation.cost_usd = compute_cost_usd(
                usage.get("input_tokens", 0), usage.get("output_tokens", 0),
                usage.get("cached_tokens", 0),
            )
        evaluation.finished_at = datetime.now(timezone.utc)

        # Campana: avisar a quien la pidió que el informe está listo
        try:
            from ..services.notification_service import notify

            link = f"/projects/{project_id}/evaluations?open={ev_id}"
            if error:
                title = f"La evaluación de «{project_name}» falló"
                body = error[:200]
            else:
                score = parsed.get("overall_score")
                title = (
                    f"Evaluación lista: {score}/10 · {project_name}"
                    if score is not None else f"Evaluación lista · {project_name}"
                )
                body = "El informe del evaluador experto está disponible."
            await notify(
                db, recipients={requested_by}, project_id=project_id,
                kind="evaluacion", title=title, body=body, link=link, entity_id=ev_id,
                actor_name="Evaluador experto",
            )
        except Exception:  # pragma: no cover — la campana nunca tumba el job
            logger.warning("No se pudo notificar la evaluación %s", ev_id[:8])

        await db.commit()
    logger.info("Evaluación %s: %s", ev_id[:8], error or "OK")


async def evaluation_worker() -> None:
    logger.info("evaluation_worker iniciado")
    while True:
        ev_id = await _claim_next()
        if ev_id:
            try:
                await _process(ev_id)
            except Exception:
                logger.exception("Error en evaluación %s", ev_id)
            continue
        _signal.clear()
        try:
            await asyncio.wait_for(_signal.wait(), timeout=20)
        except asyncio.TimeoutError:
            pass
