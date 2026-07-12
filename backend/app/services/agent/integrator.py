"""Agente integrador: entiende el documento maestro y decide DÓNDE y CÓMO
insertar un contenido investigado, editando con criterio (sin crear secciones
huérfanas). Devuelve un plan de operaciones que se aplica de forma
determinista — ningún modelo reescribe el documento entero."""
from __future__ import annotations

import json
import re

from ...core.config import settings

MAX_DOC_CHARS = 60_000
MAX_CONTENT_CHARS = 30_000

_SYSTEM = """Sos el EDITOR responsable del documento maestro de un proyecto de \
investigación. Te dan el documento completo y un contenido nuevo (hallazgos con \
citas). Tu trabajo: decidir DÓNDE corresponde cada parte del contenido y cómo \
integrarla respetando la estructura y el estilo del documento.

Reglas:
- Distribuí el contenido entre las secciones EXISTENTES que correspondan (podés \
dividirlo). Usá el título EXACTO de la sección destino tal como aparece en el \
documento (sin los #).
- modo "agregar": el contenido se suma al final de esa sección (lo normal).
- modo "reemplazar": SOLO si la sección es un placeholder sin contenido real \
(instrucciones en cursiva tipo «(Completar...)» o «(Redactar al final...)»). \
Nunca reemplaces contenido sustantivo del documento.
- Adaptá la redacción para que fluya con lo que ya hay (conectores, sin repetir \
lo que la sección ya dice, mismo registro sobrio). CONSERVÁ todas las citas y \
enlaces del contenido nuevo.
- Solo si de verdad NO existe sección adecuada, creá una: usá "seccion_nueva" \
con un título breve y "despues_de" con el título de la sección existente tras \
la cual va.
- No inventes datos: usá únicamente el contenido provisto.

Respondé SOLO JSON:
{"resumen": "<una frase: qué integraste y dónde>",
 "operaciones": [
   {"seccion": "<título exacto existente>", "modo": "agregar"|"reemplazar", "contenido": "<markdown>"} |
   {"seccion_nueva": "<título>", "despues_de": "<título existente>", "contenido": "<markdown>"}
 ]}"""


def _find_section(lines: list[str], title: str) -> tuple[int, int, int] | None:
    """(línea del heading, nivel, línea fin de sección) — matching tolerante."""
    target = re.sub(r"[^\wáéíóúñü ]", "", (title or "").strip().lower())
    if not target:
        return None
    best = None
    for i, line in enumerate(lines):
        m = re.match(r"^(#{1,4})\s+(.*)$", line.strip())
        if not m:
            continue
        heading = re.sub(r"[^\wáéíóúñü ]", "", m.group(2).strip().lower())
        if heading == target or target in heading or heading in target:
            level = len(m.group(1))
            end = len(lines)
            for j in range(i + 1, len(lines)):
                m2 = re.match(r"^(#{1,4})\s+", lines[j].strip())
                if m2 and len(m2.group(1)) <= level:
                    end = j
                    break
            exact = heading == target
            if exact:
                return (i, level, end)
            if best is None:
                best = (i, level, end)
    return best


_PLACEHOLDER_RE = re.compile(r"^\s*[*(_¿]|^\s*$")


def apply_ops(doc_md: str, ops: list[dict]) -> tuple[str, list[str]]:
    """Aplica el plan de forma determinista. Devuelve (doc_nuevo, secciones)."""
    lines = doc_md.splitlines()
    applied: list[str] = []
    for op in ops:
        contenido = (op.get("contenido") or "").strip()
        if not contenido:
            continue
        if op.get("seccion_nueva"):
            title = str(op["seccion_nueva"]).strip()
            after = _find_section(lines, str(op.get("despues_de") or ""))
            block = ["", f"## {title}", "", contenido, ""]
            if after:
                lines[after[2]:after[2]] = block
            else:
                lines += block
            applied.append(title)
            continue
        loc = _find_section(lines, str(op.get("seccion") or ""))
        if not loc:
            lines += ["", contenido, ""]
            applied.append(str(op.get("seccion") or "final del documento"))
            continue
        start, _level, end = loc
        if op.get("modo") == "reemplazar":
            body = lines[start + 1:end]
            # Solo se reemplaza si la sección era un placeholder (nada sustantivo)
            if all(_PLACEHOLDER_RE.match(l) for l in body):
                lines[start + 1:end] = ["", contenido, ""]
                applied.append(lines[start].lstrip("# ").strip())
                continue
        lines[end:end] = ["", contenido, ""]
        applied.append(lines[start].lstrip("# ").strip())
    return "\n".join(lines), applied


async def plan_integration(
    doc_md: str, content: str, hint: str | None = None
) -> tuple[list[dict], str, float, dict]:
    """Devuelve (operaciones, resumen, costo_usd, usage_breakdown)."""
    from openai import AsyncOpenAI

    from .pricing import compute_cost_usd

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    user_msg = (
        f"DOCUMENTO MAESTRO ACTUAL:\n{doc_md[:MAX_DOC_CHARS]}\n\n"
        + (f"PEDIDO ORIGINAL DEL CONSULTOR: {hint}\n\n" if hint else "")
        + f"CONTENIDO NUEVO A INTEGRAR:\n{content[:MAX_CONTENT_CHARS]}"
    )
    resp = await client.chat.completions.create(
        model=settings.agent_model,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": _SYSTEM},
                  {"role": "user", "content": user_msg}],
    )
    raw = resp.choices[0].message.content or "{}"
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    data = json.loads(match.group(0)) if match else {}
    ops = [o for o in data.get("operaciones", []) if isinstance(o, dict)]
    if not ops:
        raise ValueError("El integrador no devolvió operaciones")
    usage = resp.usage
    cached = int(getattr(getattr(usage, "prompt_tokens_details", None), "cached_tokens", 0) or 0)
    cost = compute_cost_usd(usage.prompt_tokens, usage.completion_tokens, cached)
    breakdown = {
        "input_tokens": usage.prompt_tokens,
        "output_tokens": usage.completion_tokens,
        "cached_tokens": cached,
        "model": settings.agent_model,
    }
    return ops, str(data.get("resumen") or ""), cost, breakdown
