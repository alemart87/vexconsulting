"""Esquemas de autenticación."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_email: str
    user_role: str
    user_name: str
    user_id: str = ""
    user_photo_url: Optional[str] = None


class TokenRefresh(BaseModel):
    refresh_token: str


class MeResponse(BaseModel):
    id: str
    email: str
    role: str
    full_name: str
    photo_url: Optional[str] = None
