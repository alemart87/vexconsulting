"""Extracción de texto de las fuentes (PDF, Word, Excel, links, texto plano).

Corre dentro de un subproceso aislado (jobs) — acá solo lógica pura y síncrona.
Cada extractor devuelve una lista de secciones: {text, meta{page|sheet|section}}.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

Section = dict[str, Any]  # {"text": str, "meta": {...}}

_MIN_CHARS_PER_PAGE = 100  # bajo esto, el PDF probablemente es escaneado


def extract_pdf(path: str) -> tuple[list[Section], int]:
    """pypdf primero; si el texto es pobre, reintenta con pdfplumber."""
    from pypdf import PdfReader

    reader = PdfReader(path)
    pages: list[Section] = []
    total_chars = 0
    for i, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        total_chars += len(text)
        if text:
            pages.append({"text": text, "meta": {"page": i}})

    n_pages = len(reader.pages)
    if n_pages and total_chars / max(n_pages, 1) < _MIN_CHARS_PER_PAGE:
        try:
            import pdfplumber

            pages = []
            with pdfplumber.open(path) as pdf:
                for i, page in enumerate(pdf.pages, start=1):
                    text = (page.extract_text() or "").strip()
                    if text:
                        pages.append({"text": text, "meta": {"page": i}})
        except Exception:
            pass  # nos quedamos con lo de pypdf
    return pages, n_pages


def extract_docx(path: str) -> list[Section]:
    import docx

    document = docx.Document(path)
    sections: list[Section] = []
    current_heading = ""
    buffer: list[str] = []

    def flush() -> None:
        if buffer:
            sections.append({
                "text": "\n".join(buffer).strip(),
                "meta": {"section": current_heading or None},
            })
            buffer.clear()

    for para in document.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        if para.style.name.lower().startswith("heading"):
            flush()
            current_heading = text
            buffer.append(f"## {text}")
        else:
            buffer.append(text)
    flush()

    for t_idx, table in enumerate(document.tables, start=1):
        rows = []
        for row in table.rows:
            rows.append(" | ".join(c.text.strip() for c in row.cells))
        if rows:
            sections.append({
                "text": "\n".join(rows),
                "meta": {"section": f"tabla {t_idx}"},
            })
    return [s for s in sections if s["text"]]


def extract_xlsx(path: str, max_rows: int = 200000) -> list[Section]:
    """Cada hoja se convierte a tabla markdown, troceada en bloques de filas
    que conservan el encabezado (citables por hoja y rango)."""
    from openpyxl import load_workbook

    wb = load_workbook(path, read_only=True, data_only=True)
    sections: list[Section] = []
    BLOCK = 40  # filas por bloque

    for sheet in wb.worksheets:
        rows_iter = sheet.iter_rows(values_only=True)
        try:
            header = next(rows_iter)
        except StopIteration:
            continue
        header_cells = [str(c) if c is not None else "" for c in header]
        header_md = "| " + " | ".join(header_cells) + " |"
        sep_md = "|" + "---|" * len(header_cells)

        block: list[str] = []
        start_row = 2
        count = 0
        for r_idx, row in enumerate(rows_iter, start=2):
            if count >= max_rows:
                break
            cells = [str(c) if c is not None else "" for c in row]
            if not any(c.strip() for c in cells):
                continue
            block.append("| " + " | ".join(cells) + " |")
            count += 1
            if len(block) >= BLOCK:
                sections.append({
                    "text": "\n".join([header_md, sep_md, *block]),
                    "meta": {"sheet": sheet.title, "rows": f"{start_row}-{r_idx}"},
                })
                block = []
                start_row = r_idx + 1
        if block:
            sections.append({
                "text": "\n".join([header_md, sep_md, *block]),
                "meta": {"sheet": sheet.title, "rows": f"{start_row}+"},
            })
    wb.close()
    return sections


def extract_link(url: str) -> tuple[list[Section], str]:
    """Descarga la página y extrae el contenido principal con trafilatura."""
    import httpx

    resp = httpx.get(
        url,
        follow_redirects=True,
        timeout=45,
        headers={"User-Agent": "Mozilla/5.0 (compatible; VEXConsulting/1.0)"},
    )
    resp.raise_for_status()
    html = resp.text

    text = ""
    title = url
    try:
        import trafilatura

        extracted = trafilatura.extract(html, include_tables=True, include_links=False)
        if extracted:
            text = extracted
        meta = trafilatura.extract_metadata(html)
        if meta and meta.title:
            title = meta.title
    except Exception:
        pass

    if not text:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        text = "\n".join(t.strip() for t in soup.get_text("\n").splitlines() if t.strip())
        if soup.title and soup.title.string:
            title = soup.title.string.strip()

    return ([{"text": text, "meta": {"section": "contenido"}}] if text else []), title


def extract_text_file(path: str) -> list[Section]:
    raw = Path(path).read_text(encoding="utf-8", errors="replace")
    return [{"text": raw, "meta": {}}] if raw.strip() else []


def extract_source(kind: str, stored_path: str | None, url: str | None,
                   mime_type: str | None, max_rows: int) -> dict:
    """Dispatch principal. Devuelve {sections, page_count, title_hint}."""
    if kind == "link" and url:
        sections, title = extract_link(url)
        return {"sections": sections, "page_count": None, "title_hint": title}

    if not stored_path:
        return {"sections": [], "page_count": None, "title_hint": None}

    mt = (mime_type or "").lower()
    lower = stored_path.lower()
    if "pdf" in mt or lower.endswith(".pdf"):
        pages, n = extract_pdf(stored_path)
        return {"sections": pages, "page_count": n, "title_hint": None}
    if lower.endswith(".docx") or "wordprocessingml" in mt:
        return {"sections": extract_docx(stored_path), "page_count": None, "title_hint": None}
    if lower.endswith((".xlsx", ".xlsm")) or "spreadsheetml" in mt:
        return {"sections": extract_xlsx(stored_path, max_rows), "page_count": None, "title_hint": None}
    if lower.endswith((".txt", ".md", ".csv")) or mt.startswith("text/"):
        return {"sections": extract_text_file(stored_path), "page_count": None, "title_hint": None}

    raise ValueError(
        "Formato no soportado. Aceptamos PDF, Word (.docx), Excel (.xlsx), "
        "texto (.txt/.md/.csv) y links."
    )
