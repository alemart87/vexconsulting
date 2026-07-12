"""Documento maestro: lectura, guardado con versionado, lock, vista publicada
y edición final APA (job de fondo previo a publicar)."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db, session_scope
from ...models.document import Document
from ...models.document_version import DocumentVersion
from ...models.project import Project
from ...models.source import Source
from ...schemas.document import DocumentOut, DocumentSave, VersionDetail
from ...services import document_service
from ...services.audit_service import log_action
from ..deps import ProjectAccess, client_ip, require_project_read, require_project_write

logger = logging.getLogger("vexconsulting")

router = APIRouter(prefix="/projects/{project_id}/document", tags=["documents"])


@router.get("", response_model=DocumentOut)
async def get_document(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    doc = await document_service.get_or_create_document(db, project_id)
    return DocumentOut.model_validate(doc)


@router.put("", response_model=DocumentOut)
async def save_document(
    project_id: str,
    payload: DocumentSave,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    doc = await document_service.get_or_create_document(db, project_id)
    version = await document_service.save_document(
        db,
        doc,
        access.user,
        content_md=payload.content_md,
        base_version_id=payload.base_version_id,
        summary=payload.summary,
        force=payload.force,
    )
    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="document.save", project_id=project_id, entity_type="version",
        entity_id=version.id,
        detail={
            "version": version.version_number,
            "words": version.word_count,
            "added": version.words_added,
            "removed": version.words_removed,
        },
        ip=client_ip(request),
    )
    await db.refresh(doc)
    return DocumentOut.model_validate(doc)


@router.post("/lock", response_model=DocumentOut)
async def lock_document(
    project_id: str,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    doc = await document_service.get_or_create_document(db, project_id)
    doc = await document_service.acquire_lock(db, doc, access.user)
    return DocumentOut.model_validate(doc)


@router.delete("/lock")
async def unlock_document(
    project_id: str,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    doc = await document_service.get_or_create_document(db, project_id)
    await document_service.release_lock(db, doc, access.user)
    return {"ok": True}


async def _final_edit_job(project_id: str, user_id: str, user_name: str,
                          user_email: str, user_role: str) -> None:
    """Job de fondo: edita el documento con normas APA y guarda una versión nueva."""
    from ...services.agent.final_editor import run_final_edit

    async with session_scope() as db:
        doc = (await db.execute(
            select(Document).where(Document.project_id == project_id)
        )).scalar_one_or_none()
        project = await db.get(Project, project_id)
        if not doc or not project:
            return
        content = doc.content_md or ""
        project_name = project.name
        rows = (await db.execute(
            select(Source).where(Source.project_id == project_id)
            .order_by(Source.created_at)
        )).scalars().all()
        sources = [
            {
                "titulo": s.title,
                "tipo": s.kind,
                "url": s.url,
                "anio_carga": s.created_at.year if s.created_at else None,
                "meta_de_cita": s.citation_meta,
            }
            for s in rows
        ]

    error: str | None = None
    final_md, stats, cost = "", {}, 0.0
    try:
        final_md, stats, cost = await run_final_edit(
            content_md=content, project_name=project_name, sources=sources,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Edición final falló en proyecto %s", project_id[:8])
        error = str(exc)[:400]

    async with session_scope() as db:
        doc = (await db.execute(
            select(Document).where(Document.project_id == project_id)
        )).scalar_one_or_none()
        if not doc:
            return
        if error:
            doc.final_edit_status = "failed"
            doc.final_edit_detail = {"error": error}
            await db.commit()
            return
        author = SimpleNamespace(id=user_id, full_name=user_name, is_superadmin=False)
        try:
            version = await document_service.save_document(
                db, doc, author, content_md=final_md, base_version_id=None,
                summary=f"Edición final APA (IA) · solicitada por {user_name}",
                force=True,
            )
        except HTTPException as exc:
            doc.final_edit_status = "failed"
            doc.final_edit_detail = {"error": exc.detail}
            await db.commit()
            return
        doc.final_edit_status = "done"
        doc.final_edit_detail = {
            **stats,
            "version_number": version.version_number,
            "cost_usd": round(cost, 4),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }
        await log_action(
            db, user_id=user_id, user_email=user_email, user_role=user_role,
            action="document.final_edit", project_id=project_id,
            entity_type="version", entity_id=version.id,
            detail={"version": version.version_number, "cost_usd": round(cost, 4), **stats},
        )
        await db.commit()
    logger.info("Edición final OK en proyecto %s (v%s, USD %.4f)",
                project_id[:8], stats.get("version_number", "?"), cost)


@router.post("/final-edit", response_model=DocumentOut)
async def request_final_edit(
    project_id: str,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    """Lanza la edición final APA en segundo plano (sobrevive a la navegación).

    El resultado se guarda como versión nueva: se revisa con el diff del
    historial y recién después se publica.
    """
    doc = await document_service.get_or_create_document(db, project_id)
    if doc.final_edit_status == "running":
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya hay una edición final en curso")
    if not (doc.content_md or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El documento está vacío")
    doc.final_edit_status = "running"
    doc.final_edit_detail = {"started_at": datetime.now(timezone.utc).isoformat()}
    await db.commit()
    await db.refresh(doc)
    asyncio.create_task(_final_edit_job(
        project_id, access.user.id, access.user.full_name,
        access.user.email, access.user.role,
    ))
    return DocumentOut.model_validate(doc)


@router.post("/integrate")
async def integrate_content(
    project_id: str,
    payload: dict,
    request: Request,
    access: ProjectAccess = Depends(require_project_write),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """«Insertar donde corresponde»: el agente integrador lee el documento,
    decide en qué secciones va el contenido investigado y lo edita con
    criterio. Guarda una versión nueva revisable."""
    from ...services.agent.integrator import apply_ops, plan_integration

    content = str(payload.get("content") or "").strip()
    if len(content) < 40:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No hay contenido para integrar")

    doc = await document_service.get_or_create_document(db, project_id)
    if not (doc.content_md or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El documento está vacío")

    try:
        ops, resumen, cost, breakdown = await plan_integration(
            doc.content_md or "", content, hint=str(payload.get("hint") or "") or None
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Integración falló en proyecto %s", project_id[:8])
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"El integrador falló: {str(exc)[:200]}"
        )

    new_md, secciones = apply_ops(doc.content_md or "", ops)
    version = await document_service.save_document(
        db, doc, access.user, content_md=new_md, base_version_id=None,
        summary=f"Integración con criterio (IA): {(resumen or content[:80])[:400]}",
        force=True,
    )

    # Trazabilidad + Costos IA: el paso queda en el hilo del investigador
    conversation_id = payload.get("conversation_id")
    if conversation_id:
        from ...models.conversation import Conversation, Message

        conv = await db.get(Conversation, conversation_id)
        if conv and conv.project_id == project_id:
            db.add(Message(
                conversation_id=conversation_id, role="assistant",
                content=f"[Integración en el documento] {resumen or ''} · secciones: "
                        f"{', '.join(secciones) or '—'} · versión {version.version_number}",
                tool_calls={"status": "done", "engine": "vex", "integracion": True,
                            "cost_openai": cost, "model": breakdown.get("model")},
                input_tokens=breakdown.get("input_tokens", 0),
                cached_tokens=breakdown.get("cached_tokens", 0),
                output_tokens=breakdown.get("output_tokens", 0),
                total_tokens=breakdown.get("input_tokens", 0) + breakdown.get("output_tokens", 0),
                cost_usd=cost,
            ))

    await log_action(
        db, user_id=access.user.id, user_email=access.user.email, user_role=access.user.role,
        action="document.integrate", project_id=project_id, entity_type="version",
        entity_id=version.id,
        detail={"version": version.version_number, "secciones": secciones,
                "cost_usd": round(cost, 4), "resumen": (resumen or "")[:200]},
        ip=client_ip(request),
    )
    await db.commit()
    return {
        "version_number": version.version_number,
        "secciones": secciones,
        "resumen": resumen,
        "cost_usd": round(cost, 4),
    }


@router.get("/published", response_model=VersionDetail)
async def get_published(
    project_id: str,
    access: ProjectAccess = Depends(require_project_read),
    db: AsyncSession = Depends(get_db),
) -> VersionDetail:
    """Versión congelada al publicar — lo único visible para visualizadores."""
    project = access.project
    if project.status != "publicado" or not project.published_version_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "El proyecto no tiene versión publicada")
    version = await db.get(DocumentVersion, project.published_version_id)
    if not version:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Versión publicada no encontrada")
    return VersionDetail.model_validate(version)
