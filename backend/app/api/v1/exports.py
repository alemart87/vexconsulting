"""Exportación del documento maestro a Word/PDF (trabajos en cola)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...jobs.export_worker import signal_export_queue
from ...models.export_job import ExportJob
from ...services.audit_service import log_action
from ..deps import ProjectAccess, client_ip, require_project_read

router = APIRouter(prefix="/projects/{project_id}/exports", tags=["exports"])

_MIME = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}


class ExportRequest(BaseModel):
    format: str  # docx | pdf
    version_id: Optional[str] = None  # None = contenido actual


def _out(j: ExportJob) -> dict:
    return {
        "id": j.id, "format": j.format, "status": j.status, "last_error": j.last_error,
        "document_version_id": j.document_version_id, "created_at": j.created_at,
        "finished_at": j.finished_at,
    }


@router.get("")
async def list_exports(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    result = await db.execute(
        select(ExportJob).where(ExportJob.project_id == project_id)
        .order_by(ExportJob.created_at.desc()).limit(30)
    )
    return [_out(j) for j in result.scalars().all()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_export(
    project_id: str,
    payload: ExportRequest,
    request: Request,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if payload.format not in _MIME:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Formato: docx o pdf")

    version_id = payload.version_id
    # El visualizador solo puede exportar la versión publicada.
    if access.user.is_visualizador:
        version_id = access.project.published_version_id
        if not version_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "El proyecto no está publicado")

    job = ExportJob(
        project_id=project_id,
        document_version_id=version_id,
        format=payload.format,
        requested_by=access.user.id,
    )
    db.add(job)
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action=f"export.{payload.format}", project_id=project_id,
        entity_type="export", entity_id=job.id, ip=client_ip(request),
    )
    signal_export_queue()
    await db.refresh(job)
    return _out(job)


@router.get("/{job_id}")
async def get_export(
    project_id: str,
    job_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    job = await db.get(ExportJob, job_id)
    if not job or job.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exportación no encontrada")
    return _out(job)


@router.get("/{job_id}/download")
async def download_export(
    project_id: str,
    job_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    job = await db.get(ExportJob, job_id)
    if not job or job.project_id != project_id or job.status != "done" or not job.output_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exportación no disponible")
    name = f"{access.project.name[:60]}.{job.format}".replace("/", "-")
    return FileResponse(job.output_path, filename=name, media_type=_MIME[job.format])
