"""Gestión jerárquica de usuarios.

superadmin crea líderes, consultores y visualizadores;
consultor_lider crea consultores y visualizadores (no líderes).
"""
from __future__ import annotations

import uuid as _uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.database import get_db
from ...core.security import hash_password
from ...models.user import User
from ...schemas.user import UserCreate, UserOut, UserUpdate
from ...services.audit_service import log_action
from ..deps import CurrentUser, client_ip, get_current_user, require_lider

router = APIRouter(prefix="/users", tags=["users"])

_AVATAR_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


@router.post("/me/photo")
async def upload_my_photo(
    file: UploadFile,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Foto de perfil: se guarda con nombre impredecible y se sirve como
    URL-capacidad (los <img> no envían el JWT)."""
    if user.is_superadmin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El superadmin no tiene perfil en DB")
    if file.content_type not in _AVATAR_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo PNG, JPG o WebP")
    data = await file.read()
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Máximo 2 MB")

    avatars = settings.upload_path / "avatars"
    avatars.mkdir(parents=True, exist_ok=True)
    target = await db.get(User, user.id)
    # borrar la anterior para no acumular
    if target.photo_url:
        old = avatars / Path(target.photo_url).name
        if old.parent == avatars:
            old.unlink(missing_ok=True)
    name = f"{_uuid.uuid4().hex}{_AVATAR_TYPES[file.content_type]}"
    (avatars / name).write_bytes(data)
    target.photo_url = f"/api/v1/avatars/{name}"
    await log_action(db, user_id=user.id, user_email=user.email, action="user.photo")
    return {"photo_url": target.photo_url}


def _can_manage_role(actor: CurrentUser, target_role: str) -> bool:
    """Jerarquía: el superadmin gestiona todo; el líder TITULAR gestiona
    suplentes, consultores y visualizadores; el SUPLENTE (consultor_lider_2)
    tiene las mismas atribuciones hacia abajo pero no gestiona líderes ni a
    otros suplentes — depende del titular."""
    if actor.is_superadmin:
        return True
    if actor.is_lider_titular:
        return target_role in ("consultor_lider_2", "consultor", "visualizador")
    if actor.is_lider:  # suplente
        return target_role in ("consultor", "visualizador")
    return False


@router.get("", response_model=list[UserOut])
async def list_users(
    actor: CurrentUser = Depends(require_lider),
    db: AsyncSession = Depends(get_db),
) -> list[UserOut]:
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    if not actor.is_superadmin:
        visible = (
            ("consultor_lider_2", "consultor", "visualizador")
            if actor.is_lider_titular
            else ("consultor", "visualizador")
        )
        users = [u for u in users if u.role in visible or u.id == actor.id]
    return [UserOut.model_validate(u) for u in users]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    request: Request,
    actor: CurrentUser = Depends(require_lider),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    if not _can_manage_role(actor, payload.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "No podés crear usuarios con ese rol: el líder titular crea suplentes, "
            "consultores y visualizadores; el suplente crea consultores y visualizadores",
        )
    email = payload.email.lower().strip()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un usuario con ese email")
    from .auth import _check_password_strength

    _check_password_strength(payload.password)

    user = User(
        email=email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        role=payload.role,
        created_by=actor.id,
        # Seguridad: la contraseña la eligió otro (líder/superadmin) — el
        # sistema exige cambiarla en el primer ingreso.
        must_change_password=True,
    )
    db.add(user)
    await db.flush()
    await log_action(
        db, user_id=actor.id, user_email=actor.email, user_role=actor.role,
        action="user.create", entity_type="user", entity_id=user.id,
        detail={"email": email, "role": payload.role}, ip=client_ip(request),
    )
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    request: Request,
    actor: CurrentUser = Depends(require_lider),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    if not _can_manage_role(actor, user.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No podés gestionar este usuario")
    if payload.role and not _can_manage_role(actor, payload.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No podés asignar ese rol")

    changes: dict = {}
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
        changes["full_name"] = user.full_name
    if payload.role is not None:
        user.role = payload.role
        changes["role"] = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
        changes["is_active"] = payload.is_active
    if payload.password:
        from .auth import _check_password_strength

        _check_password_strength(payload.password)
        user.hashed_password = hash_password(payload.password)
        user.must_change_password = True  # reset por un admin → cambio obligatorio
        user.token_version = (user.token_version or 0) + 1  # invalida sesiones activas
        changes["password"] = "changed"

    await log_action(
        db, user_id=actor.id, user_email=actor.email, user_role=actor.role,
        action="user.update", entity_type="user", entity_id=user.id,
        detail=changes, ip=client_ip(request),
    )
    await db.refresh(user)
    return UserOut.model_validate(user)
