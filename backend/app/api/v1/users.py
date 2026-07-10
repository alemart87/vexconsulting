"""Gestión jerárquica de usuarios.

superadmin crea líderes, consultores y visualizadores;
consultor_lider crea consultores y visualizadores (no líderes).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...core.security import hash_password
from ...models.user import User
from ...schemas.user import UserCreate, UserOut, UserUpdate
from ...services.audit_service import log_action
from ..deps import CurrentUser, client_ip, require_lider

router = APIRouter(prefix="/users", tags=["users"])


def _can_manage_role(actor: CurrentUser, target_role: str) -> bool:
    if actor.is_superadmin:
        return True
    if actor.is_lider:
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
        users = [u for u in users if u.role in ("consultor", "visualizador") or u.id == actor.id]
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
            "Un consultor líder solo puede crear consultores y visualizadores",
        )
    email = payload.email.lower().strip()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un usuario con ese email")

    user = User(
        email=email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        role=payload.role,
        created_by=actor.id,
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
        user.hashed_password = hash_password(payload.password)
        changes["password"] = "changed"

    await log_action(
        db, user_id=actor.id, user_email=actor.email, user_role=actor.role,
        action="user.update", entity_type="user", entity_id=user.id,
        detail=changes, ip=client_ip(request),
    )
    await db.refresh(user)
    return UserOut.model_validate(user)
