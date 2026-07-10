"""Autenticación: login dual (superadmin .env / usuarios DB), refresh y perfil."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.database import get_db
from ...core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from ...models.user import User
from ...schemas.auth import LoginRequest, MeResponse, TokenPair, TokenRefresh
from ...services.audit_service import log_action
from ..deps import CurrentUser, client_ip, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

SUPERADMIN_SELF_MSG = (
    "El superadmin gestiona sus credenciales desde la configuración del servidor (.env)."
)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/login", response_model=TokenPair)
async def login(
    payload: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TokenPair:
    email = payload.email.lower().strip()
    ip = client_ip(request)
    ua = request.headers.get("user-agent")

    # Caso 1: superadmin desde .env
    if email == settings.superadmin_email.lower().strip():
        password_ok = False
        if settings.superadmin_password:
            password_ok = secrets.compare_digest(payload.password, settings.superadmin_password)
        elif settings.superadmin_password_hash:
            password_ok = verify_password(payload.password, settings.superadmin_password_hash)

        if not password_ok:
            await log_action(
                db, user_id="superadmin", user_email=email, action="login_failed",
                ip=ip, user_agent=ua,
            )
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciales inválidas")

        await log_action(
            db, user_id="superadmin", user_email=email, user_role="superadmin",
            action="login", ip=ip, user_agent=ua,
        )
        return TokenPair(
            access_token=create_access_token(email, "superadmin"),
            refresh_token=create_refresh_token(email),
            user_email=email,
            user_role="superadmin",
            user_name=settings.superadmin_name,
            user_id="superadmin",
        )

    # Caso 2: usuario en DB
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not user.is_active or not verify_password(payload.password, user.hashed_password):
        await log_action(
            db, user_id=user.id if user else "unknown", user_email=email,
            action="login_failed", ip=ip, user_agent=ua,
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciales inválidas")

    user.last_login_at = datetime.now(timezone.utc)
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action="login", ip=ip, user_agent=ua,
    )
    return TokenPair(
        access_token=create_access_token(user.email, user.role),
        refresh_token=create_refresh_token(user.email),
        user_email=user.email,
        user_role=user.role,
        user_name=user.full_name,
        user_id=user.id,
        user_photo_url=user.photo_url,
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh_token(payload: TokenRefresh, db: AsyncSession = Depends(get_db)) -> TokenPair:
    try:
        data = decode_token(payload.refresh_token)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    if data.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token no es refresh")

    email = data.get("sub")
    if email == settings.superadmin_email:
        return TokenPair(
            access_token=create_access_token(email, "superadmin"),
            refresh_token=create_refresh_token(email),
            user_email=email,
            user_role="superadmin",
            user_name=settings.superadmin_name,
            user_id="superadmin",
        )

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario inválido o inactivo")
    return TokenPair(
        access_token=create_access_token(user.email, user.role),
        refresh_token=create_refresh_token(user.email),
        user_email=user.email,
        user_role=user.role,
        user_name=user.full_name,
        user_id=user.id,
        user_photo_url=user.photo_url,
    )


@router.get("/me", response_model=MeResponse)
async def me(user: CurrentUser = Depends(get_current_user)) -> MeResponse:
    return MeResponse(
        id=user.id, email=user.email, role=user.role,
        full_name=user.full_name, photo_url=user.photo_url,
    )


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if user.is_superadmin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, SUPERADMIN_SELF_MSG)
    target = await db.get(User, user.id)
    if not target or not verify_password(payload.current_password, target.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La contraseña actual no es correcta")
    target.hashed_password = hash_password(payload.new_password)
    await log_action(db, user_id=user.id, user_email=user.email, action="password_change")
    return {"ok": True}
