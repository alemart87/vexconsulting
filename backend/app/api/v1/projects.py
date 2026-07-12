"""Proyectos: CRUD, publicación y listado filtrado por membresía."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.document import Document
from ...models.project import Project
from ...models.project_member import ProjectMember
from ...schemas.project import ProjectCreate, ProjectOut, ProjectUpdate
from ...services import templates as template_service
from ...services.audit_service import log_action
from ...services.document_service import get_or_create_document
from ..deps import (
    CurrentUser,
    ProjectAccess,
    client_ip,
    get_current_user,
    require_lider,
    require_project_admin,
    require_project_read,
)

router = APIRouter(prefix="/projects", tags=["projects"])


async def _project_out(
    db: AsyncSession, project: Project, permission: str | None = None
) -> ProjectOut:
    out = ProjectOut.model_validate(project)
    out.my_permission = permission
    count = await db.execute(
        select(func.count(ProjectMember.id)).where(ProjectMember.project_id == project.id)
    )
    out.member_count = int(count.scalar_one() or 0)
    doc = await db.execute(
        select(Document.word_count).where(Document.project_id == project.id)
    )
    out.word_count = doc.scalar_one_or_none() or 0
    return out


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectOut]:
    if user.is_superadmin:
        result = await db.execute(select(Project).order_by(Project.updated_at.desc()))
        projects = [(p, "admin") for p in result.scalars().all()]
    else:
        owned = await db.execute(
            select(Project).where(Project.owner_id == user.id)
        )
        memberships = await db.execute(
            select(Project, ProjectMember.permission)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(ProjectMember.user_id == user.id)
        )
        seen: dict[str, tuple[Project, str]] = {}
        for p in owned.scalars().all():
            seen[p.id] = (p, "admin")
        for p, perm in memberships.all():
            if p.id not in seen:
                if user.is_visualizador and p.status != "publicado":
                    continue
                seen[p.id] = (p, "read" if user.is_visualizador else perm)
        projects = sorted(seen.values(), key=lambda t: t[0].updated_at or t[0].created_at, reverse=True)

    return [await _project_out(db, p, perm) for p, perm in projects]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    request: Request,
    actor: CurrentUser = Depends(require_lider),
    db: AsyncSession = Depends(get_db),
) -> ProjectOut:
    project = Project(
        name=payload.name.strip(),
        description=payload.description,
        template_slug=payload.template_slug or "blank",
        # Sin elección explícita, la plantilla sugiere el rol del agente
        # (ej.: capacitaciones → diseñador instruccional)
        agent_role_slug=payload.agent_role_slug
        or template_service.suggested_role(payload.template_slug)
        or "consultor_bpo",
        owner_id=actor.id,
        owner_name=actor.full_name,
    )
    db.add(project)
    await db.flush()

    # Documento maestro inicial según plantilla metodológica
    doc = Document(
        project_id=project.id,
        content_md=template_service.initial_content(payload.template_slug or "blank", project.name),
    )
    db.add(doc)
    await log_action(
        db, user_id=actor.id, user_email=actor.email, user_role=actor.role,
        action="project.create", project_id=project.id, entity_type="project",
        entity_id=project.id, detail={"name": project.name, "template": project.template_slug},
        ip=client_ip(request),
    )
    await db.refresh(project)
    await template_service.seed_project_extras(db, project, actor)
    return await _project_out(db, project, "admin")


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> ProjectOut:
    return await _project_out(db, access.project, access.permission)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    payload: ProjectUpdate,
    request: Request,
    access: ProjectAccess = Depends(require_project_admin),
    db: AsyncSession = Depends(get_db),
) -> ProjectOut:
    project = access.project
    changes: dict = {}
    for field in ("name", "description", "agent_role_slug", "agent_instructions_override"):
        value = getattr(payload, field)
        if value is not None:
            setattr(project, field, value.strip() if isinstance(value, str) else value)
            changes[field] = value if field != "agent_instructions_override" else "updated"
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="project.update", project_id=project.id, entity_type="project",
        entity_id=project.id, detail=changes, ip=client_ip(request),
    )
    await db.refresh(project)
    return await _project_out(db, project, access.permission)


@router.post("/{project_id}/publish", response_model=ProjectOut)
async def publish_project(
    project_id: str,
    request: Request,
    access: ProjectAccess = Depends(require_project_admin),
    db: AsyncSession = Depends(get_db),
) -> ProjectOut:
    project = access.project
    doc = await get_or_create_document(db, project.id)
    if not doc.current_version_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "El documento no tiene versiones guardadas; guardá al menos una antes de publicar",
        )
    project.status = "publicado"
    project.published_version_id = doc.current_version_id
    project.published_at = datetime.now(timezone.utc)
    project.published_by = access.user.id
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="project.publish", project_id=project.id, entity_type="project",
        entity_id=project.id, detail={"version_id": doc.current_version_id},
        ip=client_ip(request),
    )
    await db.refresh(project)
    return await _project_out(db, project, access.permission)


@router.post("/{project_id}/unpublish", response_model=ProjectOut)
async def unpublish_project(
    project_id: str,
    request: Request,
    access: ProjectAccess = Depends(require_project_admin),
    db: AsyncSession = Depends(get_db),
) -> ProjectOut:
    project = access.project
    project.status = "borrador"
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="project.unpublish", project_id=project.id, entity_type="project",
        entity_id=project.id, ip=client_ip(request),
    )
    await db.refresh(project)
    return await _project_out(db, project, access.permission)
