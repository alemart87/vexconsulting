"""Evaluaciones del proyecto por el agente evaluador experto."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...jobs.evaluation_worker import signal_evaluation_queue
from ...models.evaluation import Evaluation
from ...services.agent.evaluator import DEFAULT_RUBRIC, RUBRICS, build_rubric_text
from ...services.audit_service import log_action
from ..deps import ProjectAccess, client_ip, require_project_read, require_project_write

router = APIRouter(prefix="/projects/{project_id}/evaluations", tags=["evaluations"])


class EvaluationCreate(BaseModel):
    rubric_slug: str = DEFAULT_RUBRIC
    custom_rubric: Optional[str] = None  # el líder puede sobreescribir la rúbrica


def _out(e: Evaluation) -> dict:
    return {
        "id": e.id, "rubric_slug": e.rubric_slug, "status": e.status,
        "overall_score": float(e.overall_score) if e.overall_score is not None else None,
        "scores": e.scores, "report_md": e.report_md, "last_error": e.last_error,
        "cost_usd": float(e.cost_usd or 0), "created_at": e.created_at,
        "finished_at": e.finished_at,
    }


@router.get("/rubrics")
async def list_rubrics(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
) -> list[dict]:
    return [
        {"slug": slug, "label": r["label"], "text": build_rubric_text(slug)}
        for slug, r in RUBRICS.items()
    ]


@router.get("")
async def list_evaluations(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    result = await db.execute(
        select(Evaluation).where(Evaluation.project_id == project_id)
        .order_by(Evaluation.created_at.desc()).limit(20)
    )
    return [_out(e) for e in result.scalars().all()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_evaluation(
    project_id: str,
    payload: EvaluationCreate,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    pending = await db.execute(
        select(Evaluation).where(
            Evaluation.project_id == project_id,
            Evaluation.status.in_(["pending", "running"]),
        )
    )
    if pending.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya hay una evaluación en curso")

    evaluation = Evaluation(
        project_id=project_id,
        rubric_slug=payload.rubric_slug if payload.rubric_slug in RUBRICS else DEFAULT_RUBRIC,
        rubric_snapshot=payload.custom_rubric,
        requested_by=access.user.id,
    )
    db.add(evaluation)
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="evaluation.run", project_id=project_id, entity_type="evaluation",
        entity_id=evaluation.id, ip=client_ip(request),
    )
    signal_evaluation_queue()
    await db.refresh(evaluation)
    return _out(evaluation)


@router.get("/{evaluation_id}")
async def get_evaluation(
    project_id: str,
    evaluation_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    evaluation = await db.get(Evaluation, evaluation_id)
    if not evaluation or evaluation.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evaluación no encontrada")
    return _out(evaluation)
