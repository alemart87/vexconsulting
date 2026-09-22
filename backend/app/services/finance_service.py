"""VEXFINANZAS — motor de análisis de centros de costos.

Entrada: los Excel de asientos contables exportados del sistema de nómina
(hoja «Horas», 14 columnas). Salida: líneas normalizadas, colaboradores
unificados por Funcod y el resumen gerencial de la sesión.

Reglas que salieron del cruce de los 8 archivos de referencia (agosto 2026):
- El identificador del colaborador es **Funcod** (código de funcionario). La
  columna Nombre NO sirve como clave (espacios dobles, comas mal ubicadas).
- Funcod puede venir sucio («-5440329--»): se extraen los dígitos y se marca.
- Cuentas 5xxxxx = gasto (debe); 2xxxxx = pasivo (haber); 1xxxxx = descuento
  al personal (haber).
- Operadores (cuentas 510019/510020) = jornaleros; el resto de las cuentas de
  remuneración/variables = mensualeros. Nadie cobra en las dos.
- Un colaborador puede estar imputado a varios centros de costo en el mismo
  asiento: el costo se prorratea por línea, nunca se asigna entero.
- Un mismo código de centro puede venir con dos descripciones: manda el
  código; se muestra la descripción más frecuente y el resto como alias.

Todo en Python puro (sin pandas) para no sumar dependencias al runtime.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

# ---------------------------------------------------------------------------
# Esquema esperado
# ---------------------------------------------------------------------------

# Nombres normalizados (sin tildes, minúsculas) de las 14 columnas, en orden.
EXPECTED_COLUMNS = [
    "nro",
    "fecha de operacion",
    "nro cod de gestion",
    "descripcion",
    "nro centro de costo",
    "descripcion",
    "rubro",
    "sub rubro",
    "monto debe",
    "monto haber",
    "texto explicativo",
    "orden",
    "funcod",
    "nombre",
]
PREFERRED_SHEET = "horas"
MAX_ROWS = 250_000
# Diferencia debe − haber tolerada como redondeo (Gs.): por debajo «cuadra».
BALANCE_TOLERANCE = 1000

CONCEPT_LABELS: dict[str, str] = {
    "remuneracion": "Remuneraciones",
    "variables": "Variables",
    "carga_social": "Carga social",
    "aguinaldo": "Aguinaldos pagados",
    "vacaciones": "Vacaciones pagadas",
    "preaviso": "Preavisos",
    "indemnizacion": "Indemnizaciones",
    "bonificacion_familiar": "Bonificación familiar",
    "guarderia": "Guardería",
    "ips_a_pagar": "I.P.S. a pagar",
    "neto_a_pagar": "Sueldos y jornales a pagar",
    "aguinaldo_a_pagar": "Aguinaldos a pagar",
    "embargo": "Embargos judiciales",
    "anticipo": "Anticipos al personal",
    "descuento_varios": "Descuentos varios",
    "descuento_promocional": "Descuentos promocionales",
    "otro": "Otros",
}

CATEGORY_LABELS = {
    "mensualero": "Mensualeros",
    "jornalero": "Jornaleros (operadores)",
    "sin_clasificar": "Sin clasificar",
}

# Cliente/negocio al que pertenece un centro de costo, por palabra clave en la
# descripción. Solo se afirma lo que el texto dice explícitamente.
_CLIENT_KEYWORDS: list[tuple[str, str]] = [
    ("general collect", "General Collect"),
    ("santa clara", "Santa Clara"),
    ("coomecipar", "Coomecipar"),
    ("continental", "Continental"),
    ("sudameris", "Sudameris"),
    ("mapfre", "MAPFRE"),
    ("bancop", "Bancop"),
    ("tandem", "Tandem"),
    ("bepsa", "BEPSA"),
    ("claro", "Claro"),
    ("itau", "Itaú"),
    ("anexa", "Anexa"),
    ("solar", "Solar"),
    ("gnb", "GNB"),
]


def _norm(text: Any) -> str:
    """minúsculas, sin tildes, espacios colapsados."""
    s = "" if text is None else str(text)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", s).strip().lower()


def clean_text(text: Any) -> str:
    """Texto visible: colapsa espacios (incluido NBSP) y arregla « ,»."""
    s = "" if text is None else str(text)
    s = s.replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\s*,\s*", ", ", s)
    return s


def normalize_funcod(raw: Any) -> tuple[str, bool]:
    """Devuelve (funcod limpio, venía sucio). Extrae solo los dígitos."""
    if raw is None:
        return "", True
    if isinstance(raw, float) and raw.is_integer():
        raw = int(raw)
    s = str(raw).strip()
    digits = re.sub(r"\D", "", s)
    if not digits:
        return "", True
    return digits, digits != s


def _to_int(v: Any) -> int:
    if v is None or v == "":
        return 0
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int,)):
        return v
    if isinstance(v, float):
        return int(round(v))
    s = str(v).strip().replace(".", "").replace(",", ".")
    try:
        return int(round(float(s)))
    except ValueError:
        return 0


def _to_int_or_none(v: Any) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(float(str(v).strip()))
    except ValueError:
        return None


def _to_date_str(v: Any) -> str | None:
    if v is None or v == "":
        return None
    if hasattr(v, "strftime"):
        return v.strftime("%d/%m/%Y")
    return clean_text(v)[:10]


def period_from_date(date_str: str | None) -> str | None:
    """«dd/mm/yyyy» → «yyyy-mm»."""
    if not date_str:
        return None
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", date_str)
    if not m:
        return None
    return f"{m.group(3)}-{m.group(2)}"


# ---------------------------------------------------------------------------
# Clasificación de archivos y cuentas
# ---------------------------------------------------------------------------

_MONTHS = {
    "enero": "01", "febrero": "02", "marzo": "03", "abril": "04", "mayo": "05",
    "junio": "06", "julio": "07", "agosto": "08", "septiembre": "09", "setiembre": "09",
    "octubre": "10", "noviembre": "11", "diciembre": "12",
}
_ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10}


def classify_file(filename: str) -> tuple[str, str]:
    """(kind, label legible) a partir del nombre del archivo."""
    n = _norm(Path(filename).stem)
    # «Complemento_l» (ele minúscula) y «lI» aparecen en los exports reales
    n = n.replace("_", " ").replace("-", " ")
    if "mensualero" in n:
        return "mensualeros", "Mensualeros"
    if "egreso" in n:
        return "egresos", "Egresos"
    if "complemento" in n:
        m = re.search(r"complemento\s+([ivxl]+)\b", n)
        num = ""
        if m:
            token = m.group(1).replace("l", "i")  # l minúscula usada como I
            num = str(_ROMAN.get(token, "")) or token.upper()
        return "complemento", f"Complemento {num}".strip()
    if "operacion" in n:
        return "operaciones", "Operaciones"
    return "otro", Path(filename).stem[:60]


def period_from_filename(filename: str) -> str | None:
    n = _norm(filename)
    for name, mm in _MONTHS.items():
        m = re.search(rf"{name}\D{{0,3}}(20\d{{2}})", n)
        if m:
            return f"{m.group(1)}-{mm}"
    return None


def period_label(period: str | None) -> str:
    if not period:
        return "Período sin definir"
    inv = {v: k for k, v in _MONTHS.items() if k != "setiembre"}
    try:
        y, m = period.split("-")
        return f"{inv.get(m, m).capitalize()} {y}"
    except ValueError:
        return period


def classify_account(code: int, desc: str) -> dict[str, str | None]:
    """account_type, concept, area, position a partir del código y la descripción."""
    d = _norm(desc)
    s = str(code)
    if s.startswith("5"):
        account_type = "gasto"
    elif s.startswith("2"):
        account_type = "pasivo"
    elif s.startswith("1"):
        account_type = "activo"
    else:
        account_type = "otro"

    if "administracion" in d or s.startswith("5202"):
        area = "administracion"
    elif s.startswith("51"):
        area = "operaciones"
    else:
        area = "-"

    concept = "otro"
    position: str | None = None
    if "remuneraciones" in d:
        concept = "remuneracion"
    elif "variables" in d:
        concept = "variables"
    elif "carga social" in d:
        concept = "carga_social"
    elif "aguinaldos pagados" in d:
        concept = "aguinaldo"
    elif "vacaciones" in d:
        concept = "vacaciones"
    elif "preaviso" in d:
        concept = "preaviso"
    elif "indemnizacion" in d:
        concept = "indemnizacion"
    elif "bonificacion familiar" in d:
        concept = "bonificacion_familiar"
    elif "guarderia" in d:
        concept = "guarderia"
    elif "i.p.s" in d or "ips" in d.split():
        concept = "ips_a_pagar"
    elif "sueldos y jornales" in d:
        concept = "neto_a_pagar"
    elif "aguinaldos a pagar" in d:
        concept = "aguinaldo_a_pagar"
    elif "embargo" in d:
        concept = "embargo"
    elif "anticipo" in d:
        concept = "anticipo"
    elif "descuentos promocionales" in d:
        concept = "descuento_promocional"
    elif "descuentos" in d:
        concept = "descuento_varios"

    if concept in ("remuneracion", "variables"):
        # «VOI - Remuneraciones Jefe de Piso/Controller Operac» → «Jefe de Piso/Controller»
        raw = clean_text(desc)
        raw = re.sub(r"^\s*voi\s*-\s*", "", raw, flags=re.I)
        raw = re.sub(r"^(remuneraciones|variables)\s+", "", raw, flags=re.I)
        raw = re.sub(r"\s+de\s+operaciones\s*$", "", raw, flags=re.I)
        raw = re.sub(r"\s+(operaciones|operac\.?|administraci[oó]n|admin\.?)\s*$", "", raw, flags=re.I)
        position = raw.strip() or None
        if position and area == "administracion":
            position = f"{position} (Administración)"

    return {"account_type": account_type, "concept": concept, "area": area, "position": position}


def client_for_cc(code: int, desc: str) -> str:
    d = _norm(desc)
    for key, label in _CLIENT_KEYWORDS:
        if key in d:
            return label
    if str(code).startswith("28"):
        return "Interno Voicenter"
    return "Sin cliente identificado"


# ---------------------------------------------------------------------------
# Parseo de un Excel
# ---------------------------------------------------------------------------

class FinanceFileError(ValueError):
    """El archivo no tiene el formato de asientos esperado."""


@dataclass
class ParsedFile:
    rows: list[dict] = field(default_factory=list)
    sheet: str = ""
    entry_numbers: list[int] = field(default_factory=list)
    entry_dates: list[str] = field(default_factory=list)
    total_debit: int = 0
    total_credit: int = 0
    dirty_funcods: list[dict] = field(default_factory=list)
    skipped_rows: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def collaborator_count(self) -> int:
        return len({r["funcod"] for r in self.rows if r["funcod"]})

    @property
    def entry_number(self) -> int | None:
        return Counter(self.entry_numbers).most_common(1)[0][0] if self.entry_numbers else None

    @property
    def entry_date(self) -> str | None:
        return Counter(self.entry_dates).most_common(1)[0][0] if self.entry_dates else None

    @property
    def balance_diff(self) -> int:
        return self.total_debit - self.total_credit


def parse_workbook(path: str | Path) -> ParsedFile:
    """Lee la hoja de asientos y devuelve las filas normalizadas.

    Lanza FinanceFileError si faltan columnas: el archivo no se acepta.
    """
    try:
        import openpyxl
    except ImportError as exc:  # pragma: no cover
        raise FinanceFileError("openpyxl no está instalado en el servidor") from exc

    try:
        wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    except Exception as exc:
        raise FinanceFileError(f"No se pudo abrir el Excel: {exc}") from exc

    try:
        sheet = None
        for ws in wb.worksheets:
            if _norm(ws.title) == PREFERRED_SHEET:
                sheet = ws
                break
        if sheet is None:
            sheet = wb.worksheets[0]

        it = sheet.iter_rows(values_only=True)
        header = None
        header_row_idx = 0
        for idx, row in enumerate(it, start=1):
            if row and any(v is not None and str(v).strip() for v in row):
                header = [_norm(v) for v in row]
                header_row_idx = idx
                break
        if header is None:
            raise FinanceFileError("El archivo está vacío")

        # Validación posicional tolerante: mismas 14 columnas, mismo orden.
        got = [h for h in header[: len(EXPECTED_COLUMNS)]]
        missing = [
            f"col {i + 1} «{exp}» (vino «{got[i] if i < len(got) else ''}»)"
            for i, exp in enumerate(EXPECTED_COLUMNS)
            if i >= len(got) or got[i] != exp
        ]
        if missing:
            raise FinanceFileError(
                "El archivo no tiene el formato de asientos esperado (hoja «Horas», "
                "14 columnas: Nro, Fecha de Operación, Nro Cod de Gestión, Descripción, "
                "Nro Centro de Costo, Descripción, Rubro, Sub Rubro, Monto Debe, Monto Haber, "
                "Texto Explicativo, Orden, Funcod, Nombre). Diferencias: " + "; ".join(missing[:4])
            )

        parsed = ParsedFile(sheet=sheet.title)
        for idx, row in enumerate(it, start=header_row_idx + 1):
            if idx - header_row_idx > MAX_ROWS:
                parsed.warnings.append(f"Se leyeron solo las primeras {MAX_ROWS:,} filas")
                break
            if not row or all(v is None or str(v).strip() == "" for v in row):
                continue
            r = list(row) + [None] * (14 - len(row))
            account_code = _to_int_or_none(r[2])
            cc_code = _to_int_or_none(r[4])
            funcod, dirty = normalize_funcod(r[12])
            name = clean_text(r[13])
            if account_code is None or cc_code is None or not funcod:
                parsed.skipped_rows += 1
                continue
            if dirty:
                parsed.dirty_funcods.append({"row": idx, "raw": str(r[12]), "clean": funcod, "name": name})
            entry_number = _to_int_or_none(r[0])
            entry_date = _to_date_str(r[1])
            debit = _to_int(r[8])
            credit = _to_int(r[9])
            if entry_number is not None:
                parsed.entry_numbers.append(entry_number)
            if entry_date:
                parsed.entry_dates.append(entry_date)
            parsed.total_debit += debit
            parsed.total_credit += credit
            acc = classify_account(account_code, clean_text(r[3]))
            parsed.rows.append({
                "row_index": idx,
                "entry_number": entry_number,
                "entry_date": entry_date,
                "account_code": account_code,
                "account_desc": clean_text(r[3])[:255],
                "account_type": acc["account_type"],
                "concept": acc["concept"],
                "area": acc["area"],
                "position": acc["position"],
                "cc_code": cc_code,
                "cc_desc": clean_text(r[5])[:255],
                "rubro": _to_int_or_none(r[6]),
                "subrubro": _to_int_or_none(r[7]),
                "debit": debit,
                "credit": credit,
                "note": (clean_text(r[10]) or None),
                "orden": _to_int_or_none(r[11]),
                "funcod": funcod,
                "funcod_raw": str(r[12])[:40] if dirty else None,
                "employee_name": name[:255],
            })
        if not parsed.rows:
            raise FinanceFileError("El archivo no tiene filas de asientos válidas")
        if parsed.skipped_rows:
            parsed.warnings.append(f"{parsed.skipped_rows} filas sin cuenta, centro o Funcod se omitieron")
        if abs(parsed.balance_diff) >= BALANCE_TOLERANCE:
            parsed.warnings.append(
                f"El asiento no cuadra: debe − haber = {parsed.balance_diff:,} Gs.".replace(",", ".")
            )
        if parsed.dirty_funcods:
            parsed.warnings.append(
                f"{len(parsed.dirty_funcods)} filas con Funcod sucio (se limpiaron a solo dígitos)"
            )
        return parsed
    finally:
        wb.close()


# ---------------------------------------------------------------------------
# Análisis consolidado
# ---------------------------------------------------------------------------

@dataclass
class FileInput:
    id: str
    label: str
    kind: str
    filename: str
    parsed: ParsedFile


def _collab_category(concepts_positions: Iterable[tuple[str, str | None]], file_kinds: set[str]) -> str:
    has_operator = False
    has_monthly = False
    for concept, position in concepts_positions:
        if concept not in ("remuneracion", "variables"):
            continue
        if position and _norm(position).startswith("operador"):
            has_operator = True
        else:
            has_monthly = True
    if has_operator and not has_monthly:
        return "jornalero"
    if has_monthly and not has_operator:
        return "mensualero"
    if has_operator and has_monthly:
        return "mensualero"  # no ocurre en los datos de referencia; prevalece el mensual
    # Sin cuenta de remuneración (solo cargas, vacaciones…): por el origen
    if "operaciones" in file_kinds and "mensualeros" not in file_kinds:
        return "jornalero"
    if "mensualeros" in file_kinds and "operaciones" not in file_kinds:
        return "mensualero"
    return "sin_clasificar"


def build_analysis(files: list[FileInput], period: str | None) -> tuple[list[dict], list[dict], dict]:
    """Devuelve (entries, collaborators, summary)."""
    entries: list[dict] = []
    for f in files:
        for r in f.parsed.rows:
            e = dict(r)
            e["file_id"] = f.id
            entries.append(e)

    # --- Colaboradores -----------------------------------------------------
    by_funcod: dict[str, dict] = {}
    for f in files:
        for r in f.parsed.rows:
            c = by_funcod.get(r["funcod"])
            if c is None:
                c = by_funcod[r["funcod"]] = {
                    "funcod": r["funcod"],
                    "names": Counter(),
                    "files": set(),
                    "file_kinds": set(),
                    "ccs": defaultdict(int),
                    "cc_desc": {},
                    "concepts": set(),
                    "breakdown": defaultdict(int),
                    "positions": defaultdict(int),
                    "entry_count": 0,
                    "total_cost": 0,
                    "total_liabilities": 0,
                    "total_deductions": 0,
                    "net_pay": 0,
                    "is_egreso": f.kind == "egresos",
                    "funcod_dirty": False,
                }
            c["names"][r["employee_name"]] += 1
            c["files"].add(f.label)
            c["file_kinds"].add(f.kind)
            c["entry_count"] += 1
            if r["funcod_raw"]:
                c["funcod_dirty"] = True
            c["concepts"].add((r["concept"], r["position"]))
            if r["account_type"] == "gasto":
                amount = r["debit"] - r["credit"]
                c["total_cost"] += amount
                c["ccs"][r["cc_code"]] += amount
                c["cc_desc"].setdefault(r["cc_code"], r["cc_desc"])
                c["breakdown"][r["concept"]] += amount
                if r["concept"] in ("remuneracion", "variables") and r["position"]:
                    c["positions"][r["position"]] += amount
                if r["concept"] in ("preaviso", "indemnizacion"):
                    c["is_egreso"] = True
            elif r["account_type"] == "pasivo":
                amount = r["credit"] - r["debit"]
                c["total_liabilities"] += amount
                if r["concept"] == "neto_a_pagar":
                    c["net_pay"] += amount
            elif r["account_type"] == "activo":
                c["total_deductions"] += r["credit"] - r["debit"]
            if f.kind == "egresos":
                c["is_egreso"] = True
            if r["cc_code"] not in c["ccs"]:
                c["ccs"][r["cc_code"]] += 0
                c["cc_desc"].setdefault(r["cc_code"], r["cc_desc"])

    collaborators: list[dict] = []
    for funcod, c in by_funcod.items():
        category = _collab_category(c["concepts"], c["file_kinds"])
        main_cc = max(c["ccs"].items(), key=lambda kv: kv[1])[0] if c["ccs"] else None
        position = max(c["positions"].items(), key=lambda kv: kv[1])[0] if c["positions"] else None
        collaborators.append({
            "funcod": funcod,
            "name": c["names"].most_common(1)[0][0],
            "category": category,
            "is_egreso": bool(c["is_egreso"]),
            "position": position,
            "cc_main_code": main_cc,
            "cc_main_desc": c["cc_desc"].get(main_cc) if main_cc is not None else None,
            "cc_count": len(c["ccs"]),
            "cc_codes": sorted(c["ccs"].keys()),
            "file_labels": sorted(c["files"]),
            "entry_count": c["entry_count"],
            "total_cost": c["total_cost"],
            "total_liabilities": c["total_liabilities"],
            "total_deductions": c["total_deductions"],
            "net_pay": c["net_pay"],
            "breakdown": dict(c["breakdown"]),
            "funcod_dirty": c["funcod_dirty"],
        })
    collab_index = {c["funcod"]: c for c in collaborators}

    # --- Centros de costo --------------------------------------------------
    cc_desc_counter: dict[int, Counter] = defaultdict(Counter)
    cc_agg: dict[int, dict] = {}
    for e in entries:
        cc_desc_counter[e["cc_code"]][e["cc_desc"]] += 1
        a = cc_agg.get(e["cc_code"])
        if a is None:
            a = cc_agg[e["cc_code"]] = {
                "code": e["cc_code"], "people": set(), "rows": 0, "cost": 0,
                "concepts": defaultdict(int), "files": set(),
            }
        a["rows"] += 1
        a["people"].add(e["funcod"])
        a["files"].add(e["file_id"])
        if e["account_type"] == "gasto":
            amt = e["debit"] - e["credit"]
            a["cost"] += amt
            a["concepts"][e["concept"]] += amt

    gasto_total = sum(a["cost"] for a in cc_agg.values())
    cost_centers: list[dict] = []
    for code, a in cc_agg.items():
        descs = cc_desc_counter[code].most_common()
        desc = descs[0][0]
        people = a["people"]
        cats = Counter(collab_index[p]["category"] for p in people)
        egresos = sum(1 for p in people if collab_index[p]["is_egreso"])
        cost_centers.append({
            "code": code,
            "desc": desc,
            "aliases": [d for d, _ in descs[1:]],
            "client": client_for_cc(code, desc),
            "people": len(people),
            "mensualeros": cats.get("mensualero", 0),
            "jornaleros": cats.get("jornalero", 0),
            "sin_clasificar": cats.get("sin_clasificar", 0),
            "egresos": egresos,
            "rows": a["rows"],
            "files": len(a["files"]),
            "cost": a["cost"],
            "share": (a["cost"] / gasto_total) if gasto_total else 0,
            "avg_cost": int(a["cost"] / len(people)) if people else 0,
            "concepts": dict(a["concepts"]),
        })
    cost_centers.sort(key=lambda x: -x["cost"])

    # --- Clientes ----------------------------------------------------------
    clients_agg: dict[str, dict] = {}
    for cc in cost_centers:
        c = clients_agg.setdefault(cc["client"], {"client": cc["client"], "cost_centers": 0, "people": set(), "cost": 0})
        c["cost_centers"] += 1
        c["cost"] += cc["cost"]
        c["people"] |= cc_agg[cc["code"]]["people"]
    clients = [
        {"client": c["client"], "cost_centers": c["cost_centers"], "people": len(c["people"]),
         "cost": c["cost"], "share": (c["cost"] / gasto_total) if gasto_total else 0}
        for c in clients_agg.values()
    ]
    clients.sort(key=lambda x: -x["cost"])

    # --- Cuentas -----------------------------------------------------------
    acc_agg: dict[int, dict] = {}
    for e in entries:
        a = acc_agg.get(e["account_code"])
        if a is None:
            a = acc_agg[e["account_code"]] = {
                "code": e["account_code"], "desc": e["account_desc"], "type": e["account_type"],
                "concept": e["concept"], "area": e["area"], "position": e["position"],
                "rows": 0, "people": set(), "ccs": set(), "debit": 0, "credit": 0, "files": set(),
            }
        a["rows"] += 1
        a["people"].add(e["funcod"])
        a["ccs"].add(e["cc_code"])
        a["files"].add(e["file_id"])
        a["debit"] += e["debit"]
        a["credit"] += e["credit"]
    accounts = []
    for a in sorted(acc_agg.values(), key=lambda x: x["code"]):
        net = a["debit"] - a["credit"] if a["type"] == "gasto" else a["credit"] - a["debit"]
        accounts.append({
            "code": a["code"], "desc": a["desc"], "type": a["type"], "concept": a["concept"],
            "concept_label": CONCEPT_LABELS.get(a["concept"], a["concept"]),
            "area": a["area"], "position": a["position"], "rows": a["rows"],
            "people": len(a["people"]), "cost_centers": len(a["ccs"]), "files": len(a["files"]),
            "debit": a["debit"], "credit": a["credit"], "net": net,
        })

    # --- Conceptos y puestos ----------------------------------------------
    concept_totals: dict[str, int] = defaultdict(int)
    position_agg: dict[str, dict] = {}
    for e in entries:
        if e["account_type"] != "gasto":
            continue
        amt = e["debit"] - e["credit"]
        concept_totals[e["concept"]] += amt
    for c in collaborators:
        if not c["position"]:
            continue
        p = position_agg.setdefault(c["position"], {"position": c["position"], "people": 0, "cost": 0})
        p["people"] += 1
        p["cost"] += c["total_cost"]
    concepts = [
        {"concept": k, "label": CONCEPT_LABELS.get(k, k), "cost": v,
         "share": (v / gasto_total) if gasto_total else 0}
        for k, v in sorted(concept_totals.items(), key=lambda kv: -kv[1])
    ]
    positions = sorted(position_agg.values(), key=lambda x: -x["cost"])
    for p in positions:
        p["avg_cost"] = int(p["cost"] / p["people"]) if p["people"] else 0

    # --- Categorías --------------------------------------------------------
    categories: dict[str, dict] = {}
    for key in ("mensualero", "jornalero", "sin_clasificar"):
        members = [c for c in collaborators if c["category"] == key]
        cost = sum(c["total_cost"] for c in members)
        categories[key] = {
            "label": CATEGORY_LABELS[key], "people": len(members), "cost": cost,
            "avg_cost": int(cost / len(members)) if members else 0,
            "share": (cost / gasto_total) if gasto_total else 0,
        }
    egresos_members = [c for c in collaborators if c["is_egreso"]]
    categories["egresos"] = {
        "label": "Egresos del período", "people": len(egresos_members),
        "cost": sum(c["total_cost"] for c in egresos_members),
        "avg_cost": int(sum(c["total_cost"] for c in egresos_members) / len(egresos_members)) if egresos_members else 0,
        "share": (sum(c["total_cost"] for c in egresos_members) / gasto_total) if gasto_total else 0,
    }

    # --- Archivos y avisos -------------------------------------------------
    files_out = []
    warnings: list[dict] = []
    seen_entry_numbers: dict[int, str] = {}
    for f in files:
        p = f.parsed
        files_out.append({
            "id": f.id, "label": f.label, "kind": f.kind, "filename": f.filename,
            "entry_number": p.entry_number, "entry_date": p.entry_date,
            "rows": len(p.rows), "people": p.collaborator_count,
            "debit": p.total_debit, "credit": p.total_credit, "diff": p.balance_diff,
            "dirty_funcods": len(p.dirty_funcods),
        })
        if abs(p.balance_diff) >= BALANCE_TOLERANCE:
            warnings.append({
                "level": "warn", "code": "unbalanced",
                "text": f"{f.label}: el asiento {p.entry_number or ''} no cuadra por {p.balance_diff:,} Gs.".replace(",", "."),
            })
        elif p.balance_diff != 0:
            warnings.append({
                "level": "info", "code": "rounding",
                "text": f"{f.label}: cuadra con diferencia de redondeo de {p.balance_diff:,} Gs.".replace(",", "."),
            })
        dirty_by_code: dict[str, dict] = {}
        for d in p.dirty_funcods:
            g = dirty_by_code.setdefault(d["clean"], {"raw": d["raw"], "name": d["name"], "rows": []})
            g["rows"].append(d["row"])
        for clean, g in list(dirty_by_code.items())[:20]:
            warnings.append({
                "level": "warn", "code": "funcod_dirty",
                "text": (
                    f"{f.label}: Funcod «{g['raw']}» de {g['name']} se leyó como {clean} "
                    f"({len(g['rows'])} filas: {', '.join(str(r) for r in g['rows'][:6])})"
                ),
            })
        if period and p.entry_date and period_from_date(p.entry_date) != period:
            warnings.append({
                "level": "info", "code": "date_outside_period",
                "text": f"{f.label}: fecha de operación {p.entry_date}, fuera del período {period_label(period)} (se incluye igual)",
            })
        if p.entry_number is not None:
            if p.entry_number in seen_entry_numbers:
                warnings.append({
                    "level": "error", "code": "duplicate_entry",
                    "text": f"{f.label} y {seen_entry_numbers[p.entry_number]} tienen el mismo número de asiento {p.entry_number}: ¿archivo duplicado?",
                })
            seen_entry_numbers[p.entry_number] = f.label
    for cc in cost_centers:
        if cc["aliases"]:
            warnings.append({
                "level": "info", "code": "cc_alias",
                "text": f"Centro {cc['code']} aparece como «{cc['desc']}» y también como «{'», «'.join(cc['aliases'])}»",
            })
    unclassified = categories["sin_clasificar"]["people"]
    if unclassified:
        warnings.append({
            "level": "info", "code": "unclassified",
            "text": f"{unclassified} colaboradores sin cuenta de remuneración ni archivo base: quedan «sin clasificar»",
        })
    multi_cc = sum(1 for c in collaborators if c["cc_count"] > 1)

    liabilities_total = sum(c["total_liabilities"] for c in collaborators)
    deductions_total = sum(c["total_deductions"] for c in collaborators)
    net_pay_total = sum(c["net_pay"] for c in collaborators)
    ips_total = sum(a["net"] for a in accounts if a["concept"] == "ips_a_pagar")
    aguinaldo_liab = sum(a["net"] for a in accounts if a["concept"] == "aguinaldo_a_pagar")

    summary = {
        "period": period,
        "period_label": period_label(period),
        "totals": {
            "files": len(files),
            "rows": len(entries),
            "collaborators": len(collaborators),
            "cost_centers": len(cost_centers),
            "accounts": len(accounts),
            "clients": len(clients),
            "cost": gasto_total,
            "liabilities": liabilities_total,
            "deductions": deductions_total,
            "net_pay": net_pay_total,
            "ips": ips_total,
            "aguinaldo_liability": aguinaldo_liab,
            "avg_cost_per_person": int(gasto_total / len(collaborators)) if collaborators else 0,
            "multi_cc_people": multi_cc,
            "balance_diff": sum(f["diff"] for f in files_out),
        },
        "categories": categories,
        "concepts": concepts,
        "positions": positions,
        "cost_centers": cost_centers,
        "clients": clients,
        "accounts": accounts,
        "files": files_out,
        "warnings": warnings,
    }
    return entries, collaborators, summary
