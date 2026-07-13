"""Worker de exportación: pending → render en subproceso → done/failed."""
from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone

from sqlalchemy import select, update

from ..core.config import settings
from ..core.database import session_scope
from ..models.document import Document
from ..models.document_version import DocumentVersion
from ..models.export_job import ExportJob
from ..models.project import Project

logger = logging.getLogger("vexconsulting")

_signal = asyncio.Event()


def signal_export_queue() -> None:
    _signal.set()


def _export_in_subprocess(fmt: str, content_md: str, title: str, author_note: str,
                          output_path: str, upload_root: str, project_id: str,
                          options: dict | None = None) -> None:
    from app.services.export.renderer import run_export

    run_export(fmt, content_md, title, author_note, output_path, upload_root,
               project_id, options)


async def recover_stale_exports() -> None:
    async with session_scope() as db:
        await db.execute(
            update(ExportJob).where(ExportJob.status == "processing")
            .values(status="failed", last_error="Interrumpido por reinicio del servidor")
        )
        await db.commit()


async def _claim_next() -> str | None:
    async with session_scope() as db:
        result = await db.execute(
            select(ExportJob.id).where(ExportJob.status == "pending")
            .order_by(ExportJob.created_at).limit(1)
        )
        job_id = result.scalar_one_or_none()
        if not job_id:
            return None
        claimed = await db.execute(
            update(ExportJob).where(ExportJob.id == job_id, ExportJob.status == "pending")
            .values(status="processing")
        )
        await db.commit()
        return job_id if claimed.rowcount else None


async def _process(job_id: str, pool: ProcessPoolExecutor) -> None:
    async with session_scope() as db:
        job = await db.get(ExportJob, job_id)
        if not job:
            return
        project = await db.get(Project, job.project_id)
        if job.document_version_id:
            version = await db.get(DocumentVersion, job.document_version_id)
            content = version.content_md if version else ""
            vnum = version.version_number if version else "?"
        else:
            result = await db.execute(
                select(Document).where(Document.project_id == job.project_id)
            )
            doc = result.scalar_one_or_none()
            content = doc.content_md if doc else ""
            vnum = "actual"
        title = project.name if project else "Documento"
        project_id = job.project_id
        fmt = job.format
        options = job.options or None

    out_dir = settings.export_path / project_id
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    ext = "pdf" if fmt == "paper" else fmt
    output_path = str(out_dir / f"{stamp}-v{vnum}.{ext}")
    author_note = f"Versión {vnum} · exportado {datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M')} UTC"

    loop = asyncio.get_running_loop()
    try:
        await asyncio.wait_for(
            loop.run_in_executor(
                pool, _export_in_subprocess, fmt, content, title, author_note,
                output_path, str(settings.upload_path), project_id, options,
            ),
            timeout=settings.upload_proc_timeout_s,
        )
        error = None
    except asyncio.TimeoutError:
        error = "La exportación superó el tiempo máximo."
    except Exception as exc:
        message = str(exc)
        if "pandoc" in message.lower():
            message = "Pandoc no está disponible en este servidor (requerido para Word)."
        elif "libgobject" in message or "cairo" in message.lower() or "pango" in message.lower():
            message = "Las librerías de PDF (Pango/Cairo) no están disponibles en este servidor."
        error = f"No se pudo exportar: {message[:500]}"

    async with session_scope() as db:
        job = await db.get(ExportJob, job_id)
        if not job:
            return
        if error:
            job.status = "failed"
            job.last_error = error
        else:
            job.status = "done"
            job.output_path = output_path
        job.finished_at = datetime.now(timezone.utc)
        await db.commit()
    logger.info("Export %s: %s", job_id[:8], error or "OK")


async def export_worker() -> None:
    pool = ProcessPoolExecutor(max_workers=1)
    logger.info("export_worker iniciado")
    try:
        while True:
            job_id = await _claim_next()
            if job_id:
                try:
                    await _process(job_id, pool)
                except Exception:
                    logger.exception("Error en export %s", job_id)
                continue
            _signal.clear()
            try:
                await asyncio.wait_for(_signal.wait(), timeout=20)
            except asyncio.TimeoutError:
                pass
    except asyncio.CancelledError:
        pool.shutdown(wait=False, cancel_futures=True)
        raise
