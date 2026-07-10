"""Esquemas del documento maestro y sus versiones."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class DocumentOut(BaseModel):
    id: str
    project_id: str
    current_version_id: Optional[str] = None
    content_md: str
    word_count: int
    lock_user_id: Optional[str] = None
    lock_user_name: Optional[str] = None
    lock_expires_at: Optional[datetime] = None
    final_edit_status: Optional[str] = None
    final_edit_detail: Optional[dict] = None
    updated_at: datetime

    model_config = {"from_attributes": True}


class DocumentSave(BaseModel):
    content_md: str
    base_version_id: Optional[str] = None  # versión sobre la que editó (control de conflicto)
    summary: Optional[str] = Field(default=None, max_length=500)
    force: bool = False  # true = guardar aunque haya conflicto (crea versión igual)


class VersionOut(BaseModel):
    id: str
    document_id: str
    project_id: str
    version_number: int
    summary: Optional[str] = None
    author_id: str
    author_name: str
    word_count: int
    words_added: int
    words_removed: int
    created_at: datetime

    model_config = {"from_attributes": True}


class VersionDetail(VersionOut):
    content_md: str
    diff_md: Optional[str] = None
