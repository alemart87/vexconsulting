"""Membresías del proyecto: asignación de consultores y permisos."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.project_member import ProjectMember
from ...models.user import User
from ...schemas.project import MemberAdd, MemberOut, MemberUpdate
from ...services.audit_service import log_action
from ..deps import ProjectAccess, client_ip, require_project_admin, require_project_read

router = APIRouter(prefix="/projects/{project_id}/members", tags=["members"])


async def _member_out(db: AsyncSession, member: ProjectMember) -> MemberOut:
    out = MemberOut.model_validate(member)
    user = await db.get(User, member.user_id)
    if user:
        out.user_name = user.full_name
        out.user_email = user.email
        out.user_role = user.role
    return out


@router.get("", response_model=list[MemberOut])
async def list_members(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> list[MemberOut]:
    result = await db.execute(
        select(ProjectMember).where(ProjectMember.project_id == project_id)
    )
    return [await _member_out(db, m) for m in result.scalars().all()]


@router.post("", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
async def add_member(
    project_id: str,
    payload: MemberAdd,
    request: Request,
    access: ProjectAccess = Depends(require_project_admin),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    user = await db.get(User, payload.user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado o inactivo")
    if user.role == "visualizador" and payload.permission != "read":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Los visualizadores solo pueden tener permiso de lectura"
        )
    existing = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.user_id == payload.user_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "El usuario ya es miembro del proyecto")

    member = ProjectMember(
        project_id=project_id,
        user_id=payload.user_id,
        permission=payload.permission,
        added_by=access.user.id,
    )
    db.add(member)
    await db.flush()
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="member.assign", project_id=project_id, entity_type="member", entity_id=member.id,
        detail={"user": user.email, "permission": payload.permission}, ip=client_ip(request),
    )
    await db.refresh(member)
    return await _member_out(db, member)


@router.patch("/{member_id}", response_model=MemberOut)
async def update_member(
    project_id: str,
    member_id: str,
    payload: MemberUpdate,
    request: Request,
    access: ProjectAccess = Depends(require_project_admin),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    member = await db.get(ProjectMember, member_id)
    if not member or member.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membresía no encontrada")
    user = await db.get(User, member.user_id)
    if user and user.role == "visualizador" and payload.permission != "read":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Los visualizadores solo pueden tener permiso de lectura"
        )
    member.permission = payload.permission
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="member.update", project_id=project_id, entity_type="member", entity_id=member.id,
        detail={"permission": payload.permission}, ip=client_ip(request),
    )
    await db.refresh(member)
    return await _member_out(db, member)


@router.delete("/{member_id}")
async def remove_member(
    project_id: str,
    member_id: str,
    request: Request,
    access: ProjectAccess = Depends(require_project_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    member = await db.get(ProjectMember, member_id)
    if not member or member.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membresía no encontrada")
    await db.delete(member)
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="member.remove", project_id=project_id, entity_type="member", entity_id=member_id,
        ip=client_ip(request),
    )
    return {"ok": True}
