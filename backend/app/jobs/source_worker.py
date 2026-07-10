"""Worker de ingesta de fuentes: pending → extracción (subproceso) → chunks →
embeddings → ready. Claim atómico sobre Postgres; señal en memoria para latencia baja."""
from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone

from sqlalchemy import select, update

from ..core.config import settings
from ..core.database import session_scope
from ..models.source import Source
from ..models.source_chunk import SourceChunk
from ..services.rag.chunker import chunk_sections
from ..services.rag.embedder import embed_texts

logger = logging.getLogger("vexconsulting")

_signal = asyncio.Event()


def signal_source_queue() -> None:
    _signal.set()


def _extract_in_subprocess(kind: str, stored_path: str | None, url: str | None,
                           mime_type: str | None, max_rows: int) -> dict:
    """Punto de entrada del subproceso (import local para spawn)."""
    from app.services.rag.extractors import extract_source

    return extract_source(kind, stored_path, url, mime_type, max_rows)


async def _claim_next() -> str | None:
    """Toma la fuente pending más vieja de forma atómica (UPDATE ... WHERE status)."""
    async with session_scope() as db:
        result = await db.execute(
            select(Source.id)
            .where(Source.status == "pending")
            .order_by(Source.created_at)
            .limit(1)
        )
        source_id = result.scalar_one_or_none()
        if not source_id:
            return None
        claimed = await db.execute(
            update(Source)
            .where(Source.id == source_id, Source.status == "pending")
            .values(status="processing", started_at=datetime.now(timezone.utc))
        )
        await db.commit()
        return source_id if claimed.rowcount else None


async def _process(source_id: str, pool: ProcessPoolExecutor) -> None:
    async with session_scope() as db:
        source = await db.get(Source, source_id)
        if not source:
            return
        kind, stored_path, url, mime = source.kind, source.stored_path, source.url, source.mime_type
        project_id = source.project_id

    loop = asyncio.get_running_loop()
    try:
        extraction = await asyncio.wait_for(
            loop.run_in_executor(
                pool, _extract_in_subprocess, kind, stored_path, url, mime,
                settings.upload_max_rows,
            ),
            timeout=settings.upload_proc_timeout_s,
        )
    except asyncio.TimeoutError:
        await _fail(source_id, "El procesamiento superó el tiempo máximo permitido.")
        return
    except Exception as exc:
        await _fail(source_id, f"No se pudo extraer el contenido: {exc}")
        return

    sections = extraction.get("sections") or []
    chunks = chunk_sections(sections, settings.max_chunks_per_source)
    extracted_chars = sum(len(c["content"]) for c in chunks)

    embeddings = None
    embed_cost = 0.0
    if chunks and settings.openai_api_key:
        try:
            embeddings, embed_cost = await embed_texts([c["content"] for c in chunks])
        except Exception as exc:
            logger.warning("Embeddings fallaron para %s: %s (se indexa sin vector)", source_id, exc)

    async with session_scope() as db:
        source = await db.get(Source, source_id)
        if not source:
            return
        for idx, chunk in enumerate(chunks):
            db.add(SourceChunk(
                source_id=source_id,
                project_id=project_id,
                chunk_index=idx,
                content=chunk["content"],
                embedding=embeddings[idx] if embeddings else None,
                meta=chunk["meta"] or None,
                token_count=chunk["token_count"],
            ))
        source.status = "ready" if chunks else "failed"
        if not chunks:
            source.last_error = (
                "El archivo no contiene texto extraíble (si es un PDF escaneado, "
                "verificá que el OCR esté habilitado y reintentá)."
            )
        source.chunk_count = len(chunks)
        source.extracted_chars = extracted_chars
        source.page_count = extraction.get("page_count")
        source.embedding_cost_usd = embed_cost or None
        if extraction.get("title_hint") and source.kind == "link" and source.title == source.url:
            source.title = extraction["title_hint"][:500]
        source.finished_at = datetime.now(timezone.utc)
        await db.commit()
    logger.info("Fuente %s procesada: %s chunks", source_id[:8], len(chunks))


async def _fail(source_id: str, message: str) -> None:
    async with session_scope() as db:
        source = await db.get(Source, source_id)
        if source:
            source.status = "failed"
            source.last_error = message[:2000]
            source.finished_at = datetime.now(timezone.utc)
            await db.commit()
    logger.warning("Fuente %s falló: %s", source_id[:8], message)


async def recover_stale() -> None:
    """Al reiniciar: lo que quedó en processing vuelve a pending."""
    async with session_scope() as db:
        await db.execute(
            update(Source).where(Source.status == "processing").values(status="pending")
        )
        await db.commit()


async def source_worker() -> None:
    pool = ProcessPoolExecutor(max_workers=1)
    logger.info("source_worker iniciado")
    try:
        while True:
            source_id = await _claim_next()
            if source_id:
                try:
                    await _process(source_id, pool)
                except Exception as exc:
                    logger.exception("Error procesando fuente %s", source_id)
                    await _fail(source_id, f"Error interno: {exc}")
                continue
            _signal.clear()
            try:
                await asyncio.wait_for(_signal.wait(), timeout=15)
            except asyncio.TimeoutError:
                pass
    except asyncio.CancelledError:
        pool.shutdown(wait=False, cancel_futures=True)
        raise
