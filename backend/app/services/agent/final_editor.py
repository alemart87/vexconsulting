"""Edición final del documento maestro con normas APA 7.

Pipeline previo a la publicación, en tres pasos deterministas:
1. Mapa de citas: un pase de IA construye, a partir de los enlaces del texto,
   las fuentes del proyecto y la sección de referencias previa (si existe),
   la clave en texto (Autor, año) y la entrada APA 7 de cada fuente.
2. Edición por tramos: cada tramo del documento se corrige (ortografía,
   gramática, consistencia terminológica, jerarquía de títulos) y las citas
   se normalizan usando el mapa. Tablas y figuras reciben leyendas con
   placeholders {{TABLA}} / {{FIGURA}}.
3. Ensamblado en Python: numeración secuencial de tablas/figuras y sección
   «Referencias» ordenada alfabéticamente.

El resultado se guarda como una versión nueva del documento (revisable con
diff antes de publicar) — este módulo solo transforma texto, no toca la DB.
"""
from __future__ import annotations

import json
import logging
import re

from ...core.config import settings
from .pricing import compute_cost_usd

logger = logging.getLogger("vexconsulting")

_LINK_RE = re.compile(r"(?<!\!)\[([^\]]+)\]\((https?://[^\s)]+)\)")
_REFS_HEADING_RE = re.compile(
    r"^#{1,3}\s*(referencias|bibliograf[íi]a|fuentes(\s+consultadas)?)\s*$",
    re.IGNORECASE,
)

_MAP_SYSTEM = """\
Sos el editor bibliográfico de una consultora de investigación de mercado.
Recibís las fuentes citadas en un informe (enlaces del texto, fuentes internas
del proyecto y una lista de referencias previa si existe) y construís el
aparato de citas según NORMAS APA 7.ª EDICIÓN, en español.

Para CADA fuente devolvé:
- "url": la URL exacta recibida (o null para fuentes internas sin URL).
- "en_texto": la cita parentética APA, ej. "(Banco Central del Paraguay, 2025)"
  o "(Emanuel y Harrington, 2023)". Autor corporativo cuando no haya autor
  personal; año "s.f." si no se puede inferir. Si dos fuentes comparten autor
  y año, desambiguá con letras (2025a, 2025b).
- "referencia": la entrada completa de la lista de referencias en APA 7:
  Autor. (Año). *Título en cursiva markdown*. Editorial/Sitio. URL
  Para informes corporativos: Organización. (Año). *Título*. URL

Reglas: NO inventes autores ni años que no puedan inferirse del título, la URL
o el dominio; ante la duda usá el nombre del sitio/organización como autor
corporativo y "s.f." como año. No dupliques fuentes (misma URL = una entrada).
Respondé SOLO con JSON: {"citas": [{"url", "en_texto", "referencia"}, ...]}
"""

_EDIT_SYSTEM = """\
Sos el corrector de estilo senior de una consultora de investigación de
mercado. Recibís UN TRAMO de un informe en Markdown y lo devolvés editado para
publicación según NORMAS APA 7 (adaptadas a Markdown), en español profesional
rioplatense-institucional.

QUÉ CORREGIR:
1. Ortografía, gramática, puntuación y concordancia. Terminología consistente.
2. Prosa: eliminá muletillas y redundancias; NO cambies el sentido, NO agregues
   contenido nuevo, NO modifiques cifras, unidades ni conclusiones.
3. Jerarquía de títulos Markdown coherente (## secciones, ### subsecciones);
   no numeres los títulos si no venían numerados.
4. CITAS: cuando aparezca un enlace markdown [Título](url) usado como cita,
   reemplazalo por su clave del MAPA DE CITAS provisto, ej. "(OCDE, 2024)".
   Si la URL no está en el mapa, dejá el enlace tal cual. NUNCA toques
   imágenes ![...](...) ni enlaces internos que empiecen con /api/.
5. TABLAS: inmediatamente antes de cada tabla markdown insertá su leyenda:
   **Tabla {{TABLA}}**
   *Título descriptivo breve de la tabla*
   Si debajo corresponde indicar la fuente y es evidente en el texto, agregá
   después de la tabla: "*Nota.* Elaboración propia con datos de (clave APA)."
   No inventes fuentes.
6. FIGURAS: inmediatamente antes de cada imagen ![...](...) insertá:
   **Figura {{FIGURA}}**
   *Título descriptivo breve*
   Usá el texto alternativo de la imagen como base del título. No muevas la
   imagen de lugar ni modifiques su URL. Los bloques <details>...</details>
   quedan tal cual.
7. Usá SIEMPRE los placeholders literales {{TABLA}} y {{FIGURA}} — la
   numeración final la hace el sistema. Si una tabla o figura ya tiene leyenda
   con número, reemplazá el número por el placeholder.

Devolvé ÚNICAMENTE el Markdown editado del tramo, sin comentarios, sin
envolverlo en ``` y sin agregar lista de referencias (la arma el sistema).
"""


def _extract_links(md: str) -> list[dict]:
    seen: set[str] = set()
    links: list[dict] = []
    for m in _LINK_RE.finditer(md or ""):
        url = m.group(2)
        if url.startswith("/api/") or url in seen:
            continue
        seen.add(url)
        links.append({"titulo": m.group(1)[:200], "url": url})
    return links


def _split_references(md: str) -> tuple[str, str]:
    """Separa la sección final de referencias (si existe) del cuerpo."""
    lines = (md or "").splitlines()
    for i, line in enumerate(lines):
        if _REFS_HEADING_RE.match(line.strip()):
            rest = "\n".join(lines[i + 1:])
            # Solo la tratamos como sección de referencias si es la última
            # sección (sin otro encabezado de nivel 1-2 después).
            if not re.search(r"^#{1,2}\s+\S", rest, re.MULTILINE):
                return "\n".join(lines[:i]).rstrip(), rest.strip()
    return (md or "").rstrip(), ""


def _chunk_body(body: str, max_chars: int = 9000) -> list[str]:
    """Corta el cuerpo en tramos por secciones ##, agrupando hasta max_chars."""
    sections: list[str] = []
    current: list[str] = []
    for line in body.splitlines():
        if line.startswith("## ") and current:
            sections.append("\n".join(current))
            current = [line]
        else:
            current.append(line)
    if current:
        sections.append("\n".join(current))

    # Secciones gigantes: cortar por párrafos.
    pieces: list[str] = []
    for sec in sections:
        if len(sec) <= max_chars * 1.6:
            pieces.append(sec)
            continue
        buf = ""
        for para in sec.split("\n\n"):
            if buf and len(buf) + len(para) > max_chars:
                pieces.append(buf)
                buf = para
            else:
                buf = f"{buf}\n\n{para}" if buf else para
        if buf:
            pieces.append(buf)

    chunks: list[str] = []
    buf = ""
    for piece in pieces:
        if buf and len(buf) + len(piece) > max_chars:
            chunks.append(buf)
            buf = piece
        else:
            buf = f"{buf}\n\n{piece}" if buf else piece
    if buf:
        chunks.append(buf)
    return chunks or [""]


def _renumber(md: str) -> tuple[str, int, int]:
    counts = {"TABLA": 0, "FIGURA": 0}

    def repl(match: re.Match) -> str:
        kind = match.group(1)
        counts[kind] += 1
        return str(counts[kind])

    out = re.sub(r"\{\{(TABLA|FIGURA)\}\}", repl, md)
    return out, counts["TABLA"], counts["FIGURA"]


class _Usage:
    def __init__(self) -> None:
        self.input = 0
        self.output = 0
        self.cached = 0

    def add(self, usage) -> None:
        if not usage:
            return
        self.input += int(getattr(usage, "prompt_tokens", 0) or 0)
        self.output += int(getattr(usage, "completion_tokens", 0) or 0)
        details = getattr(usage, "prompt_tokens_details", None)
        self.cached += int(getattr(details, "cached_tokens", 0) or 0)

    @property
    def cost(self) -> float:
        return compute_cost_usd(self.input, self.output, self.cached)


async def _chat(client, system: str, user: str, usage: _Usage, json_mode: bool = False) -> str:
    kwargs: dict = {
        "model": settings.agent_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    resp = await client.chat.completions.create(**kwargs)
    usage.add(getattr(resp, "usage", None))
    return (resp.choices[0].message.content or "").strip()


async def _build_citation_map(
    client, links: list[dict], sources: list[dict], old_refs: str, usage: _Usage
) -> list[dict]:
    if not links and not sources and not old_refs:
        return []
    payload = {
        "enlaces_citados_en_el_texto": links,
        "fuentes_internas_del_proyecto": sources,
        "lista_de_referencias_previa": old_refs or None,
    }
    raw = await _chat(
        client, _MAP_SYSTEM,
        json.dumps(payload, ensure_ascii=False), usage, json_mode=True,
    )
    try:
        data = json.loads(raw)
        citas = data.get("citas") or []
        return [c for c in citas if isinstance(c, dict) and c.get("referencia")]
    except Exception:
        logger.warning("Edición final: mapa de citas ilegible, se continúa sin mapa")
        return []


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n", "", text)
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


async def run_final_edit(
    *, content_md: str, project_name: str, sources: list[dict]
) -> tuple[str, dict, float]:
    """Devuelve (markdown_final, stats, costo_usd). Lanza excepción si falla."""
    from openai import AsyncOpenAI

    if not settings.openai_api_key:
        raise RuntimeError("Falta OPENAI_API_KEY.")
    if not (content_md or "").strip():
        raise RuntimeError("El documento está vacío: no hay nada que editar.")

    client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=600, max_retries=2)
    usage = _Usage()

    body, old_refs = _split_references(content_md)
    links = _extract_links(body)

    cite_map = await _build_citation_map(client, links, sources, old_refs, usage)
    by_url = {c["url"]: c for c in cite_map if c.get("url")}

    chunks = _chunk_body(body)
    edited: list[str] = []
    for idx, chunk in enumerate(chunks):
        chunk_urls = {m.group(2) for m in _LINK_RE.finditer(chunk)}
        relevant = [
            {"url": u, "en_texto": by_url[u].get("en_texto", "")}
            for u in chunk_urls if u in by_url
        ]
        user_msg = (
            f"INFORME: «{project_name}» — tramo {idx + 1} de {len(chunks)}.\n\n"
            f"MAPA DE CITAS (url → clave en texto):\n"
            f"{json.dumps(relevant, ensure_ascii=False) if relevant else '(sin citas web en este tramo)'}\n\n"
            f"TRAMO A EDITAR:\n{chunk}"
        )
        result = await _chat(client, _EDIT_SYSTEM, user_msg, usage)
        edited.append(_strip_fences(result) or chunk)

    final_md = "\n\n".join(edited).strip()
    final_md, n_tables, n_figures = _renumber(final_md)

    # Sección de Referencias APA, alfabética, con un salto entre entradas
    # (la sangría francesa la aplica el export).
    refs = sorted(
        {(c.get("referencia") or "").strip() for c in cite_map if c.get("referencia")},
        key=lambda r: r.lower().lstrip("*_"),
    )
    if refs:
        final_md += "\n\n## Referencias\n\n" + "\n\n".join(refs) + "\n"

    stats = {
        "tramos": len(chunks),
        "tablas_numeradas": n_tables,
        "figuras_numeradas": n_figures,
        "referencias": len(refs),
        "citas_mapeadas": len(cite_map),
        "tokens_entrada": usage.input,
        "tokens_salida": usage.output,
    }
    return final_md, stats, usage.cost
