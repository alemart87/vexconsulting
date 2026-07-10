"""Render de exportación: Markdown → HTML con identidad Voicenter → DOCX/PDF.

Documento final paginado: portada, índice (con número de página en PDF),
numeración «Página X de Y» al pie y sangría francesa APA en Referencias.

Corre dentro de un subproceso (export_worker): imports perezosos y funciones
síncronas. En Windows dev WeasyPrint puede no estar disponible (GTK); el
worker traduce el error a un mensaje claro — en Docker/Render funciona.
"""
from __future__ import annotations

import re
from pathlib import Path

BRAND_CSS = """
@page {
  size: A4;
  margin: 22mm 18mm 20mm 18mm;
  @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 8pt; color: #5B6275; }
  @bottom-left { content: "VEX Consulting · Voicenter S.A."; font-size: 8pt; color: #5B6275; }
}
@page cover { @bottom-right { content: none; } @bottom-left { content: none; } }
body { font-family: 'DejaVu Sans', sans-serif; font-size: 10.5pt; color: #2A2F3A; line-height: 1.55; }
h1, h2, h3 { color: #0F1116; line-height: 1.15; page-break-after: avoid; }
h1 { font-size: 21pt; text-transform: uppercase; border-bottom: 3px solid #E6332A; padding-bottom: 6px; }
h2 { font-size: 15pt; text-transform: uppercase; margin-top: 22px; }
h3 { font-size: 12pt; margin-top: 16px; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 9pt; page-break-inside: avoid; }
th { background: #F6F7FB; border: 1px solid #E5E7EB; padding: 6px 8px; text-align: left; }
td { border: 1px solid #E5E7EB; padding: 6px 8px; }
blockquote { border-left: 4px solid #E6332A; margin: 12px 0; padding: 4px 14px; color: #5B6275; font-style: italic; }
code { background: #F6F7FB; padding: 1px 4px; border-radius: 3px; font-size: 9pt; color: #662483; }
pre { background: #0F1116; color: #fff; padding: 10px; border-radius: 6px; font-size: 8.5pt; overflow-x: auto; }
img { max-width: 100%; }
a { color: #00B2BF; }
.cover { page: cover; page-break-after: always; text-align: left; padding-top: 60mm; }
.cover .band { height: 10mm; background: #E6332A; margin: 0 -18mm; }
.cover h1 { border: none; font-size: 28pt; margin-top: 26mm; }
.cover .meta { color: #5B6275; font-size: 10pt; margin-top: 8mm; }
.toc { page-break-after: always; }
.toc h2 { border-bottom: 2px solid #E6332A; padding-bottom: 4px; }
.toc p { margin: 4px 0; }
.toc a { color: #2A2F3A; text-decoration: none; }
.toc a::after { content: "  ·  p. " target-counter(attr(href), page); color: #5B6275; font-size: 9pt; }
.toc .toc-2 { padding-left: 6mm; }
.toc .toc-3 { padding-left: 12mm; font-size: 9.5pt; }
.refs p { padding-left: 12mm; text-indent: -12mm; margin: 7px 0; }
"""

_HEADING_RE = re.compile(r"<h([123])>(.*?)</h\1>", re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")


def _anchor_headings(body: str) -> tuple[str, list[tuple[int, str, str]]]:
    """Agrega id a cada h1-h3 del cuerpo y devuelve (html, [(nivel, id, texto)])."""
    entries: list[tuple[int, str, str]] = []
    counter = {"n": 0}

    def repl(match: re.Match) -> str:
        counter["n"] += 1
        hid = f"sec-{counter['n']}"
        level, inner = int(match.group(1)), match.group(2)
        entries.append((level, hid, _TAG_RE.sub("", inner).strip()))
        return f'<h{level} id="{hid}">{inner}</h{level}>'

    return _HEADING_RE.sub(repl, body), entries


def _build_toc(entries: list[tuple[int, str, str]]) -> str:
    if len(entries) < 2:
        return ""
    items = "\n".join(
        f'<p class="toc-{level}"><a href="#{hid}">{text}</a></p>'
        for level, hid, text in entries
    )
    return f'<nav class="toc"><h2>Índice</h2>\n{items}\n</nav>'


def _wrap_references(body: str) -> str:
    """Envuelve la sección Referencias en div.refs (sangría francesa APA)."""
    match = re.search(r"<h2[^>]*>\s*Referencias\s*</h2>", body, re.IGNORECASE)
    if not match:
        return body
    head, rest = body[: match.end()], body[match.end():]
    nxt = re.search(r"<h[12][ >]", rest)
    if nxt:
        return head + f'<div class="refs">{rest[: nxt.start()]}</div>' + rest[nxt.start():]
    return head + f'<div class="refs">{rest}</div>'


def md_to_html(content_md: str, title: str, author_note: str, upload_root: str,
               project_id: str) -> str:
    from markdown_it import MarkdownIt

    md = MarkdownIt("commonmark", {"html": False, "linkify": True}).enable("table").enable("strikethrough")
    body = md.render(content_md or "")
    body = _resolve_images(body, upload_root, project_id)
    body, headings = _anchor_headings(body)
    body = _wrap_references(body)
    toc = _build_toc(headings)
    return f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>{_esc(title)}</title>
<style>{BRAND_CSS}</style></head>
<body>
<div class="cover">
  <div class="band"></div>
  <h1>{_esc(title)}</h1>
  <p class="meta">{_esc(author_note)}</p>
  <p class="meta">VEX Consulting · Plataforma de investigación de mercado · Voicenter S.A.</p>
</div>
{toc}
{body}
</body></html>"""


def _esc(text: str) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _resolve_images(html: str, upload_root: str, project_id: str) -> str:
    """Convierte las URLs internas /api/v1/projects/{id}/images/{name} a rutas
    file:// locales para que el exportador las incruste."""
    pattern = re.compile(r'src="/api/v1/projects/([^/"]+)/images/([^"]+)"')

    def repl(match: re.Match) -> str:
        pid, name = match.group(1), match.group(2)
        if pid != project_id or "/" in name or ".." in name:
            return 'src=""'
        local = Path(upload_root) / pid / "images" / name
        return f'src="{local.as_uri()}"' if local.exists() else 'src=""'

    return pattern.sub(repl, html)


# ---------------------------------------------------------------------------
# DOCX: pandoc (--toc) + post-proceso python-docx (portada y pie paginado)
# ---------------------------------------------------------------------------

def _docx_simple_field(paragraph, instruction: str, placeholder: str = "1") -> None:
    """Inserta un campo de Word (PAGE, NUMPAGES) al final del párrafo."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), instruction)
    run = OxmlElement("w:r")
    text = OxmlElement("w:t")
    text.text = placeholder
    run.append(text)
    fld.append(run)
    paragraph._p.append(fld)


def _decorate_docx(path: str, title: str, author_note: str) -> None:
    """Agrega portada y pie «Página X de Y» al DOCX generado por pandoc."""
    import docx
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_TAB_ALIGNMENT
    from docx.shared import Cm, Pt, RGBColor

    d = docx.Document(path)
    ink = RGBColor(0x0F, 0x11, 0x16)
    slate = RGBColor(0x5B, 0x62, 0x75)
    red = RGBColor(0xE6, 0x33, 0x2A)

    # Portada: se inserta ANTES del primer párrafo (el índice de pandoc).
    if d.paragraphs:
        first = d.paragraphs[0]

        def before(text: str, size: int, bold: bool, color, space_before: int = 0):
            p = first.insert_paragraph_before(text)
            p.paragraph_format.space_before = Pt(space_before)
            run = p.runs[0] if p.runs else p.add_run("")
            run.font.size = Pt(size)
            run.font.bold = bold
            run.font.color.rgb = color
            return p

        before("VEX CONSULTING", 14, True, red, space_before=80)
        before(title, 28, True, ink, space_before=24)
        before(author_note, 10, False, slate, space_before=18)
        before("VEX Consulting · Plataforma de investigación de mercado · Voicenter S.A.",
               10, False, slate, space_before=4)
        brk = first.insert_paragraph_before("")
        brk.add_run().add_break(WD_BREAK.PAGE)

    # Pie de página con numeración en todas las secciones.
    for section in d.sections:
        footer = section.footer
        footer.is_linked_to_previous = False
        p = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
        for run in list(p.runs):
            run.text = ""
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.tab_stops.add_tab_stop(Cm(17), WD_TAB_ALIGNMENT.RIGHT)
        p.add_run("VEX Consulting · Voicenter S.A.\tPágina ")
        _docx_simple_field(p, "PAGE")
        p.add_run(" de ")
        _docx_simple_field(p, "NUMPAGES")
        for run in p.runs:
            run.font.size = Pt(8)
            run.font.color.rgb = slate

    d.save(path)


def export_docx(content_md: str, title: str, author_note: str, output_path: str,
                upload_root: str, project_id: str) -> None:
    """Markdown → DOCX vía pandoc con índice; portada y paginado se agregan
    en post-proceso (python-docx)."""
    import pypandoc

    md = re.sub(
        r"\(/api/v1/projects/([^/)]+)/images/([^)]+)\)",
        lambda m: f"({(Path(upload_root) / m.group(1) / 'images' / m.group(2)).as_posix()})",
        content_md or "",
    )
    pypandoc.convert_text(
        md,
        "docx",
        format="gfm",
        outputfile=output_path,
        extra_args=[
            "--standalone", "--toc", "--toc-depth=3",
            "-M", "toc-title=Índice", "-M", "lang=es",
        ],
    )
    try:
        _decorate_docx(output_path, title, author_note)
    except Exception:
        # La portada/pie son decorativos: el DOCX de pandoc ya es válido.
        import logging

        logging.getLogger("vexconsulting").exception("No se pudo decorar el DOCX")


def export_pdf(content_md: str, title: str, author_note: str, output_path: str,
               upload_root: str, project_id: str) -> None:
    """Markdown → HTML de marca (portada + índice paginado) → PDF vía WeasyPrint."""
    from weasyprint import HTML

    html = md_to_html(content_md, title, author_note, upload_root, project_id)
    HTML(string=html, base_url=upload_root).write_pdf(output_path)


def run_export(fmt: str, content_md: str, title: str, author_note: str,
               output_path: str, upload_root: str, project_id: str) -> None:
    """Punto de entrada del subproceso."""
    if fmt == "docx":
        export_docx(content_md, title, author_note, output_path, upload_root, project_id)
    elif fmt == "pdf":
        export_pdf(content_md, title, author_note, output_path, upload_root, project_id)
    else:
        raise ValueError(f"Formato no soportado: {fmt}")
