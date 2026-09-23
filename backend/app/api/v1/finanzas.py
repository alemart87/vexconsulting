"""VEXFINANZAS — Análisis de centros de costos.

Acceso: superadmin y gerentes de operaciones (require_finanzas). Cada gerente
ve y administra SOLO sus sesiones; el superadmin ve todas.
"""
from __future__ import annotations

import hashlib
import shutil
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.database import get_db
from ...jobs.finance_worker import signal_finance_queue
from ...models.finance import (
    FinanceCollaborator,
    FinanceEntry,
    FinanceFile,
    FinanceNote,
    FinanceSession,
)
from ...services.audit_service import log_action
from ...services.finance_export import (
    IPS_EMPLOYER_RATE,
    build_ips_workbook,
    build_workbook,
    safe_filename,
)
from ...services.finance_service import (
    CONCEPT_LABELS,
    DEDUCTION_CONCEPTS,
    FinanceFileError,
    classify_file,
    parse_workbook,
    period_from_date,
    period_from_filename,
    period_label,
)
from ..deps import CurrentUser, client_ip, require_finanzas

router = APIRouter(prefix="/finanzas", tags=["finanzas"])

_XLSX_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream",
}
MAX_FILES_PER_SESSION = 30


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SessionCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    period: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}$")
    description: Optional[str] = Field(default=None, max_length=2000)


class SessionUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    period: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}$")
    description: Optional[str] = Field(default=None, max_length=2000)


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    body_md: Optional[str] = Field(default=None, max_length=20000)
    ref_type: Optional[str] = Field(default=None, pattern=r"^(cuenta|centro|colaborador|general)$")
    ref_id: Optional[str] = Field(default=None, max_length=40)
    ref_label: Optional[str] = Field(default=None, max_length=255)


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    body_md: Optional[str] = Field(default=None, max_length=20000)
    ref_type: Optional[str] = Field(default=None, pattern=r"^(cuenta|centro|colaborador|general)$")
    ref_id: Optional[str] = Field(default=None, max_length=40)
    ref_label: Optional[str] = Field(default=None, max_length=255)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_session(session_id: str, user: CurrentUser, db: AsyncSession) -> FinanceSession:
    session = await db.get(FinanceSession, session_id)
    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sesión no encontrada")
    if not user.is_superadmin and session.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Esta sesión pertenece a otro gerente")
    return session


def _session_out(s: FinanceSession, file_count: int = 0, note_count: int = 0) -> dict:
    totals = (s.summary or {}).get("totals") if s.summary else None
    return {
        "id": s.id,
        "name": s.name,
        "period": s.period,
        "period_label": period_label(s.period),
        "description": s.description,
        "status": s.status,
        "stage_note": s.stage_note,
        "last_error": s.last_error,
        "owner_id": s.owner_id,
        "owner_name": s.owner_name,
        "file_count": file_count,
        "note_count": note_count,
        "totals": totals,
        "warnings_count": len((s.summary or {}).get("warnings", [])) if s.summary else 0,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
        "executed_at": s.executed_at,
    }


def _file_out(f: FinanceFile) -> dict:
    return {
        "id": f.id,
        "session_id": f.session_id,
        "original_filename": f.original_filename,
        "kind": f.kind,
        "label": f.label,
        "size_bytes": f.size_bytes,
        "row_count": f.row_count,
        "entry_number": f.entry_number,
        "entry_date": f.entry_date,
        "total_debit": f.total_debit,
        "total_credit": f.total_credit,
        "balance_diff": (f.total_debit or 0) - (f.total_credit or 0),
        "collaborator_count": f.collaborator_count,
        "validation": f.validation,
        "uploaded_by_name": f.uploaded_by_name,
        "created_at": f.created_at,
    }


def _collab_out(c: FinanceCollaborator) -> dict:
    return {
        "funcod": c.funcod,
        "name": c.name,
        "category": c.category,
        "is_egreso": c.is_egreso,
        "position": c.position,
        "cc_main_code": c.cc_main_code,
        "cc_main_desc": c.cc_main_desc,
        "cc_count": c.cc_count,
        "cc_codes": c.cc_codes or [],
        "file_labels": c.file_labels or [],
        "entry_count": c.entry_count,
        "total_cost": c.total_cost,
        "total_liabilities": c.total_liabilities,
        "total_deductions": c.total_deductions,
        "net_pay": c.net_pay,
        "breakdown": c.breakdown or {},
        "funcod_dirty": c.funcod_dirty,
    }


def _entry_out(e: FinanceEntry, file_labels: dict[str, str]) -> dict:
    return {
        "id": e.id,
        "file_id": e.file_id,
        "file_label": file_labels.get(e.file_id, "?"),
        "row_index": e.row_index,
        "entry_number": e.entry_number,
        "entry_date": e.entry_date,
        "account_code": e.account_code,
        "account_desc": e.account_desc,
        "account_type": e.account_type,
        "concept": e.concept,
        "concept_label": CONCEPT_LABELS.get(e.concept, e.concept),
        "area": e.area,
        "position": e.position,
        "cc_code": e.cc_code,
        "cc_desc": e.cc_desc,
        "debit": e.debit,
        "credit": e.credit,
        "orden": e.orden,
        "funcod": e.funcod,
        "employee_name": e.employee_name,
    }


def _note_out(n: FinanceNote) -> dict:
    return {
        "id": n.id,
        "session_id": n.session_id,
        "title": n.title,
        "body_md": n.body_md,
        "ref_type": n.ref_type,
        "ref_id": n.ref_id,
        "ref_label": n.ref_label,
        "created_by": n.created_by,
        "created_by_name": n.created_by_name,
        "updated_by_name": n.updated_by_name,
        "created_at": n.created_at,
        "updated_at": n.updated_at,
    }


def _require_done(session: FinanceSession) -> dict:
    if session.status != "done" or not session.summary:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "La sesión todavía no fue ejecutada: subí los archivos y presioná «Ejecutar VeXFinanzas»",
        )
    return session.summary


async def _file_labels(db: AsyncSession, session_id: str) -> dict[str, str]:
    rows = (await db.execute(
        select(FinanceFile.id, FinanceFile.label).where(FinanceFile.session_id == session_id)
    )).all()
    return {r[0]: r[1] for r in rows}


def _session_dir(session_id: str):
    return settings.upload_path / "finanzas" / session_id


# ---------------------------------------------------------------------------
# Sesiones
# ---------------------------------------------------------------------------

@router.get("/sessions")
async def list_sessions(
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    q = select(FinanceSession).order_by(FinanceSession.updated_at.desc())
    if not user.is_superadmin:
        q = q.where(FinanceSession.owner_id == user.id)
    sessions = (await db.execute(q)).scalars().all()
    if not sessions:
        return []
    ids = [s.id for s in sessions]
    fc = dict((await db.execute(
        select(FinanceFile.session_id, func.count(FinanceFile.id))
        .where(FinanceFile.session_id.in_(ids)).group_by(FinanceFile.session_id)
    )).all())
    nc = dict((await db.execute(
        select(FinanceNote.session_id, func.count(FinanceNote.id))
        .where(FinanceNote.session_id.in_(ids)).group_by(FinanceNote.session_id)
    )).all())
    return [_session_out(s, fc.get(s.id, 0), nc.get(s.id, 0)) for s in sessions]


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def create_session(
    payload: SessionCreate,
    request: Request,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = FinanceSession(
        name=payload.name.strip(),
        period=payload.period,
        description=(payload.description or "").strip() or None,
        owner_id=user.id,
        owner_name=user.full_name,
        status="draft",
    )
    db.add(session)
    await db.flush()
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action="finanzas.session.create", entity_type="finance_session", entity_id=session.id,
        detail={"name": session.name, "period": session.period}, ip=client_ip(request),
    )
    await db.refresh(session)
    return _session_out(session)


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = await _get_session(session_id, user, db)
    files = (await db.execute(
        select(FinanceFile).where(FinanceFile.session_id == session_id).order_by(FinanceFile.created_at)
    )).scalars().all()
    notes = (await db.execute(
        select(func.count(FinanceNote.id)).where(FinanceNote.session_id == session_id)
    )).scalar_one()
    out = _session_out(session, len(files), int(notes or 0))
    out["files"] = [_file_out(f) for f in files]
    return out


@router.patch("/sessions/{session_id}")
async def update_session(
    session_id: str,
    payload: SessionUpdate,
    request: Request,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = await _get_session(session_id, user, db)
    changes: dict = {}
    if payload.name is not None:
        session.name = payload.name.strip()
        changes["name"] = session.name
    if payload.period is not None:
        session.period = payload.period
        changes["period"] = payload.period
        if session.summary:
            session.summary = dict(session.summary, period=payload.period,
                                   period_label=period_label(payload.period))
    if payload.description is not None:
        session.description = payload.description.strip() or None
        changes["description"] = session.description
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action="finanzas.session.update", entity_type="finance_session", entity_id=session.id,
        detail=changes, ip=client_ip(request),
    )
    await db.refresh(session)
    return _session_out(session)


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    request: Request,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = await _get_session(session_id, user, db)
    if session.status in ("queued", "running"):
        raise HTTPException(status.HTTP_409_CONFLICT, "La sesión se está ejecutando: esperá a que termine")
    for model in (FinanceEntry, FinanceCollaborator, FinanceNote, FinanceFile):
        await db.execute(delete(model).where(model.session_id == session_id))
    await db.delete(session)
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action="finanzas.session.delete", entity_type="finance_session", entity_id=session_id,
        detail={"name": session.name}, ip=client_ip(request),
    )
    shutil.rmtree(_session_dir(session_id), ignore_errors=True)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Archivos
# ---------------------------------------------------------------------------

@router.post("/sessions/{session_id}/files", status_code=status.HTTP_201_CREATED)
async def upload_file(
    session_id: str,
    file: UploadFile,
    request: Request,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = await _get_session(session_id, user, db)
    if session.status in ("queued", "running"):
        raise HTTPException(status.HTTP_409_CONFLICT, "La sesión se está ejecutando")
    filename = (file.filename or "archivo.xlsx").replace("/", "_").replace("\\", "_")
    if not filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo se aceptan archivos Excel (.xlsx)")
    data = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"El archivo supera el máximo de {settings.max_upload_size_mb} MB",
        )
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Archivo vacío")

    count = (await db.execute(
        select(func.count(FinanceFile.id)).where(FinanceFile.session_id == session_id)
    )).scalar_one()
    if int(count or 0) >= MAX_FILES_PER_SESSION:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Máximo {MAX_FILES_PER_SESSION} archivos por sesión")

    sha = hashlib.sha256(data).hexdigest()
    dup = (await db.execute(
        select(FinanceFile).where(FinanceFile.session_id == session_id, FinanceFile.sha256 == sha)
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Este archivo ya está en la sesión como «{dup.label}»")

    file_id = str(uuid.uuid4())
    folder = _session_dir(session_id) / file_id
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / filename
    target.write_bytes(data)

    # Validación de esquema en el momento: si no es un export de asientos, se rechaza
    try:
        parsed = parse_workbook(target)
    except FinanceFileError as exc:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    kind, label = classify_file(filename)
    # Etiquetas únicas: «Complemento», «Complemento (2)»…
    existing = {r[0] for r in (await db.execute(
        select(FinanceFile.label).where(FinanceFile.session_id == session_id)
    )).all()}
    base_label, n = label, 2
    while label in existing:
        label = f"{base_label} ({n})"
        n += 1

    record = FinanceFile(
        id=file_id,
        session_id=session_id,
        original_filename=filename,
        kind=kind,
        label=label,
        sha256=sha,
        stored_path=str(target),
        size_bytes=len(data),
        row_count=len(parsed.rows),
        entry_number=parsed.entry_number,
        entry_date=parsed.entry_date,
        total_debit=parsed.total_debit,
        total_credit=parsed.total_credit,
        collaborator_count=parsed.collaborator_count,
        validation={"warnings": parsed.warnings, "dirty_funcods": len(parsed.dirty_funcods),
                    "skipped_rows": parsed.skipped_rows, "sheet": parsed.sheet},
        uploaded_by=user.id,
        uploaded_by_name=user.full_name,
    )
    db.add(record)
    # Período sugerido: del nombre del archivo o de la fecha del asiento
    if not session.period:
        session.period = period_from_filename(filename) or period_from_date(parsed.entry_date)
    # Un archivo nuevo invalida el resultado anterior
    if session.status == "done":
        session.status = "draft"
        session.stage_note = "Hay archivos nuevos: volvé a ejecutar para actualizar el análisis"
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action="finanzas.file.upload", entity_type="finance_session", entity_id=session_id,
        detail={"filename": filename, "label": label, "rows": len(parsed.rows)}, ip=client_ip(request),
    )
    await db.refresh(record)
    return _file_out(record)


@router.delete("/sessions/{session_id}/files/{file_id}")
async def delete_file(
    session_id: str,
    file_id: str,
    request: Request,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = await _get_session(session_id, user, db)
    if session.status in ("queued", "running"):
        raise HTTPException(status.HTTP_409_CONFLICT, "La sesión se está ejecutando")
    record = await db.get(FinanceFile, file_id)
    if not record or record.session_id != session_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Archivo no encontrado")
    await db.execute(delete(FinanceEntry).where(FinanceEntry.file_id == file_id))
    await db.delete(record)
    if session.status == "done":
        session.status = "draft"
        session.stage_note = "Se quitó un archivo: volvé a ejecutar para actualizar el análisis"
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action="finanzas.file.delete", entity_type="finance_session", entity_id=session_id,
        detail={"filename": record.original_filename}, ip=client_ip(request),
    )
    shutil.rmtree(_session_dir(session_id) / file_id, ignore_errors=True)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Ejecución
# ---------------------------------------------------------------------------

@router.post("/sessions/{session_id}/run")
async def run_session(
    session_id: str,
    request: Request,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = await _get_session(session_id, user, db)
    if session.status in ("queued", "running"):
        raise HTTPException(status.HTTP_409_CONFLICT, "La sesión ya se está ejecutando")
    count = (await db.execute(
        select(func.count(FinanceFile.id)).where(FinanceFile.session_id == session_id)
    )).scalar_one()
    if not count:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Subí al menos un archivo antes de ejecutar")
    session.status = "queued"
    session.stage_note = "En cola"
    session.last_error = None
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action="finanzas.session.run", entity_type="finance_session", entity_id=session_id,
        detail={"files": int(count)}, ip=client_ip(request),
    )
    signal_finance_queue()
    await db.refresh(session)
    return _session_out(session, int(count))


@router.get("/sessions/{session_id}/summary")
async def get_summary(
    session_id: str,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = await _get_session(session_id, user, db)
    summary = _require_done(session)
    return {"session": _session_out(session), "summary": summary}


# ---------------------------------------------------------------------------
# Cuentas
# ---------------------------------------------------------------------------

@router.get("/sessions/{session_id}/accounts")
async def list_accounts(
    session_id: str,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    session = await _get_session(session_id, user, db)
    return _require_done(session).get("accounts", [])


@router.get("/sessions/{session_id}/accounts/{account_code}")
async def account_detail(
    session_id: str,
    account_code: int,
    cc: Optional[int] = Query(default=None),
    q: Optional[str] = Query(default=None, max_length=120),
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Todos los movimientos de una cuenta, ordenados por centro de costo y
    colaborador, con subtotales por centro."""
    session = await _get_session(session_id, user, db)
    summary = _require_done(session)
    account = next((a for a in summary.get("accounts", []) if a["code"] == account_code), None)
    if not account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cuenta no encontrada en esta sesión")

    query = select(FinanceEntry).where(
        FinanceEntry.session_id == session_id, FinanceEntry.account_code == account_code
    )
    if cc is not None:
        query = query.where(FinanceEntry.cc_code == cc)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(FinanceEntry.employee_name.ilike(like), FinanceEntry.funcod.like(like)))
    query = query.order_by(FinanceEntry.cc_code, FinanceEntry.employee_name, FinanceEntry.file_id)
    entries = (await db.execute(query)).scalars().all()
    labels = await _file_labels(db, session_id)

    groups: dict[int, dict] = {}
    for e in entries:
        g = groups.get(e.cc_code)
        if g is None:
            g = groups[e.cc_code] = {
                "cc_code": e.cc_code, "cc_desc": e.cc_desc, "debit": 0, "credit": 0,
                "people": set(), "rows": [],
            }
        g["debit"] += e.debit
        g["credit"] += e.credit
        g["people"].add(e.funcod)
        g["rows"].append(_entry_out(e, labels))
    out_groups = []
    for g in groups.values():
        out_groups.append({
            "cc_code": g["cc_code"], "cc_desc": g["cc_desc"], "debit": g["debit"],
            "credit": g["credit"], "net": (g["debit"] - g["credit"]) if account["type"] == "gasto"
            else (g["credit"] - g["debit"]), "people": len(g["people"]), "rows": g["rows"],
        })
    out_groups.sort(key=lambda x: -abs(x["net"]))
    return {
        "account": account,
        "filters": {"cc": cc, "q": q},
        "totals": {
            "rows": len(entries),
            "people": len({e.funcod for e in entries}),
            "cost_centers": len(groups),
            "debit": sum(e.debit for e in entries),
            "credit": sum(e.credit for e in entries),
        },
        "groups": out_groups,
    }


# ---------------------------------------------------------------------------
# Centros de costo
# ---------------------------------------------------------------------------

@router.get("/sessions/{session_id}/cost-centers")
async def list_cost_centers(
    session_id: str,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    session = await _get_session(session_id, user, db)
    return _require_done(session).get("cost_centers", [])


@router.get("/sessions/{session_id}/cost-centers/{cc_code}")
async def cost_center_detail(
    session_id: str,
    cc_code: int,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = await _get_session(session_id, user, db)
    summary = _require_done(session)
    center = next((c for c in summary.get("cost_centers", []) if c["code"] == cc_code), None)
    if not center:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Centro de costo no encontrado en esta sesión")

    entries = (await db.execute(
        select(FinanceEntry).where(FinanceEntry.session_id == session_id, FinanceEntry.cc_code == cc_code)
    )).scalars().all()
    funcods = {e.funcod for e in entries}
    collabs = (await db.execute(
        select(FinanceCollaborator).where(
            FinanceCollaborator.session_id == session_id, FinanceCollaborator.funcod.in_(funcods)
        )
    )).scalars().all() if funcods else []

    # Costo del colaborador DENTRO de este centro (prorrateo por línea)
    per_person: dict[str, dict] = {}
    accounts: dict[int, dict] = {}
    for e in entries:
        p = per_person.setdefault(e.funcod, {"cost": 0, "net_pay": 0, "rows": 0, "breakdown": {}})
        p["rows"] += 1
        if e.account_type == "gasto":
            amt = e.debit - e.credit
            p["cost"] += amt
            p["breakdown"][e.concept] = p["breakdown"].get(e.concept, 0) + amt
        elif e.concept == "neto_a_pagar":
            p["net_pay"] += e.credit - e.debit
        a = accounts.setdefault(e.account_code, {
            "code": e.account_code, "desc": e.account_desc, "type": e.account_type,
            "concept": e.concept, "concept_label": CONCEPT_LABELS.get(e.concept, e.concept),
            "rows": 0, "people": set(), "debit": 0, "credit": 0,
        })
        a["rows"] += 1
        a["people"].add(e.funcod)
        a["debit"] += e.debit
        a["credit"] += e.credit

    people = []
    for c in collabs:
        p = per_person.get(c.funcod, {})
        row = _collab_out(c)
        row["cost_in_cc"] = p.get("cost", 0)
        row["net_pay_in_cc"] = p.get("net_pay", 0)
        row["rows_in_cc"] = p.get("rows", 0)
        row["breakdown_in_cc"] = p.get("breakdown", {})
        people.append(row)
    people.sort(key=lambda x: -x["cost_in_cc"])
    acc_out = []
    for a in sorted(accounts.values(), key=lambda x: x["code"]):
        acc_out.append({**a, "people": len(a["people"]),
                        "net": (a["debit"] - a["credit"]) if a["type"] == "gasto" else (a["credit"] - a["debit"])})
    return {"center": center, "people": people, "accounts": acc_out}


# ---------------------------------------------------------------------------
# Exportación a Excel
# ---------------------------------------------------------------------------

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _with_labels(entries, labels: dict[str, str]):
    for e in entries:
        e.file_label = labels.get(e.file_id, "?")  # atributo transitorio para la hoja
        yield e


async def _export_response(request, user, session, *, kind: str, entity_id: str, title: str,
                           summary_rows, accounts, collaborators, entries, filename: str, db,
                           extra_cols=None) -> Response:
    data = build_workbook(
        title=title, session_name=session.name, period_label=period_label(session.period),
        summary_rows=summary_rows, accounts=accounts, collaborators=collaborators, entries=entries,
        extra_cols=extra_cols,
    )
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action=f"finanzas.export.{kind}", entity_type="finance_session", entity_id=session.id,
        detail={"target": entity_id, "bytes": len(data), "filename": filename}, ip=client_ip(request),
    )
    return Response(
        content=data, media_type=_XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/sessions/{session_id}/cost-centers/{cc_code}/export")
async def export_cost_center(
    session_id: str,
    cc_code: int,
    request: Request,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Excel del centro: resumen y cuentas, colaboradores (con su gasto en el
    centro) y todos los movimientos."""
    session = await _get_session(session_id, user, db)
    detail = await cost_center_detail(session_id, cc_code, user, db)
    center = detail["center"]
    labels = await _file_labels(db, session_id)
    entries = (await db.execute(
        select(FinanceEntry).where(FinanceEntry.session_id == session_id, FinanceEntry.cc_code == cc_code)
        .order_by(FinanceEntry.employee_name, FinanceEntry.file_id, FinanceEntry.orden, FinanceEntry.account_code)
    )).scalars().all()
    summary_rows = [
        ("Centro de costo", f"{center['code']} · {center['desc']}"),
        ("Cliente / negocio", center["client"]),
        ("Personas", center["people"]),
        ("Mensualeros", center["mensualeros"]),
        ("Jornaleros", center["jornaleros"]),
        ("Egresos", center["egresos"]),
        ("Gasto del mes (Gs.)", center["cost"]),
        ("Participación en el gasto total", round(center["share"], 4)),
        ("Costo promedio por persona (Gs.)", center["avg_cost"]),
        ("Neto a pagar (Gs.)", center.get("net_pay", 0)),
        ("Anticipos y descuentos (Gs.)", center.get("deductions_total", 0)),
        ("Líneas de asiento", center["rows"]),
    ]
    filename = safe_filename(session.period or session.name, str(cc_code), center["desc"])
    return await _export_response(
        request, user, session, kind="cost_center", entity_id=str(cc_code),
        title=f"Centro de costo {center['code']} · {center['desc']}",
        summary_rows=summary_rows, accounts=detail["accounts"], collaborators=detail["people"],
        entries=_with_labels(entries, labels), filename=filename, db=db,
        extra_cols=[("Gasto en este centro", "cost_in_cc"), ("Neto en este centro", "net_pay_in_cc")],
    )


@router.get("/sessions/{session_id}/export")
async def export_session(
    session_id: str,
    request: Request,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Excel de la sesión completa: resumen gerencial, todos los colaboradores
    y todos los movimientos."""
    session = await _get_session(session_id, user, db)
    summary = _require_done(session)
    labels = await _file_labels(db, session_id)
    collabs = (await db.execute(
        select(FinanceCollaborator).where(FinanceCollaborator.session_id == session_id)
        .order_by(FinanceCollaborator.total_cost.desc())
    )).scalars().all()
    entries = (await db.execute(
        select(FinanceEntry).where(FinanceEntry.session_id == session_id)
        .order_by(FinanceEntry.cc_code, FinanceEntry.employee_name, FinanceEntry.file_id, FinanceEntry.orden)
    )).scalars().all()
    t = summary["totals"]
    summary_rows = [
        ("Archivos", t["files"]), ("Líneas de asiento", t["rows"]), ("Colaboradores únicos", t["collaborators"]),
        ("En más de un centro", t["multi_cc_people"]), ("Centros de costo", t["cost_centers"]),
        ("Cuentas", t["accounts"]), ("Gasto total (Gs.)", t["cost"]), ("Neto a pagar (Gs.)", t["net_pay"]),
        ("IPS a pagar (Gs.)", t["ips"]), ("Anticipos y descuentos (Gs.)", t["deductions"]),
        ("Costo promedio por persona (Gs.)", t["avg_cost_per_person"]),
    ]
    for key, c in summary.get("categories", {}).items():
        summary_rows.append((f"{c['label']}: personas / gasto", f"{c['people']} / {c['cost']}"))
    filename = safe_filename(session.period or "sesion", session.name)
    return await _export_response(
        request, user, session, kind="session", entity_id=session_id,
        title=f"Sesión {session.name}", summary_rows=summary_rows, accounts=summary.get("accounts", []),
        collaborators=[_collab_out(c) for c in collabs], entries=_with_labels(entries, labels),
        filename=filename, db=db,
    )


def _accounts_from_entries(entries) -> list[dict]:
    acc: dict[int, dict] = {}
    for e in entries:
        a = acc.setdefault(e.account_code, {
            "code": e.account_code, "desc": e.account_desc, "type": e.account_type, "concept": e.concept,
            "concept_label": CONCEPT_LABELS.get(e.concept, e.concept), "rows": 0, "people": set(),
            "debit": 0, "credit": 0,
        })
        a["rows"] += 1
        a["people"].add(e.funcod)
        a["debit"] += e.debit
        a["credit"] += e.credit
    out = []
    for a in sorted(acc.values(), key=lambda x: x["code"]):
        out.append({**a, "people": len(a["people"]),
                    "net": (a["debit"] - a["credit"]) if a["type"] == "gasto" else (a["credit"] - a["debit"])})
    return out


_SEGMENT_CATEGORIES = {
    "mensualero": "Mensualeros", "jornalero": "Jornaleros (operadores)",
    "sin_clasificar": "Sin clasificar", "egresos": "Egresos del período",
}
_SEGMENT_CONCEPTS = {
    "anticipo": "Anticipos al personal", "descuento_promocional": "Descuentos promocionales",
    "descuento_varios": "Descuentos varios", "embargo": "Embargos judiciales",
    "deducciones": "Anticipos y descuentos (todos)",
}


@router.get("/sessions/{session_id}/export/segment")
async def export_segment(
    session_id: str,
    request: Request,
    kind: str = Query(pattern=r"^(category|concept)$"),
    value: str = Query(max_length=40),
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Excel de un segmento de las tarjetas del resumen gerencial:
    - kind=category: mensualero | jornalero | sin_clasificar | egresos
      (colaboradores de ese tipo y todos sus movimientos)
    - kind=concept: anticipo | descuento_promocional | descuento_varios |
      embargo | deducciones (movimientos de ese concepto y quiénes lo tienen)
    """
    session = await _get_session(session_id, user, db)
    _require_done(session)
    labels = await _file_labels(db, session_id)

    if kind == "category":
        if value not in _SEGMENT_CATEGORIES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Categoría desconocida")
        cq = select(FinanceCollaborator).where(FinanceCollaborator.session_id == session_id)
        cq = cq.where(FinanceCollaborator.is_egreso.is_(True)) if value == "egresos" else cq.where(FinanceCollaborator.category == value)
        collabs = (await db.execute(cq.order_by(FinanceCollaborator.total_cost.desc()))).scalars().all()
        funcods = [c.funcod for c in collabs]
        entries = (await db.execute(
            select(FinanceEntry).where(FinanceEntry.session_id == session_id, FinanceEntry.funcod.in_(funcods))
            .order_by(FinanceEntry.employee_name, FinanceEntry.cc_code, FinanceEntry.file_id, FinanceEntry.orden)
        )).scalars().all() if funcods else []
        title = _SEGMENT_CATEGORIES[value]
        cost = sum(c.total_cost for c in collabs)
        summary_rows = [
            ("Segmento", title), ("Colaboradores", len(collabs)), ("Gasto total (Gs.)", cost),
            ("Costo promedio (Gs.)", int(cost / len(collabs)) if collabs else 0),
            ("Neto a pagar (Gs.)", sum(c.net_pay for c in collabs)), ("Líneas de asiento", len(entries)),
        ]
        collaborators = [_collab_out(c) for c in collabs]
        extra_cols = None
    else:
        if value not in _SEGMENT_CONCEPTS:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Concepto desconocido")
        concepts = list(DEDUCTION_CONCEPTS) if value == "deducciones" else [value]
        entries = (await db.execute(
            select(FinanceEntry).where(FinanceEntry.session_id == session_id, FinanceEntry.concept.in_(concepts))
            .order_by(FinanceEntry.cc_code, FinanceEntry.employee_name, FinanceEntry.file_id)
        )).scalars().all()
        per_person: dict[str, int] = {}
        for e in entries:
            per_person[e.funcod] = per_person.get(e.funcod, 0) + (e.credit - e.debit)
        collabs = (await db.execute(
            select(FinanceCollaborator).where(
                FinanceCollaborator.session_id == session_id, FinanceCollaborator.funcod.in_(list(per_person))
            )
        )).scalars().all() if per_person else []
        collaborators = sorted(
            [dict(_collab_out(c), concept_amount=per_person.get(c.funcod, 0)) for c in collabs],
            key=lambda x: -x["concept_amount"],
        )
        title = _SEGMENT_CONCEPTS[value]
        total = sum(per_person.values())
        summary_rows = [
            ("Concepto", title), ("Colaboradores con el concepto", len(per_person)), ("Monto total (Gs.)", total),
            ("Promedio por colaborador (Gs.)", int(total / len(per_person)) if per_person else 0),
            ("Máximo individual (Gs.)", max(per_person.values(), default=0)), ("Líneas de asiento", len(entries)),
        ]
        extra_cols = [(f"Monto · {title}", "concept_amount")]

    filename = safe_filename(session.period or session.name, kind, value)
    return await _export_response(
        request, user, session, kind=f"segment.{kind}", entity_id=value, title=title,
        summary_rows=summary_rows, accounts=_accounts_from_entries(entries), collaborators=collaborators,
        entries=_with_labels(entries, labels), filename=filename, db=db, extra_cols=extra_cols,
    )


@router.get("/sessions/{session_id}/export/ips")
async def export_ips(
    session_id: str,
    request: Request,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Planilla IPS del mes: por colaborador y por centro, con la apertura en
    aporte patronal (carga social 16,5 %) y aporte obrero (9 %)."""
    session = await _get_session(session_id, user, db)
    summary = _require_done(session)
    labels = await _file_labels(db, session_id)
    entries = (await db.execute(
        select(FinanceEntry).where(
            FinanceEntry.session_id == session_id,
            FinanceEntry.concept.in_(["ips_a_pagar", "carga_social"]),
        ).order_by(FinanceEntry.cc_code, FinanceEntry.employee_name, FinanceEntry.file_id, FinanceEntry.orden)
    )).scalars().all()

    per_person: dict[str, dict] = {}
    per_cc: dict[int, dict] = {}
    for e in entries:
        p = per_person.setdefault(e.funcod, {"total": 0, "employer": 0})
        c = per_cc.setdefault(e.cc_code, {"code": e.cc_code, "desc": e.cc_desc, "total": 0, "employer": 0, "people": set()})
        c["people"].add(e.funcod)
        if e.concept == "ips_a_pagar":
            amt = e.credit - e.debit
            p["total"] += amt
            c["total"] += amt
        else:
            amt = e.debit - e.credit
            p["employer"] += amt
            c["employer"] += amt

    collabs = (await db.execute(
        select(FinanceCollaborator).where(
            FinanceCollaborator.session_id == session_id, FinanceCollaborator.funcod.in_(list(per_person))
        )
    )).scalars().all() if per_person else []
    people = []
    for col in collabs:
        p = per_person[col.funcod]
        employee = p["total"] - p["employer"]
        base = int(round(p["employer"] / IPS_EMPLOYER_RATE)) if p["employer"] else 0
        people.append({
            "funcod": col.funcod, "name": col.name, "category": col.category, "position": col.position,
            "cc_main_desc": col.cc_main_desc, "cc_count": col.cc_count, "base": base,
            "employer": p["employer"], "employee": employee, "total": p["total"],
            "check": employee - int(round(base * 0.09)),
        })
    people.sort(key=lambda x: -x["total"])

    cc_desc = {cc["code"]: cc for cc in summary.get("cost_centers", [])}
    centers = []
    for c in per_cc.values():
        info = cc_desc.get(c["code"], {})
        employee = c["total"] - c["employer"]
        centers.append({
            "code": c["code"], "desc": info.get("desc", c["desc"]), "client": info.get("client", ""),
            "people": len(c["people"]), "base": int(round(c["employer"] / IPS_EMPLOYER_RATE)) if c["employer"] else 0,
            "employer": c["employer"], "employee": employee, "total": c["total"],
        })
    centers.sort(key=lambda x: -x["total"])

    total = sum(p["total"] for p in people)
    employer = sum(p["employer"] for p in people)
    totals = {"people": len(people), "total": total, "employer": employer, "employee": total - employer,
              "base": sum(p["base"] for p in people)}
    data = build_ips_workbook(
        session_name=session.name, period_label=period_label(session.period), totals=totals,
        people=people, centers=centers, entries=_with_labels(entries, labels),
    )
    filename = safe_filename(session.period or session.name, "Planilla-IPS")
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action="finanzas.export.ips", entity_type="finance_session", entity_id=session.id,
        detail={"bytes": len(data), "filename": filename, "people": len(people)}, ip=client_ip(request),
    )
    return Response(
        content=data, media_type=_XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Colaboradores
# ---------------------------------------------------------------------------

@router.get("/sessions/{session_id}/collaborators")
async def list_collaborators(
    session_id: str,
    q: Optional[str] = Query(default=None, max_length=120),
    cc: Optional[int] = Query(default=None),
    account: Optional[int] = Query(default=None),
    category: Optional[str] = Query(default=None, pattern=r"^(mensualero|jornalero|sin_clasificar)$"),
    egreso: Optional[bool] = Query(default=None),
    multi_cc: Optional[bool] = Query(default=None, description="Solo los imputados a más de un centro"),
    position: Optional[str] = Query(default=None, max_length=80),
    sort: str = Query(default="cost", pattern=r"^(cost|name|net_pay|funcod|cc)$"),
    order: str = Query(default="desc", pattern=r"^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=500),
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = await _get_session(session_id, user, db)
    _require_done(session)

    query = select(FinanceCollaborator).where(FinanceCollaborator.session_id == session_id)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(FinanceCollaborator.name.ilike(like), FinanceCollaborator.funcod.like(like)))
    if category:
        query = query.where(FinanceCollaborator.category == category)
    if egreso is not None:
        query = query.where(FinanceCollaborator.is_egreso == egreso)
    if multi_cc is not None:
        query = query.where(FinanceCollaborator.cc_count > 1 if multi_cc else FinanceCollaborator.cc_count <= 1)
    if position:
        query = query.where(FinanceCollaborator.position == position)
    if cc is not None or account is not None:
        sub = select(FinanceEntry.funcod).where(FinanceEntry.session_id == session_id)
        if cc is not None:
            sub = sub.where(FinanceEntry.cc_code == cc)
        if account is not None:
            sub = sub.where(FinanceEntry.account_code == account)
        query = query.where(FinanceCollaborator.funcod.in_(sub.distinct()))

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    sort_col = {
        "cost": FinanceCollaborator.total_cost, "name": FinanceCollaborator.name,
        "net_pay": FinanceCollaborator.net_pay, "funcod": FinanceCollaborator.funcod,
        "cc": FinanceCollaborator.cc_main_desc,
    }[sort]
    query = query.order_by(sort_col.desc() if order == "desc" else sort_col.asc(), FinanceCollaborator.name)
    rows = (await db.execute(query.offset((page - 1) * size).limit(size))).scalars().all()
    filtered = query.order_by(None).subquery()
    agg = (await db.execute(
        select(func.coalesce(func.sum(filtered.c.total_cost), 0),
               func.coalesce(func.sum(filtered.c.net_pay), 0))
    )).one()
    return {
        "total": int(total or 0),
        "page": page,
        "size": size,
        "sum_cost": int(agg[0] or 0),
        "sum_net_pay": int(agg[1] or 0),
        "items": [_collab_out(c) for c in rows],
    }


@router.get("/sessions/{session_id}/collaborators/{funcod}")
async def collaborator_detail(
    session_id: str,
    funcod: str,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = await _get_session(session_id, user, db)
    _require_done(session)
    collab = (await db.execute(
        select(FinanceCollaborator).where(
            FinanceCollaborator.session_id == session_id, FinanceCollaborator.funcod == funcod
        )
    )).scalar_one_or_none()
    if not collab:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Colaborador no encontrado en esta sesión")
    entries = (await db.execute(
        select(FinanceEntry).where(FinanceEntry.session_id == session_id, FinanceEntry.funcod == funcod)
        .order_by(FinanceEntry.file_id, FinanceEntry.cc_code, FinanceEntry.orden, FinanceEntry.account_code)
    )).scalars().all()
    labels = await _file_labels(db, session_id)

    by_cc: dict[int, dict] = {}
    by_file: dict[str, dict] = {}
    for e in entries:
        c = by_cc.setdefault(e.cc_code, {"cc_code": e.cc_code, "cc_desc": e.cc_desc, "cost": 0, "net_pay": 0, "rows": 0})
        c["rows"] += 1
        f = by_file.setdefault(e.file_id, {"file_id": e.file_id, "file_label": labels.get(e.file_id, "?"),
                                          "entry_number": e.entry_number, "entry_date": e.entry_date,
                                          "cost": 0, "net_pay": 0, "rows": 0})
        f["rows"] += 1
        if e.account_type == "gasto":
            amt = e.debit - e.credit
            c["cost"] += amt
            f["cost"] += amt
        elif e.concept == "neto_a_pagar":
            c["net_pay"] += e.credit - e.debit
            f["net_pay"] += e.credit - e.debit
    breakdown = [
        {"concept": k, "label": CONCEPT_LABELS.get(k, k), "amount": v}
        for k, v in sorted((collab.breakdown or {}).items(), key=lambda kv: -kv[1])
    ]
    return {
        "collaborator": _collab_out(collab),
        "breakdown": breakdown,
        "by_cost_center": sorted(by_cc.values(), key=lambda x: -x["cost"]),
        "by_file": list(by_file.values()),
        "entries": [_entry_out(e, labels) for e in entries],
    }


# ---------------------------------------------------------------------------
# Notas
# ---------------------------------------------------------------------------

@router.get("/sessions/{session_id}/notes")
async def list_notes(
    session_id: str,
    ref_type: Optional[str] = Query(default=None),
    ref_id: Optional[str] = Query(default=None),
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await _get_session(session_id, user, db)
    q = select(FinanceNote).where(FinanceNote.session_id == session_id)
    if ref_type:
        q = q.where(FinanceNote.ref_type == ref_type)
    if ref_id:
        q = q.where(FinanceNote.ref_id == ref_id)
    rows = (await db.execute(q.order_by(FinanceNote.updated_at.desc()))).scalars().all()
    return [_note_out(n) for n in rows]


@router.post("/sessions/{session_id}/notes", status_code=status.HTTP_201_CREATED)
async def create_note(
    session_id: str,
    payload: NoteCreate,
    request: Request,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _get_session(session_id, user, db)
    note = FinanceNote(
        session_id=session_id,
        title=payload.title.strip(),
        body_md=(payload.body_md or "").strip() or None,
        ref_type=payload.ref_type,
        ref_id=payload.ref_id,
        ref_label=payload.ref_label,
        created_by=user.id,
        created_by_name=user.full_name,
    )
    db.add(note)
    await db.flush()
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action="finanzas.note.create", entity_type="finance_note", entity_id=note.id,
        detail={"session_id": session_id, "title": note.title}, ip=client_ip(request),
    )
    await db.refresh(note)
    return _note_out(note)


@router.patch("/sessions/{session_id}/notes/{note_id}")
async def update_note(
    session_id: str,
    note_id: str,
    payload: NoteUpdate,
    request: Request,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _get_session(session_id, user, db)
    note = await db.get(FinanceNote, note_id)
    if not note or note.session_id != session_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nota no encontrada")
    if payload.title is not None:
        note.title = payload.title.strip()
    if payload.body_md is not None:
        note.body_md = payload.body_md.strip() or None
    if payload.ref_type is not None:
        note.ref_type = payload.ref_type
        note.ref_id = payload.ref_id
        note.ref_label = payload.ref_label
    note.updated_by_name = user.full_name
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action="finanzas.note.update", entity_type="finance_note", entity_id=note.id,
        detail={"session_id": session_id}, ip=client_ip(request),
    )
    await db.refresh(note)
    return _note_out(note)


@router.delete("/sessions/{session_id}/notes/{note_id}")
async def delete_note(
    session_id: str,
    note_id: str,
    request: Request,
    user: CurrentUser = Depends(require_finanzas),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _get_session(session_id, user, db)
    note = await db.get(FinanceNote, note_id)
    if not note or note.session_id != session_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nota no encontrada")
    await db.delete(note)
    await log_action(
        db, user_id=user.id, user_email=user.email, user_role=user.role,
        action="finanzas.note.delete", entity_type="finance_note", entity_id=note_id,
        detail={"session_id": session_id, "title": note.title}, ip=client_ip(request),
    )
    return {"ok": True}
