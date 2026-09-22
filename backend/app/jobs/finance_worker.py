"""Worker de VEXFINANZAS: ejecuta el cruce de una sesión en segundo plano.

Mismo patrón que el resto de los jobs (cola en DB + señal asyncio): el
navegador solo hace polls cortos y nada queda «corriendo» para siempre.
El parseo de los Excel corre en un hilo para no bloquear el event loop.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import delete, insert, select, update

from ..core.database import session_scope
from ..models.finance import FinanceCollaborator, FinanceEntry, FinanceFile, FinanceSession
from ..services.finance_service import FileInput, build_analysis, parse_workbook

logger = logging.getLogger("vexconsulting")

_signal = asyncio.Event()

RUN_TIMEOUT = 10 * 60
INSERT_CHUNK = 1500


def signal_finance_queue() -> None:
    _signal.set()


async def recover_stale_finance() -> None:
    """Tras un reinicio: sesiones running → failed (se pueden relanzar)."""
    async with session_scope() as db:
        await db.execute(
            update(FinanceSession).where(FinanceSession.status == "running")
            .values(status="failed", last_error="Interrumpido por reinicio del servidor. Ejecutá de nuevo.")
        )
        await db.commit()


async def _claim_next() -> str | None:
    async with session_scope() as db:
        result = await db.execute(
            select(FinanceSession.id).where(FinanceSession.status == "queued")
            .order_by(FinanceSession.updated_at).limit(1)
        )
        sid = result.scalar_one_or_none()
        if not sid:
            return None
        claimed = await db.execute(
            update(FinanceSession)
            .where(FinanceSession.id == sid, FinanceSession.status == "queued")
            .values(status="running", stage_note="Iniciando", last_error=None)
        )
        await db.commit()
        return sid if claimed.rowcount else None


async def _set_stage(session_id: str, note: str) -> None:
    async with session_scope() as db:
        await db.execute(
            update(FinanceSession).where(FinanceSession.id == session_id).values(stage_note=note)
        )
        await db.commit()


async def _clear_previous(db, session_id: str) -> None:
    await db.execute(delete(FinanceEntry).where(FinanceEntry.session_id == session_id))
    await db.execute(delete(FinanceCollaborator).where(FinanceCollaborator.session_id == session_id))


async def run_session(session_id: str) -> None:
    async with session_scope() as db:
        session = await db.get(FinanceSession, session_id)
        if not session:
            return
        files = (await db.execute(
            select(FinanceFile).where(FinanceFile.session_id == session_id)
            .order_by(FinanceFile.created_at)
        )).scalars().all()
        if not files:
            raise RuntimeError("La sesión no tiene archivos para cruzar")
        period = session.period
        file_meta = [(f.id, f.label, f.kind, f.original_filename, f.stored_path) for f in files]

    inputs: list[FileInput] = []
    for idx, (fid, label, kind, filename, path) in enumerate(file_meta, start=1):
        await _set_stage(session_id, f"Leyendo {label} ({idx}/{len(file_meta)})")
        parsed = await asyncio.to_thread(parse_workbook, path)
        inputs.append(FileInput(id=fid, label=label, kind=kind, filename=filename, parsed=parsed))

    await _set_stage(session_id, "Cruzando colaboradores por Funcod")
    entries, collaborators, summary = await asyncio.to_thread(build_analysis, inputs, period)

    await _set_stage(session_id, f"Guardando {len(entries):,} líneas".replace(",", "."))
    async with session_scope() as db:
        await _clear_previous(db, session_id)
        for i in range(0, len(entries), INSERT_CHUNK):
            chunk = [dict(e, session_id=session_id) for e in entries[i:i + INSERT_CHUNK]]
            await db.execute(insert(FinanceEntry), chunk)
        for i in range(0, len(collaborators), INSERT_CHUNK):
            chunk = [dict(c, session_id=session_id) for c in collaborators[i:i + INSERT_CHUNK]]
            await db.execute(insert(FinanceCollaborator), chunk)
        # Metadatos por archivo (asiento, fecha, totales) con lo recién leído
        for inp in inputs:
            p = inp.parsed
            await db.execute(
                update(FinanceFile).where(FinanceFile.id == inp.id).values(
                    row_count=len(p.rows), entry_number=p.entry_number, entry_date=p.entry_date,
                    total_debit=p.total_debit, total_credit=p.total_credit,
                    collaborator_count=p.collaborator_count,
                    validation={"warnings": p.warnings, "dirty_funcods": len(p.dirty_funcods),
                                "skipped_rows": p.skipped_rows, "sheet": p.sheet},
                )
            )
        await db.execute(
            update(FinanceSession).where(FinanceSession.id == session_id).values(
                status="done", summary=summary, stage_note=None, last_error=None,
                executed_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()
    logger.info(
        "VEXFINANZAS sesión %s: %d líneas, %d colaboradores, %d centros",
        session_id, len(entries), len(collaborators), summary["totals"]["cost_centers"],
    )


async def _process(session_id: str) -> None:
    try:
        await asyncio.wait_for(run_session(session_id), timeout=RUN_TIMEOUT)
    except asyncio.TimeoutError:
        await _fail(session_id, f"La ejecución superó el tope de {RUN_TIMEOUT // 60} minutos")
    except Exception as exc:  # noqa: BLE001
        logger.exception("VEXFINANZAS sesión %s falló", session_id)
        await _fail(session_id, str(exc)[:2000])


async def _fail(session_id: str, error: str) -> None:
    async with session_scope() as db:
        await db.execute(
            update(FinanceSession).where(FinanceSession.id == session_id)
            .values(status="failed", last_error=error, stage_note=None)
        )
        await db.commit()


async def finance_worker() -> None:
    logger.info("finance_worker iniciado")
    while True:
        try:
            sid = await _claim_next()
            if sid:
                await _process(sid)
                continue
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("finance_worker: error inesperado")
        try:
            await asyncio.wait_for(_signal.wait(), timeout=15)
        except asyncio.TimeoutError:
            pass
        _signal.clear()
