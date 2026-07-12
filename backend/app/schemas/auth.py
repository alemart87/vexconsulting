"""Esquemas de autenticación."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenPair(BaseModel):
    # Con 2FA activo el login devuelve solo requires_2fa + temp_token;
    # los tokens definitivos llegan tras validar el código en /auth/2fa.
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    user_email: str = ""
    user_role: str = ""
    user_name: str = ""
    user_id: str = ""
    user_photo_url: Optional[str] = None
    must_change_password: bool = False
    requires_2fa: bool = False
    temp_token: Optional[str] = None


class TwoFactorLogin(BaseModel):
    temp_token: str
    code: str = Field(min_length=6, max_length=8)


class TwoFactorCode(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class TokenRefresh(BaseModel):
    refresh_token: str


class MeResponse(BaseModel):
    id: str
    email: str
    role: str
    full_name: str
    photo_url: Optional[str] = None
