"""Documento maestro: lectura, guardado con versionado, lock y vista publicada."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.document_version import DocumentVersion
from ...schemas.document import DocumentOut, DocumentSave, VersionDetail
from ...services import document_service
from ...services.audit_service import log_action
from ..deps import ProjectAccess, client_ip, require_project_read, require_project_write

router = APIRouter(prefix="/projects/{project_id}/document", tags=["documents"])


@router.get("", response_model=DocumentOut)
async def get_document(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    doc = await document_service.get_or_create_document(db, project_id)
    return DocumentOut.model_validate(doc)


@router.put("", response_model=DocumentOut)
async def save_document(
    project_id: str,
    payload: DocumentSave,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    doc = await document_service.get_or_create_document(db, project_id)
    version = await document_service.save_document(
        db,
        doc,
        access.user,
        content_md=payload.content_md,
        base_version_id=payload.base_version_id,
        summary=payload.summary,
        force=payload.force,
    )
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="document.save", project_id=project_id, entity_type="version",
        entity_id=version.id,
        detail={
            "version": version.version_number,
            "words": version.word_count,
            "added": version.words_added,
            "removed": version.words_removed,
        },
        ip=client_ip(request),
    )
    await db.refresh(doc)
    return DocumentOut.model_validate(doc)


@router.post("/lock", response_model=DocumentOut)
async def lock_document(
    project_id: str,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    doc = await document_service.get_or_create_document(db, project_id)
    doc = await document_service.acquire_lock(db, doc, access.user)
    return DocumentOut.model_validate(doc)


@router.delete("/lock")
async def unlock_document(
    project_id: str,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    doc = await document_service.get_or_create_document(db, project_id)
    await document_service.release_lock(db, doc, access.user)
    return {"ok": True}


@router.get("/published", response_model=VersionDetail)
async def get_published(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> VersionDetail:
    """Versión congelada al publicar — lo único visible para visualizadores."""
    project = access.project
    if project.status != "publicado" or not project.published_version_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "El proyecto no tiene versión publicada")
    version = await db.get(DocumentVersion, project.published_version_id)
    if not version:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Versión publicada no encontrada")
    return VersionDetail.model_validate(version)
