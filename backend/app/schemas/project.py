"""Esquemas de proyectos y membresías."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


Permission = Literal["read", "write", "admin"]


class ProjectCreate(BaseModel):
    name: str = Field(min_length=3, max_length=300)
    description: Optional[str] = None
    template_slug: Optional[str] = "blank"
    # None → la plantilla sugiere el rol (capacitación → diseñador instruccional)
    agent_role_slug: Optional[str] = None
    # Proyecto vinculado (ej.: material del curso → su plan de capacitación).
    # El documento del vinculado se carga como fuente del proyecto nuevo.
    related_project_id: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=3, max_length=300)
    description: Optional[str] = None
    agent_role_slug: Optional[str] = None
    agent_instructions_override: Optional[str] = None


class ProjectOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    status: str
    template_slug: Optional[str] = None
    agent_role_slug: str
    owner_id: str
    owner_name: Optional[str] = None
    related_project_id: Optional[str] = None
    related_project_name: Optional[str] = None
    published_version_id: Optional[str] = None
    published_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    my_permission: Optional[str] = None
    member_count: Optional[int] = None
    word_count: Optional[int] = None

    model_config = {"from_attributes": True}


class MemberAdd(BaseModel):
    user_id: str
    permission: Permission = "read"


class MemberUpdate(BaseModel):
    permission: Permission


class MemberOut(BaseModel):
    id: str
    project_id: str
    user_id: str
    permission: str
    added_by: Optional[str] = None
    created_at: datetime
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    user_role: Optional[str] = None

    model_config = {"from_attributes": True}
