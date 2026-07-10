"""Render de exportación: Markdown → HTML con identidad Voicenter → DOCX/PDF.

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
  @bottom-right { content: counter(page) " / " counter(pages); font-size: 8pt; color: #5B6275; }
  @bottom-left { content: "VEX Consulting · Voicenter S.A."; font-size: 8pt; color: #5B6275; }
}
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
.cover { page-break-after: always; text-align: left; padding-top: 60mm; }
.cover .band { height: 10mm; background: #E6332A; margin: 0 -18mm; }
.cover h1 { border: none; font-size: 28pt; margin-top: 26mm; }
.cover .meta { color: #5B6275; font-size: 10pt; margin-top: 8mm; }
"""


def md_to_html(content_md: str, title: str, author_note: str, upload_root: str,
               project_id: str) -> str:
    from markdown_it import MarkdownIt

    md = MarkdownIt("commonmark", {"html": False, "linkify": True}).enable("table").enable("strikethrough")
    body = md.render(content_md or "")
    body = _resolve_images(body, upload_root, project_id)
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


def export_docx(content_md: str, title: str, author_note: str, output_path: str,
                upload_root: str, project_id: str) -> None:
    """Markdown → DOCX vía pandoc. Las imágenes internas se convierten a rutas locales."""
    import pypandoc

    md = re.sub(
        r"\(/api/v1/projects/([^/)]+)/images/([^)]+)\)",
        lambda m: f"({(Path(upload_root) / m.group(1) / 'images' / m.group(2)).as_posix()})",
        content_md or "",
    )
    header = f"# {title}\n\n*{author_note}*\n\n---\n\n"
    pypandoc.convert_text(
        header + md,
        "docx",
        format="gfm",
        outputfile=output_path,
        extra_args=["--standalone"],
    )


def export_pdf(content_md: str, title: str, author_note: str, output_path: str,
               upload_root: str, project_id: str) -> None:
    """Markdown → HTML de marca → PDF vía WeasyPrint."""
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
