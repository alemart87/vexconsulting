"""Exportación a Excel de VEXFINANZAS (centro de costo o sesión completa).

Se genera en memoria con openpyxl en modo de solo escritura y se devuelve como
descarga: no toca disco ni deja archivos. Un centro grande (~1.300 líneas)
pesa ~100 KB y tarda menos de medio segundo; la sesión completa (~13.000
líneas) ronda 1 MB.
"""
from __future__ import annotations

import re
from io import BytesIO
from typing import Iterable

from .finance_service import CATEGORY_LABELS, CONCEPT_LABELS

_HEADER_FILL = "FFE6332A"


def safe_filename(*parts: str) -> str:
    out = "_".join(re.sub(r"[^A-Za-z0-9._-]+", "-", p).strip("-") for p in parts if p)
    return (out or "export")[:120] + ".xlsx"


def _header(ws, cols: list[str]) -> None:
    from openpyxl.cell import WriteOnlyCell
    from openpyxl.styles import Font, PatternFill

    cells = []
    for c in cols:
        cell = WriteOnlyCell(ws, value=c)
        cell.font = Font(bold=True, color="FFFFFFFF")
        cell.fill = PatternFill("solid", fgColor=_HEADER_FILL)
        cells.append(cell)
    ws.append(cells)


def _entry_row(e) -> list:
    return [
        e.file_label, e.entry_number, e.entry_date, e.account_code, e.account_desc,
        e.account_type, CONCEPT_LABELS.get(e.concept, e.concept), e.position, e.cc_code, e.cc_desc,
        e.funcod, e.employee_name, e.debit, e.credit, e.orden, e.row_index,
    ]


ENTRY_COLS = [
    "Archivo", "Asiento", "Fecha", "Cuenta", "Descripción cuenta", "Tipo", "Concepto", "Puesto",
    "Centro de costo", "Descripción centro", "Funcod", "Colaborador", "Debe", "Haber", "Orden", "Fila origen",
]
COLLAB_COLS = [
    "Funcod", "Colaborador", "Tipo", "Egreso", "Puesto", "Centro principal", "Cant. centros",
    "Gasto total empresa", "Neto a pagar", "Pasivos", "Descuentos", "Líneas", "Archivos",
]


def build_workbook(
    *,
    title: str,
    session_name: str,
    period_label: str,
    summary_rows: Iterable[tuple],
    accounts: Iterable[dict],
    collaborators: Iterable[dict],
    entries: Iterable,
    extra_cols: list[tuple[str, str]] | None = None,
) -> bytes:
    """`extra_cols`: columnas adicionales de la hoja Colaboradores como
    (encabezado, clave del dict), p. ej. («Gasto en este centro», «cost_in_cc»)."""
    from openpyxl import Workbook

    wb = Workbook(write_only=True)

    ws = wb.create_sheet("Resumen")
    _header(ws, ["VEXFINANZAS", title])
    ws.append(["Sesión", session_name])
    ws.append(["Período", period_label])
    for k, v in summary_rows:
        ws.append([k, v])
    ws.append([])
    _header(ws, ["Cuenta", "Descripción", "Tipo", "Concepto", "Líneas", "Colaboradores", "Debe", "Haber", "Neto"])
    for a in accounts:
        ws.append([a["code"], a["desc"], a["type"], a.get("concept_label") or a.get("concept"),
                   a["rows"], a["people"], a["debit"], a["credit"], a["net"]])

    extra_cols = extra_cols or []
    ws = wb.create_sheet("Colaboradores")
    _header(ws, COLLAB_COLS + [h for h, _ in extra_cols])
    for c in collaborators:
        row = [
            c["funcod"], c["name"], CATEGORY_LABELS.get(c["category"], c["category"]),
            "Sí" if c["is_egreso"] else "No", c.get("position"), c.get("cc_main_desc"), c["cc_count"],
            c["total_cost"], c["net_pay"], c["total_liabilities"], c["total_deductions"], c["entry_count"],
            ", ".join(c.get("file_labels") or []),
        ]
        row += [c.get(k, 0) for _, k in extra_cols]
        ws.append(row)

    ws = wb.create_sheet("Movimientos")
    _header(ws, ENTRY_COLS)
    for e in entries:
        ws.append(_entry_row(e))

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
