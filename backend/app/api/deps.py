"""Dependencias de autenticación y autorización.

El superadmin vive SOLO en .env (usuario sintético, nunca en DB).
Jerarquía: superadmin > consultor_lider > consultor_lider_2 (suplente)
> consultor > visualizador. El suplente tiene las MISMAS atribuciones que
el líder (crear usuarios, crear proyectos) pero depende jerárquicamente de
él: no puede gestionar líderes ni a otros suplentes.
El acceso a cada proyecto se resuelve con ProjectAccess (permiso efectivo).

gerente_operaciones es un rol INDEPENDIENTE: no participa de la consultoría
(proyectos, chat, agentes). Solo accede al módulo VEXFINANZAS (junto con el
superadmin). Se bloquea en get_current_user cualquier ruta fuera de su alcance.
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
    must_change_password: bool = False

    @property
    def is_superadmin(self) -> bool:
        return self.role == "superadmin"

    @property
    def is_lider(self) -> bool:
        """Atribuciones de líder: titular Y suplente (consultor_lider_2)."""
        return self.role in ("consultor_lider", "consultor_lider_2")

    @property
    def is_lider_titular(self) -> bool:
        """Solo el consultor líder titular (jerarquía sobre el suplente)."""
        return self.role == "consultor_lider"

    @property
    def is_consultor(self) -> bool:
        return self.role in ("consultor_lider", "consultor_lider_2", "consultor")

    @property
    def is_visualizador(self) -> bool:
        return self.role == "visualizador"

    @property
    def is_gerente(self) -> bool:
        """Gerente de Operaciones: módulo VEXFINANZAS únicamente."""
        return self.role == "gerente_operaciones"

    @property
    def can_finanzas(self) -> bool:
        """Acceso al módulo VEXFINANZAS: superadmin y gerentes (nadie más)."""
        return self.is_superadmin or self.is_gerente


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

    # Tokens emitidos antes de un cambio de contraseña quedan inválidos
    if int(payload.get("ver", 0) or 0) != int(user.token_version or 0):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión expirada: volvé a ingresar")

    # Cambio de contraseña obligatorio (cuenta creada por un líder/superadmin):
    # se bloquea toda la API salvo autenticación y el propio cambio.
    if user.must_change_password and not request.url.path.startswith("/api/v1/auth/"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "password_change_required")

    # Doble factor OBLIGATORIO: hasta activar TOTP solo se permite autenticación
    # (setup/enable del 2FA viven ahí) y el cambio de contraseña.
    if (
        settings.require_2fa
        and not user.totp_enabled
        and not request.url.path.startswith("/api/v1/auth/")
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "2fa_setup_required")

    # El gerente de operaciones NO entra a la consultoría: solo su módulo,
    # su perfil y sus notificaciones.
    if user.role == "gerente_operaciones" and not _gerente_path_allowed(request.url.path):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Tu rol solo accede al módulo VEXFINANZAS"
        )

    return CurrentUser(
        id=user.id,
        email=user.email,
        role=user.role,
        full_name=user.full_name,
        photo_url=user.photo_url,
        must_change_password=user.must_change_password,
    )


_GERENTE_PREFIXES = (
    "/api/v1/auth/",
    "/api/v1/finanzas",
    "/api/v1/notifications",
    "/api/v1/users/me/",
    "/api/v1/avatars/",
)


def _gerente_path_allowed(path: str) -> bool:
    return any(path.startswith(p) for p in _GERENTE_PREFIXES)


async def require_finanzas(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Módulo VEXFINANZAS: superadmin y gerentes de operaciones."""
    if not user.can_finanzas:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "El módulo VEXFINANZAS es solo para gerentes de operaciones"
        )
    return user


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
    """Cualquier rol de consultoría (ni visualizador ni gerente)."""
    if user.is_visualizador or user.is_gerente:
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
