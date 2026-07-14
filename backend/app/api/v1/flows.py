"""Vex Flows (zona Vex Cowork): flujogramas del proyecto (canvas React Flow).

CRUD simple con autosave desde el frontend. El diagrama es un JSON opaco
(nodes/edges/viewport) — el backend solo lo guarda acotado y trazado."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.flow import Flow
from ...services.audit_service import log_action
from ..deps import ProjectAccess, client_ip, require_project_read, require_project_write

router = APIRouter(prefix="/projects/{project_id}/flows", tags=["flows"])

MAX_NODES = 400
MAX_EDGES = 800


class FlowCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)


class FlowGenerate(BaseModel):
    instruction: str = Field(min_length=10, max_length=2000)


class FlowUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    data: Optional[dict] = None


def _require_flows_access(access: ProjectAccess) -> None:
    if access.user.is_visualizador:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Los visualizadores no acceden a Vex Flows")


def _clean_data(raw: dict | None) -> dict:
    raw = raw or {}
    nodes = [n for n in (raw.get("nodes") or []) if isinstance(n, dict)][:MAX_NODES]
    edges = [e for e in (raw.get("edges") or []) if isinstance(e, dict)][:MAX_EDGES]
    viewport = raw.get("viewport") if isinstance(raw.get("viewport"), dict) else None
    return {"nodes": nodes, "edges": edges, "viewport": viewport}


def _out(f: Flow, with_data: bool = True) -> dict:
    out = {
        "id": f.id, "name": f.name,
        "nodes_count": len((f.data or {}).get("nodes") or []),
        "created_by": f.created_by, "created_by_name": f.created_by_name,
        "updated_by_name": f.updated_by_name,
        "created_at": f.created_at, "updated_at": f.updated_at,
    }
    if with_data:
        out["data"] = f.data or {"nodes": [], "edges": [], "viewport": None}
    return out


@router.get("")
async def list_flows(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    _require_flows_access(access)
    rows = (await db.execute(
        select(Flow).where(Flow.project_id == project_id)
        .order_by(Flow.updated_at.desc()).limit(100)
    )).scalars().all()
    return [_out(f, with_data=False) for f in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_flow(
    project_id: str,
    payload: FlowCreate,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_flows_access(access)
    flow = Flow(
        project_id=project_id, name=payload.name.strip(),
        data={"nodes": [], "edges": [], "viewport": None},
        created_by=access.user.id, created_by_name=access.user.full_name,
        updated_by_name=access.user.full_name,
    )
    db.add(flow)
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="flow.create", project_id=project_id, entity_type="flow",
        entity_id=flow.id, detail={"name": flow.name}, ip=client_ip(request),
    )
    await db.refresh(flow)
    return _out(flow)


@router.get("/{flow_id}")
async def get_flow(
    project_id: str,
    flow_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_flows_access(access)
    f = await db.get(Flow, flow_id)
    if not f or f.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flujo no encontrado")
    return _out(f)


@router.patch("/{flow_id}")
async def update_flow(
    project_id: str,
    flow_id: str,
    payload: FlowUpdate,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Autosave del canvas: cualquier miembro con escritura edita el flujo."""
    _require_flows_access(access)
    f = await db.get(Flow, flow_id)
    if not f or f.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flujo no encontrado")
    if payload.name is not None:
        f.name = payload.name.strip()
    if payload.data is not None:
        f.data = _clean_data(payload.data)
    f.updated_by_name = access.user.full_name
    f.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _out(f, with_data=False)


_GEN_SYSTEM = """Sos el diseñador de flujogramas de VEX Consulting. Te dan el \
contexto del proyecto (documento maestro) y una instrucción del consultor \
(ej.: «cómo implementar las mejoras», «cómo continuar la investigación», \
«cómo proponer esto a los clientes»). Diseñás un flujograma PROFESIONAL y \
accionable que responda a esa instrucción, apoyado en lo que dice el documento.

Respondé SOLO JSON:
{"nombre": "<título corto del flujo>",
 "nodos": [{"id": "n1", "tipo": "inicio|proceso|decision|dato|fin|nota", "texto": "<máx 60 chars>"}],
 "flechas": [{"de": "n1", "a": "n2", "etiqueta": "<opcional, ej. sí/no>"}]}

Reglas de diseño:
- exactamente UN nodo "inicio" y al menos un "fin"
- las "decision" tienen 2+ salidas con etiqueta (sí/no, aprueba/rechaza…)
- entre 8 y 22 nodos según la complejidad pedida; textos cortos y concretos
  (verbo + objeto: «Priorizar hallazgos», «¿Cliente aprueba?»)
- "dato" para entradas/salidas de información; "nota" solo para aclaraciones clave
- todo nodo debe estar conectado: sin islas ni callejones sin salida (salvo los fin)"""


def _auto_layout(nodos: list[dict], flechas: list[dict]) -> dict[str, tuple[float, float]]:
    """Layout por niveles (BFS desde el inicio): y = nivel, x = posición en el
    nivel, centrado. El consultor después acomoda a gusto en el canvas."""
    ids = [n["id"] for n in nodos]
    adj: dict[str, list[str]] = {i: [] for i in ids}
    indeg: dict[str, int] = {i: 0 for i in ids}
    for f in flechas:
        if f["de"] in adj and f["a"] in indeg:
            adj[f["de"]].append(f["a"])
            indeg[f["a"]] += 1
    tipo = {n["id"]: n.get("tipo") for n in nodos}
    roots = [i for i in ids if tipo[i] == "inicio"] or [i for i in ids if indeg[i] == 0] or ids[:1]

    level: dict[str, int] = {}
    queue = [(r, 0) for r in roots]
    while queue:
        nid, lv = queue.pop(0)
        if nid in level:
            continue
        level[nid] = lv
        for nxt in adj[nid]:
            if nxt not in level:
                queue.append((nxt, lv + 1))
    orphan_lv = (max(level.values()) + 1) if level else 0
    for i in ids:
        level.setdefault(i, orphan_lv)

    by_level: dict[int, list[str]] = {}
    for i in ids:
        by_level.setdefault(level[i], []).append(i)
    pos: dict[str, tuple[float, float]] = {}
    for lv, members in by_level.items():
        for idx, nid in enumerate(members):
            x = (idx - (len(members) - 1) / 2) * 260
            y = lv * 150
            pos[nid] = (x, y)
    return pos


async def _ask_model(system: str, user: str) -> tuple[str, dict]:
    from openai import AsyncOpenAI

    from ...core.config import settings as _s

    client = AsyncOpenAI(api_key=_s.openai_api_key, timeout=120, max_retries=1)
    kwargs: dict = dict(
        model=_s.agent_model,
        response_format={"type": "json_object"},
        reasoning_effort="low",
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    try:
        resp = await client.chat.completions.create(**kwargs)
    except Exception as exc:
        if "reasoning" not in str(exc).lower():
            raise
        kwargs.pop("reasoning_effort", None)
        resp = await client.chat.completions.create(**kwargs)
    usage = getattr(resp, "usage", None)
    return (resp.choices[0].message.content or "{}"), {
        "input_tokens": int(getattr(usage, "prompt_tokens", 0) or 0),
        "output_tokens": int(getattr(usage, "completion_tokens", 0) or 0),
        "cached_tokens": int(getattr(
            getattr(usage, "prompt_tokens_details", None), "cached_tokens", 0) or 0),
    }


@router.post("/generate", status_code=status.HTTP_201_CREATED)
async def generate_flow(
    project_id: str,
    payload: FlowGenerate,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Genera un flujograma completo desde una instrucción, con el documento
    como contexto. El costo queda registrado en Costos IA (agent_type=flows)."""
    import json as _json
    import re as _re

    from ...core.config import settings as _s
    from ...models.conversation import Conversation, Message
    from ...models.document import Document
    from ...services.agent.pricing import compute_cost_usd

    _require_flows_access(access)
    if not _s.openai_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "IA no configurada en el servidor")

    doc = (await db.execute(
        select(Document).where(Document.project_id == project_id)
    )).scalar_one_or_none()
    doc_md = (doc.content_md if doc else "") or "(documento vacío)"
    user_msg = (
        f"Proyecto: {access.project.name}\n\n"
        f"DOCUMENTO MAESTRO (contexto):\n{doc_md[:30000]}\n\n"
        f"INSTRUCCIÓN DEL CONSULTOR:\n{payload.instruction.strip()}"
    )

    try:
        raw, usage = await _ask_model(_GEN_SYSTEM, user_msg)
        match = _re.search(r"\{.*\}", raw, _re.DOTALL)
        data = _json.loads(match.group(0)) if match else {}
        nodos = [n for n in data.get("nodos", []) if isinstance(n, dict) and n.get("id")][:60]
        flechas = [f for f in data.get("flechas", []) if isinstance(f, dict)
                   and f.get("de") and f.get("a")][:120]
        if len(nodos) < 3:
            raise ValueError("el diseñador no devolvió un flujo utilizable")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"No se pudo generar el flujo: {str(exc)[:200]}. Reintentá.",
        )

    valid_tipos = {"inicio", "proceso", "decision", "dato", "fin", "nota"}
    pos = _auto_layout(nodos, flechas)
    rf_nodes = [
        {
            "id": str(n["id"])[:40],
            "type": n.get("tipo") if n.get("tipo") in valid_tipos else "proceso",
            "position": {"x": pos[n["id"]][0], "y": pos[n["id"]][1]},
            "data": {"label": str(n.get("texto") or "Paso")[:80]},
        }
        for n in nodos
    ]
    node_ids = {n["id"] for n in rf_nodes}
    rf_edges = [
        {
            "id": f"e{i}",
            "source": str(f["de"])[:40],
            "target": str(f["a"])[:40],
            **({"label": str(f["etiqueta"])[:40]} if f.get("etiqueta") else {}),
            "type": "smoothstep",
            "markerEnd": {"type": "arrowclosed", "color": "#5B6275"},
            "style": {"stroke": "#5B6275", "strokeWidth": 1.6},
        }
        for i, f in enumerate(flechas)
        if str(f["de"])[:40] in node_ids and str(f["a"])[:40] in node_ids
    ]

    name = str(data.get("nombre") or payload.instruction[:60]).strip()[:200]
    flow = Flow(
        project_id=project_id, name=name,
        data={"nodes": rf_nodes, "edges": rf_edges, "viewport": None},
        created_by=access.user.id, created_by_name=access.user.full_name,
        updated_by_name=access.user.full_name,
    )
    db.add(flow)

    # --- Costos IA: TODO consumo queda trazado (conversación agent_type=flows) ---
    cost = compute_cost_usd(usage["input_tokens"], usage["output_tokens"], usage["cached_tokens"])
    conv = (await db.execute(
        select(Conversation).where(
            Conversation.project_id == project_id, Conversation.agent_type == "flows",
        ).limit(1)
    )).scalar_one_or_none()
    if not conv:
        conv = Conversation(
            user_id=access.user.id, project_id=project_id,
            agent_type="flows", title="⛓ Flows · generación con IA",
        )
        db.add(conv)
        await db.flush()
    db.add(Message(
        conversation_id=conv.id, role="user", content=payload.instruction.strip(),
        author_id=access.user.id, author_name=access.user.full_name,
    ))
    db.add(Message(
        conversation_id=conv.id, role="assistant",
        content=f"[Flow generado] «{name}» · {len(rf_nodes)} nodos, {len(rf_edges)} conexiones",
        tool_calls={"status": "done", "engine": "flows", "cost_openai": cost,
                    "model": _s.agent_model, "flow_id": flow.id},
        input_tokens=usage["input_tokens"], cached_tokens=usage["cached_tokens"],
        output_tokens=usage["output_tokens"],
        total_tokens=usage["input_tokens"] + usage["output_tokens"],
        cost_usd=cost,
    ))
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="flow.generate", project_id=project_id, entity_type="flow",
        entity_id=flow.id,
        detail={"name": name, "nodos": len(rf_nodes), "cost_usd": round(cost, 4),
                "instruction": payload.instruction[:200]},
        ip=client_ip(request),
    )
    await db.refresh(flow)
    return {**_out(flow), "cost_usd": round(cost, 4)}


@router.delete("/{flow_id}")
async def delete_flow(
    project_id: str,
    flow_id: str,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _require_flows_access(access)
    f = await db.get(Flow, flow_id)
    if not f or f.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flujo no encontrado")
    if f.created_by != access.user.id and access.permission != "admin" and not access.user.is_lider:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo quien lo creó (o un líder/admin) puede borrarlo")
    name = f.name
    await db.delete(f)
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="flow.delete", project_id=project_id, entity_type="flow",
        entity_id=flow_id, detail={"name": name}, ip=client_ip(request),
    )
    await db.commit()
    return {"ok": True}
