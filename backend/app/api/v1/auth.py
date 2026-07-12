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
    create_2fa_token,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from ...models.user import User
from ...schemas.auth import (
    LoginRequest,
    MeResponse,
    TokenPair,
    TokenRefresh,
    TwoFactorCode,
    TwoFactorLogin,
)
from ...services.audit_service import log_action
from ..deps import CurrentUser, client_ip, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

SUPERADMIN_SELF_MSG = (
    "El superadmin gestiona sus credenciales desde la configuración del servidor (.env)."
)

# ---------------------------------------------------------------------------
# Rate limiting del login (anti fuerza bruta): 5 intentos/min por IP+email.
# In-memory: suficiente para una instancia; en multi-instancia migrar a Redis.
# ---------------------------------------------------------------------------
import time
from collections import defaultdict, deque

_login_attempts: dict[str, deque] = defaultdict(deque)


def _rate_limit(key: str, limit: int = 5, window_s: int = 60) -> None:
    now = time.monotonic()
    bucket = _login_attempts[key]
    while bucket and bucket[0] < now - window_s:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Demasiados intentos: esperá un minuto y probá de nuevo",
        )
    bucket.append(now)


def _check_password_strength(password: str) -> None:
    if len(password) < 10:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mínimo 10 caracteres")
    if not any(c.isalpha() for c in password) or not any(c.isdigit() for c in password):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Debe combinar letras y números"
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
    _rate_limit(f"{ip}:{email}")

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

    # Doble factor activo: el login devuelve un token intermedio de 5 minutos
    # y los tokens definitivos se emiten recién al validar el código TOTP.
    if user.totp_enabled and user.totp_secret:
        await log_action(
            db, user_id=user.id, user_email=user.email, user_role=user.role,
            action="login_2fa_pending", ip=ip, user_agent=ua,
        )
        return TokenPair(requires_2fa=True, temp_token=create_2fa_token(user.email))

    user.last_login_at = datetime.now(timezone.utc)
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action="login", ip=ip, user_agent=ua,
    )
    return TokenPair(
        access_token=create_access_token(user.email, user.role, token_version=user.token_version or 0),
        refresh_token=create_refresh_token(user.email, token_version=user.token_version or 0),
        user_email=user.email,
        user_role=user.role,
        user_name=user.full_name,
        user_id=user.id,
        user_photo_url=user.photo_url,
        must_change_password=user.must_change_password,
    )


@router.post("/2fa", response_model=TokenPair)
async def login_2fa(
    payload: TwoFactorLogin,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TokenPair:
    """Segundo paso del login: valida el código TOTP contra el token intermedio."""
    import pyotp

    _rate_limit(f"2fa:{client_ip(request)}")

    try:
        data = decode_token(payload.temp_token)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    if data.get("type") != "2fa":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token intermedio inválido")

    result = await db.execute(select(User).where(User.email == data.get("sub")))
    user = result.scalar_one_or_none()
    if not user or not user.is_active or not user.totp_secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario inválido")

    if not pyotp.TOTP(user.totp_secret).verify(payload.code.strip(), valid_window=1):
        await log_action(
            db, user_id=user.id, user_email=user.email, action="login_2fa_failed",
            ip=client_ip(request),
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Código incorrecto o vencido")

    user.last_login_at = datetime.now(timezone.utc)
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action="login", ip=client_ip(request),
    )
    return TokenPair(
        access_token=create_access_token(user.email, user.role, token_version=user.token_version or 0),
        refresh_token=create_refresh_token(user.email, token_version=user.token_version or 0),
        user_email=user.email,
        user_role=user.role,
        user_name=user.full_name,
        user_id=user.id,
        user_photo_url=user.photo_url,
        must_change_password=user.must_change_password,
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
    if int(data.get("ver", 0) or 0) != int(user.token_version or 0):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión expirada: volvé a ingresar")
    return TokenPair(
        access_token=create_access_token(user.email, user.role, token_version=user.token_version or 0),
        refresh_token=create_refresh_token(user.email, token_version=user.token_version or 0),
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
    if payload.new_password == payload.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La nueva contraseña debe ser distinta")
    _check_password_strength(payload.new_password)
    target.hashed_password = hash_password(payload.new_password)
    target.must_change_password = False  # cumplió el reset obligatorio
    target.token_version = (target.token_version or 0) + 1  # invalida tokens viejos
    await log_action(db, user_id=user.id, user_email=user.email, action="password_change")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Doble factor (TOTP): setup con QR, activación y desactivación
# ---------------------------------------------------------------------------

@router.post("/2fa/setup")
async def setup_2fa(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Genera el secreto TOTP y la URL otpauth (el frontend dibuja el QR).
    Queda PENDIENTE hasta confirmar un código en /2fa/enable."""
    import pyotp

    if user.is_superadmin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, SUPERADMIN_SELF_MSG)
    target = await db.get(User, user.id)
    if target.totp_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El doble factor ya está activo")
    secret = pyotp.random_base32()
    target.totp_secret = secret
    await db.commit()
    otpauth = pyotp.TOTP(secret).provisioning_uri(
        name=user.email, issuer_name="VEX Consulting"
    )
    return {"secret": secret, "otpauth_url": otpauth}


@router.post("/2fa/enable")
async def enable_2fa(
    payload: TwoFactorCode,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    import pyotp

    target = await db.get(User, user.id) if not user.is_superadmin else None
    if not target or not target.totp_secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Primero generá el QR (setup)")
    if not pyotp.TOTP(target.totp_secret).verify(payload.code.strip(), valid_window=1):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Código incorrecto — probá de nuevo")
    target.totp_enabled = True
    await log_action(db, user_id=user.id, user_email=user.email, action="2fa_enabled")
    return {"ok": True}


@router.post("/2fa/disable")
async def disable_2fa(
    payload: TwoFactorCode,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    import pyotp

    target = await db.get(User, user.id) if not user.is_superadmin else None
    if not target or not target.totp_enabled or not target.totp_secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El doble factor no está activo")
    if not pyotp.TOTP(target.totp_secret).verify(payload.code.strip(), valid_window=1):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Código incorrecto")
    target.totp_enabled = False
    target.totp_secret = None
    await log_action(db, user_id=user.id, user_email=user.email, action="2fa_disabled")
    return {"ok": True}


@router.get("/2fa/status")
async def status_2fa(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if user.is_superadmin:
        return {"enabled": False, "available": False}
    target = await db.get(User, user.id)
    return {"enabled": bool(target and target.totp_enabled), "available": True}
