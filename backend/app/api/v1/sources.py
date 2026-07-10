"""Fuentes de investigación: subida de archivos, links, estado del pipeline."""
from __future__ import annotations

import hashlib
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.database import get_db
from ...jobs.source_worker import signal_source_queue
from ...models.source import Source
from ...models.source_chunk import SourceChunk
from ...services.audit_service import log_action
from ..deps import ProjectAccess, client_ip, require_project_read, require_project_write

router = APIRouter(prefix="/projects/{project_id}/sources", tags=["sources"])


class LinkCreate(BaseModel):
    url: str = Field(min_length=8, max_length=1000)
    title: Optional[str] = Field(default=None, max_length=500)


class CitationUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=500)
    citation_meta: Optional[dict] = None


def _source_out(s: Source) -> dict:
    return {
        "id": s.id,
        "project_id": s.project_id,
        "kind": s.kind,
        "title": s.title,
        "original_filename": s.original_filename,
        "url": s.url,
        "mime_type": s.mime_type,
        "size_bytes": s.size_bytes,
        "status": s.status,
        "last_error": s.last_error,
        "extracted_chars": s.extracted_chars,
        "chunk_count": s.chunk_count,
        "page_count": s.page_count,
        "citation_meta": s.citation_meta,
        "uploaded_by_name": s.uploaded_by_name,
        "created_at": s.created_at,
        "finished_at": s.finished_at,
    }


@router.get("")
async def list_sources(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    result = await db.execute(
        select(Source).where(Source.project_id == project_id).order_by(Source.created_at.desc())
    )
    return [_source_out(s) for s in result.scalars().all()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_source(
    project_id: str,
    file: UploadFile,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    data = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"El archivo supera el máximo de {settings.max_upload_size_mb} MB",
        )
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Archivo vacío")

    sha = hashlib.sha256(data).hexdigest()
    duplicate = await db.execute(
        select(Source).where(Source.project_id == project_id, Source.sha256 == sha)
    )
    if duplicate.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Este archivo ya fue subido al proyecto")

    source_id = str(uuid.uuid4())
    folder = settings.upload_path / project_id / "sources" / source_id
    folder.mkdir(parents=True, exist_ok=True)
    safe_name = (file.filename or "archivo").replace("/", "_").replace("\\", "_")
    target = folder / safe_name
    target.write_bytes(data)

    source = Source(
        id=source_id,
        project_id=project_id,
        kind="file",
        title=safe_name,
        original_filename=safe_name,
        mime_type=file.content_type,
        sha256=sha,
        stored_path=str(target),
        size_bytes=len(data),
        status="pending",
        uploaded_by=access.user.id,
        uploaded_by_name=access.user.full_name,
    )
    db.add(source)
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="source.upload", project_id=project_id, entity_type="source", entity_id=source_id,
        detail={"filename": safe_name, "bytes": len(data)}, ip=client_ip(request),
    )
    signal_source_queue()
    await db.refresh(source)
    return _source_out(source)


@router.post("/link", status_code=status.HTTP_201_CREATED)
async def add_link(
    project_id: str,
    payload: LinkCreate,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    url = payload.url.strip()
    if not url.lower().startswith(("http://", "https://")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La URL debe empezar con http:// o https://")

    source = Source(
        project_id=project_id,
        kind="link",
        title=(payload.title or url)[:500],
        url=url,
        status="pending",
        uploaded_by=access.user.id,
        uploaded_by_name=access.user.full_name,
    )
    db.add(source)
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="source.link", project_id=project_id, entity_type="source", entity_id=source.id,
        detail={"url": url}, ip=client_ip(request),
    )
    signal_source_queue()
    await db.refresh(source)
    return _source_out(source)


@router.get("/{source_id}")
async def get_source(
    project_id: str,
    source_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    source = await db.get(Source, source_id)
    if not source or source.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fuente no encontrada")
    out = _source_out(source)
    preview = await db.execute(
        select(SourceChunk)
        .where(SourceChunk.source_id == source_id)
        .order_by(SourceChunk.chunk_index)
        .limit(3)
    )
    out["chunks_preview"] = [
        {"index": c.chunk_index, "content": c.content[:600], "meta": c.meta}
        for c in preview.scalars().all()
    ]
    return out


@router.patch("/{source_id}")
async def update_source(
    project_id: str,
    source_id: str,
    payload: CitationUpdate,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    source = await db.get(Source, source_id)
    if not source or source.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fuente no encontrada")
    if payload.title:
        source.title = payload.title.strip()[:500]
    if payload.citation_meta is not None:
        source.citation_meta = payload.citation_meta
    await db.commit()
    await db.refresh(source)
    return _source_out(source)


@router.post("/{source_id}/retry")
async def retry_source(
    project_id: str,
    source_id: str,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    source = await db.get(Source, source_id)
    if not source or source.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fuente no encontrada")
    if source.status not in ("failed", "ready"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fuente está en proceso")
    await db.execute(delete(SourceChunk).where(SourceChunk.source_id == source_id))
    source.status = "pending"
    source.last_error = None
    source.chunk_count = 0
    await db.commit()
    signal_source_queue()
    await db.refresh(source)
    return _source_out(source)


@router.get("/{source_id}/download")
async def download_source(
    project_id: str,
    source_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    source = await db.get(Source, source_id)
    if not source or source.project_id != project_id or not source.stored_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Archivo no encontrado")
    return FileResponse(source.stored_path, filename=source.original_filename or "archivo")


@router.delete("/{source_id}")
async def delete_source(
    project_id: str,
    source_id: str,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    source = await db.get(Source, source_id)
    if not source or source.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fuente no encontrada")
    await db.execute(delete(SourceChunk).where(SourceChunk.source_id == source_id))
    await db.delete(source)
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="source.delete", project_id=project_id, entity_type="source", entity_id=source_id,
        detail={"title": source.title}, ip=client_ip(request),
    )
    return {"ok": True}
