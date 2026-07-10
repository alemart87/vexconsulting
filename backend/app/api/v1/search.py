"""Búsqueda RAG manual sobre las fuentes del proyecto (para consultores)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...services.rag.retriever import format_citation, search_chunks
from ..deps import ProjectAccess, require_project_read

router = APIRouter(prefix="/projects/{project_id}/search", tags=["search"])


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    k: int = Field(default=8, ge=1, le=20)


@router.post("")
async def search(
    project_id: str,
    payload: SearchRequest,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> dict:
    results = await search_chunks(db, project_id, payload.query, k=payload.k)
    return {
        "query": payload.query,
        "results": [{**r, "citation": format_citation(r)} for r in results],
    }
