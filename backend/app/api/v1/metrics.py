"""Métricas de aporte por consultor y métricas globales de la plataforma."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.audit import AuditLog
from ...models.conversation import Conversation, Message
from ...models.document_version import DocumentVersion
from ...models.evaluation import Evaluation
from ...models.note import Note
from ...models.project import Project
from ...models.source import Source
from ...models.user import User
from ..deps import (
    CurrentUser,
    ProjectAccess,
    require_lider,
    require_project_read,
    require_superadmin,
)

router = APIRouter(tags=["metrics"])


@router.get("/projects/{project_id}/metrics")
async def project_metrics(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    # Aporte por autor sobre las versiones del documento
    versions = await db.execute(
        select(
            DocumentVersion.author_id,
            DocumentVersion.author_name,
            func.count(DocumentVersion.id).label("ediciones"),
            func.sum(DocumentVersion.words_added).label("palabras_agregadas"),
            func.sum(DocumentVersion.words_removed).label("palabras_quitadas"),
            func.max(DocumentVersion.created_at).label("ultima_edicion"),
        )
        .where(DocumentVersion.project_id == project_id)
        .group_by(DocumentVersion.author_id, DocumentVersion.author_name)
        .order_by(func.count(DocumentVersion.id).desc())
    )
    aportes = [
        {
            "author_id": r.author_id,
            "author_name": r.author_name,
            "ediciones": int(r.ediciones or 0),
            "palabras_agregadas": int(r.palabras_agregadas or 0),
            "palabras_quitadas": int(r.palabras_quitadas or 0),
            "ultima_edicion": r.ultima_edicion,
        }
        for r in versions
    ]

    sources = await db.execute(
        select(Source.uploaded_by_name, func.count(Source.id))
        .where(Source.project_id == project_id)
        .group_by(Source.uploaded_by_name)
    )
    fuentes_por_usuario = {name or "—": int(count) for name, count in sources}

    totals = {}
    totals["versiones"] = (await db.execute(
        select(func.count(DocumentVersion.id)).where(DocumentVersion.project_id == project_id)
    )).scalar_one()
    totals["fuentes"] = (await db.execute(
        select(func.count(Source.id)).where(Source.project_id == project_id)
    )).scalar_one()
    totals["notas"] = (await db.execute(
        select(func.count(Note.id)).where(Note.project_id == project_id)
    )).scalar_one()
    totals["consultas_ia"] = (await db.execute(
        select(func.count(Message.id))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Conversation.project_id == project_id, Message.role == "user")
    )).scalar_one()
    costo = (await db.execute(
        select(func.coalesce(func.sum(Message.cost_usd), 0))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Conversation.project_id == project_id)
    )).scalar_one()

    actividad = await db.execute(
        select(AuditLog.action, func.count(AuditLog.id))
        .where(AuditLog.project_id == project_id)
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc())
        .limit(15)
    )

    # Serie temporal (últimos 45 días): palabras y ediciones por día por autor,
    # más consultas a la IA por día. Agregación en Python (pocas filas).
    from collections import defaultdict
    from datetime import datetime, timedelta, timezone

    since = datetime.now(timezone.utc) - timedelta(days=45)
    ver_rows = await db.execute(
        select(
            DocumentVersion.created_at,
            DocumentVersion.author_name,
            DocumentVersion.words_added,
        ).where(
            DocumentVersion.project_id == project_id,
            DocumentVersion.created_at >= since,
        )
    )
    daily: dict[str, dict] = defaultdict(lambda: {"palabras": 0, "ediciones": 0, "consultas_ia": 0})
    per_author_daily: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for created_at, author, words in ver_rows:
        day = created_at.strftime("%d/%m")
        daily[day]["palabras"] += int(words or 0)
        daily[day]["ediciones"] += 1
        per_author_daily[day][author or "—"] += int(words or 0)

    msg_rows = await db.execute(
        select(Message.created_at)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Conversation.project_id == project_id,
            Message.role == "user",
            Message.created_at >= since,
        )
    )
    for (created_at,) in msg_rows:
        daily[created_at.strftime("%d/%m")]["consultas_ia"] += 1

    def _sortkey(day: str) -> tuple:
        d, m = day.split("/")
        return (int(m), int(d))

    timeline = [
        {"dia": day, **values, "por_autor": dict(per_author_daily.get(day, {}))}
        for day, values in sorted(daily.items(), key=lambda kv: _sortkey(kv[0]))
    ]

    return {
        "aportes": aportes,
        "fuentes_por_usuario": fuentes_por_usuario,
        "totales": {k: int(v or 0) for k, v in totals.items()},
        "costo_ia_usd": float(costo or 0),
        "actividad": [{"action": a, "count": int(c)} for a, c in actividad],
        "timeline": timeline,
    }


_USO_LABELS = {
    "investigacion": "Investigador",
    "acompanante": "Chat del agente",
    "redaccion": "Ayuda de redacción (editor)",
    "evaluador": "Evaluador",
    "visualizador": "Asistente del visualizador",
}


@router.get("/admin/ai-costs")
async def ai_costs(
    days: int = 30,
    _: CurrentUser = Depends(require_lider),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Gasto en IA para el consultor líder: total, por proveedor/modelo, por
    tipo de uso, por usuario (quién consume más) y por proyecto."""
    from datetime import datetime, timedelta, timezone

    days = max(1, min(int(days or 30), 365))
    since = datetime.now(timezone.utc) - timedelta(days=days)

    users = {uid: name for uid, name in await db.execute(select(User.id, User.full_name))}
    users["superadmin"] = "Superadmin"
    projects = {pid: name for pid, name in await db.execute(select(Project.id, Project.name))}

    # --- Mensajes de agentes (investigador, asistentes, chat con IA) ---
    by_use: dict[str, dict] = {}
    by_user: dict[str, dict] = {}
    by_project: dict[str, float] = {}
    rows = await db.execute(
        select(
            Conversation.agent_type, Conversation.user_id, Conversation.project_id,
            func.count(Message.id), func.coalesce(func.sum(Message.cost_usd), 0),
        )
        .join(Message, Message.conversation_id == Conversation.id)
        .where(Message.created_at >= since, Message.cost_usd.isnot(None))
        .group_by(Conversation.agent_type, Conversation.user_id, Conversation.project_id)
    )
    messages_total = 0.0
    for agent_type, user_id, project_id, count, usd in rows:
        usd = float(usd or 0)
        messages_total += usd
        uso = _USO_LABELS.get(agent_type, agent_type or "otro")
        by_use.setdefault(uso, {"usd": 0.0, "consultas": 0})
        by_use[uso]["usd"] += usd
        by_use[uso]["consultas"] += int(count or 0)
        uname = users.get(user_id, user_id or "—")
        by_user.setdefault(uname, {"usd": 0.0, "consultas": 0})
        by_user[uname]["usd"] += usd
        by_user[uname]["consultas"] += int(count or 0)
        if project_id:
            pname = projects.get(project_id, project_id)
            by_project[pname] = by_project.get(pname, 0.0) + usd

    # --- Desglose por proveedor y modelo (tool_calls de investigaciones) ---
    by_provider = {"openai": 0.0, "perplexity": 0.0, "embeddings": 0.0}
    by_model: dict[str, float] = {}
    detail_rows = await db.execute(
        select(Message.tool_calls, Message.cost_usd)
        .where(
            Message.created_at >= since,
            Message.cost_usd.isnot(None),
            Message.tool_calls.isnot(None),
        )
        .limit(4000)
    )
    detailed = 0.0
    for tool_calls, usd in detail_rows:
        tc = tool_calls if isinstance(tool_calls, dict) else {}
        o, p = tc.get("cost_openai"), tc.get("cost_perplexity")
        if o is None and p is None:
            continue
        detailed += float(usd or 0)
        by_provider["openai"] += float(o or 0)
        by_provider["perplexity"] += float(p or 0)
        model = tc.get("model") or "gpt (sin registrar)"
        by_model[model] = by_model.get(model, 0.0) + float(o or 0)
        if p:
            by_model["perplexity/sonar"] = by_model.get("perplexity/sonar", 0.0) + float(p)
    # Mensajes sin desglose (histórico/asistentes): asignados a OpenAI y al
    # modelo del agente (todos los usos internos corren sobre él)
    from ...core.config import settings as _settings

    _agent_model = _settings.agent_model
    undetailed = max(0.0, messages_total - detailed)
    by_provider["openai"] += undetailed
    if undetailed:
        by_model[_agent_model] = by_model.get(_agent_model, 0.0) + undetailed

    # --- Evaluaciones ---
    eval_row = (await db.execute(
        select(func.count(Evaluation.id), func.coalesce(func.sum(Evaluation.cost_usd), 0))
        .where(Evaluation.created_at >= since, Evaluation.cost_usd.isnot(None))
    )).first()
    eval_count, eval_usd = int(eval_row[0] or 0), float(eval_row[1] or 0)
    if eval_usd:
        by_use.setdefault("Evaluador", {"usd": 0.0, "consultas": 0})
        by_use["Evaluador"]["usd"] += eval_usd
        by_use["Evaluador"]["consultas"] += eval_count
        by_provider["openai"] += eval_usd
        by_model[_agent_model] = by_model.get(_agent_model, 0.0) + eval_usd

    # --- Edición final APA (auditoría) ---
    final_edit_usd = 0.0
    audit_rows = await db.execute(
        select(AuditLog.detail, AuditLog.user_email)
        .where(AuditLog.action == "document.final_edit", AuditLog.created_at >= since)
        .limit(500)
    )
    for detail, _email in audit_rows:
        d = detail if isinstance(detail, dict) else {}
        final_edit_usd += float(d.get("cost_usd") or 0)
    if final_edit_usd:
        by_use.setdefault("Edición final APA", {"usd": 0.0, "consultas": 0})
        by_use["Edición final APA"]["usd"] += final_edit_usd
        by_provider["openai"] += final_edit_usd
        by_model[_agent_model] = by_model.get(_agent_model, 0.0) + final_edit_usd

    # --- Gantt generado con IA (auditoría) ---
    gantt_usd = 0.0
    gantt_count = 0
    gantt_rows = await db.execute(
        select(AuditLog.detail)
        .where(AuditLog.action == "gantt.generate", AuditLog.created_at >= since)
        .limit(500)
    )
    for (detail,) in gantt_rows:
        d = detail if isinstance(detail, dict) else {}
        if d.get("cost_usd"):
            gantt_usd += float(d["cost_usd"])
            gantt_count += 1
    if gantt_usd:
        by_use.setdefault("Gantt con IA", {"usd": 0.0, "consultas": 0})
        by_use["Gantt con IA"]["usd"] += gantt_usd
        by_use["Gantt con IA"]["consultas"] += gantt_count
        by_provider["openai"] += gantt_usd
        by_model[_agent_model] = by_model.get(_agent_model, 0.0) + gantt_usd

    # --- KnowHub (audio, mapas mentales, briefings, FAQ) ---
    from ...models.knowhub import KnowHubItem

    kh_labels = {"audio": "KnowHub · audio", "mindmap": "KnowHub · mapa mental",
                 "briefing": "KnowHub · briefing", "faq": "KnowHub · FAQ",
                 "slides": "KnowHub · presentación"}
    kh_total = 0.0
    kh_rows = await db.execute(
        select(
            KnowHubItem.kind, KnowHubItem.created_by, KnowHubItem.project_id,
            func.count(KnowHubItem.id), func.coalesce(func.sum(KnowHubItem.cost_usd), 0),
        )
        .where(KnowHubItem.created_at >= since, KnowHubItem.cost_usd.isnot(None))
        .group_by(KnowHubItem.kind, KnowHubItem.created_by, KnowHubItem.project_id)
    )
    kh_audio = 0.0
    for kind, user_id, project_id, count, usd in kh_rows:
        usd = float(usd or 0)
        kh_total += usd
        if kind == "audio":
            kh_audio += usd
        uso = kh_labels.get(kind, f"KnowHub · {kind}")
        by_use.setdefault(uso, {"usd": 0.0, "consultas": 0})
        by_use[uso]["usd"] += usd
        by_use[uso]["consultas"] += int(count or 0)
        uname = users.get(user_id, user_id or "—")
        by_user.setdefault(uname, {"usd": 0.0, "consultas": 0})
        by_user[uname]["usd"] += usd
        by_user[uname]["consultas"] += int(count or 0)
        if project_id:
            pname = projects.get(project_id, project_id)
            by_project[pname] = by_project.get(pname, 0.0) + usd
    by_provider["openai"] += kh_total
    # Audio = guion + voces TTS; el resto del KnowHub corre sobre el agente
    if kh_audio:
        tts_model = _settings.knowhub_tts_model
        by_model[tts_model] = by_model.get(tts_model, 0.0) + kh_audio
    if kh_total - kh_audio > 0:
        by_model[_agent_model] = by_model.get(_agent_model, 0.0) + (kh_total - kh_audio)

    # --- Embeddings (indexación de fuentes) ---
    emb = float((await db.execute(
        select(func.coalesce(func.sum(Source.embedding_cost_usd), 0))
        .where(Source.created_at >= since)
    )).scalar_one() or 0)
    by_provider["embeddings"] = emb
    if emb:
        by_use.setdefault("Indexación de fuentes (embeddings)", {"usd": 0.0, "consultas": 0})
        by_use["Indexación de fuentes (embeddings)"]["usd"] += emb
        emb_model = _settings.embedding_model
        by_model[emb_model] = by_model.get(emb_model, 0.0) + emb

    total = messages_total + eval_usd + final_edit_usd + gantt_usd + emb + kh_total
    r6 = lambda x: round(float(x), 4)  # noqa: E731
    return {
        "days": days,
        "total_usd": r6(total),
        "by_provider": {k: r6(v) for k, v in by_provider.items()},
        "by_model": sorted(
            [{"model": m, "usd": r6(v)} for m, v in by_model.items()],
            key=lambda x: -x["usd"],
        ),
        "by_use": sorted(
            [{"uso": k, "usd": r6(v["usd"]), "consultas": v["consultas"]} for k, v in by_use.items()],
            key=lambda x: -x["usd"],
        ),
        "by_user": sorted(
            [{"usuario": k, "usd": r6(v["usd"]), "consultas": v["consultas"]} for k, v in by_user.items()],
            key=lambda x: -x["usd"],
        ),
        "by_project": sorted(
            [{"proyecto": k, "usd": r6(v)} for k, v in by_project.items()],
            key=lambda x: -x["usd"],
        )[:20],
    }


@router.get("/admin/metrics")
async def admin_metrics(
    _: CurrentUser = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    out: dict = {}
    out["usuarios"] = (await db.execute(select(func.count(User.id)))).scalar_one()
    out["proyectos"] = (await db.execute(select(func.count(Project.id)))).scalar_one()
    out["versiones"] = (await db.execute(select(func.count(DocumentVersion.id)))).scalar_one()
    out["fuentes"] = (await db.execute(select(func.count(Source.id)))).scalar_one()
    out["mensajes_ia"] = (await db.execute(select(func.count(Message.id)))).scalar_one()
    costo = (await db.execute(select(func.coalesce(func.sum(Message.cost_usd), 0)))).scalar_one()
    out["costo_ia_usd"] = float(costo or 0)

    por_proyecto = await db.execute(
        select(Project.name, func.coalesce(func.sum(Message.cost_usd), 0))
        .join(Conversation, Conversation.project_id == Project.id)
        .join(Message, Message.conversation_id == Conversation.id)
        .group_by(Project.name)
        .order_by(func.sum(Message.cost_usd).desc())
        .limit(20)
    )
    out["costo_por_proyecto"] = [
        {"proyecto": name, "usd": float(usd or 0)} for name, usd in por_proyecto
    ]
    return {k: (int(v) if isinstance(v, (int,)) else v) for k, v in out.items()}
