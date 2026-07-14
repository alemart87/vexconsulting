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
