"""VEXFINANZAS — Análisis de centros de costos.

Una *sesión* agrupa los archivos de asientos contables de un período (los
Excel «A cruzar»). Al ejecutar, cada línea de asiento se persiste en
`finance_entries` (con el Funcod normalizado), se unifican los colaboradores
en `finance_collaborators` y el resumen gerencial queda en `summary`.

Módulo independiente de la consultoría: no referencia proyectos.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base

SESSION_STATUSES = ("draft", "queued", "running", "done", "failed")
FILE_KINDS = ("mensualeros", "operaciones", "egresos", "complemento", "otro")
COLLAB_CATEGORIES = ("mensualero", "jornalero", "sin_clasificar")


def _uuid() -> str:
    return str(uuid.uuid4())


class FinanceSession(Base):
    __tablename__ = "finance_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    # Período analizado «YYYY-MM» (lo declara el gerente; no se infiere de las
    # fechas de los asientos porque los complementos pueden caer en otro mes).
    period: Mapped[str | None] = mapped_column(String(7), nullable=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    stage_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Resumen gerencial completo (totales, centros, cuentas, categorías, avisos)
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)
    owner_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class FinanceFile(Base):
    __tablename__ = "finance_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), index=True)
    original_filename: Mapped[str] = mapped_column(String(500))
    # mensualeros | operaciones | egresos | complemento | otro (según el nombre)
    kind: Mapped[str] = mapped_column(String(20), default="otro")
    label: Mapped[str] = mapped_column(String(120))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    stored_path: Mapped[str] = mapped_column(String(600))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    # Metadatos de la validación al subir
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    entry_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    entry_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    total_debit: Mapped[int] = mapped_column(BigInteger, default=0)
    total_credit: Mapped[int] = mapped_column(BigInteger, default=0)
    collaborator_count: Mapped[int] = mapped_column(Integer, default=0)
    validation: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    uploaded_by: Mapped[str] = mapped_column(String(36))
    uploaded_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FinanceEntry(Base):
    """Una línea de asiento. Se guarda completa para que las vistas consulten
    con SQL (cuentas, centros, colaboradores) sin recalcular."""

    __tablename__ = "finance_entries"
    __table_args__ = (
        Index("ix_fin_entries_session_account", "session_id", "account_code"),
        Index("ix_fin_entries_session_funcod", "session_id", "funcod"),
        Index("ix_fin_entries_session_cc", "session_id", "cc_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), index=True)
    file_id: Mapped[str] = mapped_column(String(36), index=True)
    row_index: Mapped[int] = mapped_column(Integer)
    entry_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    entry_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    account_code: Mapped[int] = mapped_column(Integer)
    account_desc: Mapped[str] = mapped_column(String(255))
    # Clasificación derivada de la cuenta (ver finance_service.classify_account)
    account_type: Mapped[str] = mapped_column(String(10))      # gasto | pasivo | activo | otro
    concept: Mapped[str] = mapped_column(String(30))            # remuneracion | variables | ...
    area: Mapped[str] = mapped_column(String(20))               # operaciones | administracion | -
    position: Mapped[str | None] = mapped_column(String(80), nullable=True)
    cc_code: Mapped[int] = mapped_column(Integer)
    cc_desc: Mapped[str] = mapped_column(String(255))
    rubro: Mapped[int | None] = mapped_column(Integer, nullable=True)
    subrubro: Mapped[int | None] = mapped_column(Integer, nullable=True)
    debit: Mapped[int] = mapped_column(BigInteger, default=0)
    credit: Mapped[int] = mapped_column(BigInteger, default=0)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    orden: Mapped[int | None] = mapped_column(Integer, nullable=True)
    funcod: Mapped[str] = mapped_column(String(20))
    funcod_raw: Mapped[str | None] = mapped_column(String(40), nullable=True)
    employee_name: Mapped[str] = mapped_column(String(255))


class FinanceCollaborator(Base):
    """Colaborador unificado por Funcod dentro de la sesión."""

    __tablename__ = "finance_collaborators"
    __table_args__ = (Index("ix_fin_collab_session_funcod", "session_id", "funcod", unique=True),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), index=True)
    funcod: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(255), index=True)
    # mensualero | jornalero | sin_clasificar (por las cuentas de remuneración)
    category: Mapped[str] = mapped_column(String(20), default="sin_clasificar", index=True)
    # Salió de la empresa en el período (aparece en el asiento de egresos o
    # tiene preaviso/indemnización)
    is_egreso: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[str | None] = mapped_column(String(80), nullable=True)
    cc_main_code: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    cc_main_desc: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cc_count: Mapped[int] = mapped_column(Integer, default=1)
    cc_codes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    file_labels: Mapped[list | None] = mapped_column(JSON, nullable=True)
    entry_count: Mapped[int] = mapped_column(Integer, default=0)
    total_cost: Mapped[int] = mapped_column(BigInteger, default=0)       # gastos (debe, cuentas 5)
    total_liabilities: Mapped[int] = mapped_column(BigInteger, default=0)  # pasivos (haber, cuentas 2)
    total_deductions: Mapped[int] = mapped_column(BigInteger, default=0)   # descuentos (haber, cuentas 1)
    net_pay: Mapped[int] = mapped_column(BigInteger, default=0)          # sueldos y jornales a pagar
    # {"remuneracion": n, "variables": n, "carga_social": n, ...}
    breakdown: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    funcod_dirty: Mapped[bool] = mapped_column(Boolean, default=False)


class FinanceNote(Base):
    __tablename__ = "finance_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), index=True)
    title: Mapped[str] = mapped_column(String(300))
    body_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Contexto opcional: a qué se refiere la nota (cuenta, centro, colaborador)
    ref_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ref_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    ref_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[str] = mapped_column(String(36))
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
