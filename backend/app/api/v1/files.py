"""Imágenes del editor y descarga autenticada de archivos."""
from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from ...core.config import settings
from ..deps import ProjectAccess, require_project_read, require_project_write

router = APIRouter(tags=["files"])

_ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"}
_EXT_BY_TYPE = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
}


def _images_dir(project_id: str) -> Path:
    path = settings.upload_path / project_id / "images"
    path.mkdir(parents=True, exist_ok=True)
    return path


@router.post("/projects/{project_id}/images")
async def upload_image(
    project_id: str,
    file: UploadFile,
    access: ProjectAccess = Depends(require_project_write),
) -> dict:
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo se permiten imágenes (png, jpg, gif, webp, svg)")
    data = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Máximo {settings.max_upload_size_mb} MB")

    digest = hashlib.sha256(data).hexdigest()[:16]
    name = f"{digest}-{uuid.uuid4().hex[:8]}{_EXT_BY_TYPE[file.content_type]}"
    target = _images_dir(project_id) / name
    target.write_bytes(data)
    return {"url": f"/api/v1/projects/{project_id}/images/{name}"}


@router.get("/projects/{project_id}/images/{name}")
async def get_image(
    project_id: str,
    name: str,
    access: ProjectAccess = Depends(require_project_read),
) -> FileResponse:
    # Sin path traversal: solo nombre plano dentro del directorio del proyecto.
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nombre inválido")
    target = _images_dir(project_id) / name
    if not target.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Imagen no encontrada")
    return FileResponse(target)
