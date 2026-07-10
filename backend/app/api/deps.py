"""Dependencias de autenticación y autorización.

El superadmin vive SOLO en .env (usuario sintético, nunca en DB).
Jerarquía: superadmin > consultor_lider > consultor > visualizador.
El acceso a cada proyecto se resuelve con ProjectAccess (permiso efectivo).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.database import get_db
from ..core.security import decode_token
from ..models.project import Project
from ..models.project_member import ProjectMember
from ..models.user import User

bearer = HTTPBearer(auto_error=False)

_PERM_ORDER = {"read": 0, "write": 1, "admin": 2}


@dataclass
class CurrentUser:
    id: str
    email: str
    role: str
    full_name: str
    photo_url: Optional[str] = None

    @property
    def is_superadmin(self) -> bool:
        return self.role == "superadmin"

    @property
    def is_lider(self) -> bool:
        return self.role == "consultor_lider"

    @property
    def is_consultor(self) -> bool:
        return self.role in ("consultor_lider", "consultor")

    @property
    def is_visualizador(self) -> bool:
        return self.role == "visualizador"


@dataclass
class ProjectAccess:
    project: Project
    user: CurrentUser
    permission: str  # read | write | admin

    def at_least(self, needed: str) -> bool:
        return _PERM_ORDER[self.permission] >= _PERM_ORDER[needed]


async def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Falta token de autenticación")

    try:
        payload = decode_token(creds.credentials)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token no es de tipo access")

    subject = payload.get("sub")
    role = payload.get("role")

    # Superadmin sintético: nunca toca la DB
    if subject == settings.superadmin_email and role == "superadmin":
        return CurrentUser(
            id="superadmin",
            email=settings.superadmin_email,
            role="superadmin",
            full_name=settings.superadmin_name,
        )

    result = await db.execute(select(User).where(User.email == subject))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario inválido o inactivo")

    return CurrentUser(
        id=user.id,
        email=user.email,
        role=user.role,
        full_name=user.full_name,
        photo_url=user.photo_url,
    )


async def require_superadmin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Se requiere rol superadmin")
    return user


async def require_lider(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Superadmin o consultor líder."""
    if not (user.is_superadmin or user.is_lider):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requiere rol consultor líder")
    return user


async def require_consultor(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Cualquier rol excepto visualizador."""
    if user.is_visualizador:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Los visualizadores no acceden a esta función")
    return user


async def resolve_project_access(
    project_id: str,
    user: CurrentUser,
    db: AsyncSession,
) -> ProjectAccess:
    """Permiso efectivo del usuario sobre el proyecto.

    superadmin → admin en todo; dueño → admin; miembro → su permiso;
    visualizador → read solo si es miembro Y el proyecto está publicado.
    """
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proyecto no encontrado")

    if user.is_superadmin:
        return ProjectAccess(project=project, user=user, permission="admin")

    if project.owner_id == user.id:
        return ProjectAccess(project=project, user=user, permission="admin")

    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No sos miembro de este proyecto")

    if user.is_visualizador:
        if project.status != "publicado":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "El proyecto aún no está publicado"
            )
        return ProjectAccess(project=project, user=user, permission="read")

    return ProjectAccess(project=project, user=user, permission=member.permission)


def require_project_permission(needed: str):
    """Factory de dependencia: valida permiso mínimo sobre el proyecto del path."""

    async def dependency(
        project_id: str,
        user: CurrentUser = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> ProjectAccess:
        access = await resolve_project_access(project_id, user, db)
        if not access.at_least(needed):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Requiere permiso «{needed}» sobre el proyecto",
            )
        return access

    return dependency


require_project_read = require_project_permission("read")
require_project_write = require_project_permission("write")
require_project_admin = require_project_permission("admin")


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
