"""Historial de versiones del documento maestro."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.document_version import DocumentVersion
from ...schemas.document import VersionDetail, VersionOut
from ...services import document_service
from ...services.audit_service import log_action
from ..deps import ProjectAccess, client_ip, require_project_admin, require_project_read

router = APIRouter(prefix="/projects/{project_id}/versions", tags=["versions"])


@router.get("")
async def list_versions(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    from ...models.user import User

    result = await db.execute(
        select(DocumentVersion)
        .where(DocumentVersion.project_id == project_id)
        .order_by(DocumentVersion.version_number.desc())
        .limit(200)
    )
    versions = result.scalars().all()
    # Foto de perfil del autor de cada revisión
    photos = {
        uid: url
        for uid, url in await db.execute(select(User.id, User.photo_url))
        if url
    }
    return [
        {
            **VersionOut.model_validate(v).model_dump(),
            "author_photo_url": photos.get(v.author_id),
        }
        for v in versions
    ]


@router.get("/{version_id}", response_model=VersionDetail)
async def get_version(
    project_id: str,
    version_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> VersionDetail:
    version = await db.get(DocumentVersion, version_id)
    if not version or version.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Versión no encontrada")
    return VersionDetail.model_validate(version)


@router.post("/{version_id}/restore", response_model=VersionDetail)
async def restore_version(
    project_id: str,
    version_id: str,
    request: Request,
    access: ProjectAccess = Depends(require_project_admin),
    db: AsyncSession = Depends(get_db),
) -> VersionDetail:
    """Restaurar = crear una versión NUEVA con el contenido de la elegida."""
    version = await db.get(DocumentVersion, version_id)
    if not version or version.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Versión no encontrada")

    doc = await document_service.get_or_create_document(db, project_id)
    new_version = await document_service.save_document(
        db,
        doc,
        access.user,
        content_md=version.content_md,
        base_version_id=doc.current_version_id,
        summary=f"Restauración de la versión {version.version_number}",
        force=True,
    )
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="version.restore", project_id=project_id, entity_type="version",
        entity_id=new_version.id,
        detail={"restored_from": version.version_number, "new_version": new_version.version_number},
        ip=client_ip(request),
    )
    return VersionDetail.model_validate(new_version)
