"""Generación de artefactos KnowHub (estilo NotebookLM).

- audio    : diálogo de podcast (conductora + analista) escrito por el modelo
             principal y sintetizado con TTS multi-voz; segmentos MP3
             concatenados en un solo archivo.
- mindmap  : esquema jerárquico en Markdown (lo renderiza markmap en el front).
- briefing : resumen ejecutivo de una página.
- faq      : preguntas frecuentes que haría un miembro nuevo del equipo.

Todas las funciones devuelven también el costo USD (guion/LLM por tokens +
TTS estimado por minuto) para el tablero de Costos IA.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..models.document import Document
from ..models.source import Source
from .agent.pricing import compute_cost_usd

logger = logging.getLogger("vexconsulting")

WORDS_PER_SECOND = 2.5  # ritmo de habla estimado para calcular duración


# ---------------------------------------------------------------------------
# Contexto compartido
# ---------------------------------------------------------------------------

async def build_context(db: AsyncSession, project_id: str, project_name: str,
                        description: str | None) -> str:
    doc = (await db.execute(
        select(Document).where(Document.project_id == project_id)
    )).scalar_one_or_none()
    content = (doc.content_md if doc else "") or ""
    sources = (await db.execute(
        select(Source.title).where(Source.project_id == project_id,
                                   Source.status == "ready").limit(25)
    )).scalars().all()
    parts = [f"PROYECTO: {project_name}"]
    if description:
        parts.append(f"OBJETIVO: {description}")
    if sources:
        parts.append("FUENTES CARGADAS: " + " · ".join(sources))
    parts.append(f"DOCUMENTO MAESTRO:\n{content[:26000]}")
    return "\n\n".join(parts)


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


async def _chat(system: str, user: str, usage: _Usage, json_mode: bool = False) -> str:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=420, max_retries=2)
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


# ---------------------------------------------------------------------------
# 🎧 Resumen de audio
# ---------------------------------------------------------------------------

_AUDIO_SCRIPT_SYSTEM = """\
Sos guionista de un podcast interno de una consultora de investigación de
mercado (VEX Consulting). Escribís un diálogo de 4 a 6 minutos entre dos
personas, en español rioplatense profesional pero cercano:
- "A" (conductora): curiosa, hace las preguntas que haría alguien del equipo
  que recién se suma al proyecto; celebra los hallazgos interesantes.
- "B" (analista senior): explica con claridad, SIEMPRE con las cifras y las
  fuentes del documento («según ContactBabel…»); distingue hecho de hipótesis.

Estructura: (1) apertura de UNA frase presentando el proyecto; (2) el problema
y por qué importa; (3) las hipótesis; (4) los 3-5 hallazgos más importantes,
con sus números exactos; (5) qué falta investigar; (6) cierre de una frase.

Reglas: SOLO datos que estén en el material provisto — nunca inventes cifras.
Turnos cortos (1-3 oraciones). Entre 22 y 34 turnos. Nada de descripciones de
escena ni acotaciones: solo lo que se dice.
Respondé SOLO JSON: {"titulo": "<título del episodio>",
"dialogo": [{"voz": "A"|"B", "texto": "<lo que dice>"}]}
"""

_VOICE_INSTRUCTIONS = {
    "A": "Español rioplatense. Conductora de podcast de negocios: cálida, "
         "curiosa, ritmo ágil, profesional y cercana.",
    "B": "Español rioplatense. Analista senior de consultora: voz clara y "
         "segura, ritmo pausado, énfasis en las cifras.",
}


def _tts_segment(text: str, voice: str, instructions: str) -> bytes:
    """Sintetiza un turno del diálogo (sincrónico; se corre en un thread)."""
    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key, timeout=120, max_retries=2)
    resp = client.audio.speech.create(
        model=settings.knowhub_tts_model,
        voice=voice,
        input=text,
        instructions=instructions,
        response_format="mp3",
    )
    return resp.content


async def generate_audio(db: AsyncSession, project_id: str, project_name: str,
                         description: str | None) -> dict:
    """Devuelve {title, script_md, file_path, duration_seconds, cost_usd}."""
    context = await build_context(db, project_id, project_name, description)
    usage = _Usage()
    raw = await _chat(_AUDIO_SCRIPT_SYSTEM, context, usage, json_mode=True)
    data = json.loads(raw)
    title = str(data.get("titulo") or f"Resumen de audio · {project_name}")[:200]
    turns = [
        t for t in (data.get("dialogo") or [])
        if isinstance(t, dict) and (t.get("texto") or "").strip()
    ][:40]
    if len(turns) < 4:
        raise RuntimeError("El guion del audio salió demasiado corto")

    voices = {"A": settings.knowhub_voice_host, "B": settings.knowhub_voice_analyst}
    # TTS por turno, en paralelo acotado (4 a la vez) y en threads
    semaphore = asyncio.Semaphore(4)

    async def synth(turn: dict) -> bytes:
        speaker = "A" if str(turn.get("voz", "A")).upper().startswith("A") else "B"
        async with semaphore:
            return await asyncio.to_thread(
                _tts_segment, turn["texto"].strip(),
                voices[speaker], _VOICE_INSTRUCTIONS[speaker],
            )

    segments = await asyncio.gather(*(synth(t) for t in turns))

    out_dir = settings.upload_path / project_id / "knowhub"
    out_dir.mkdir(parents=True, exist_ok=True)
    file_path = out_dir / f"audio-{uuid.uuid4().hex[:12]}.mp3"
    # Los segmentos comparten códec y parámetros: la concatenación de frames
    # MP3 produce un archivo reproducible.
    file_path.write_bytes(b"".join(segments))

    # Duración exacta del archivo (mutagen); estimación por palabras de respaldo
    try:
        from mutagen.mp3 import MP3

        duration = int(MP3(str(file_path)).info.length)
    except Exception:
        total_words = sum(len(t["texto"].split()) for t in turns)
        duration = int(total_words / WORDS_PER_SECOND)
    tts_cost = round(duration / 60 * settings.knowhub_tts_price_per_min, 4)

    script_md = "\n\n".join(
        f"**{'Conductora' if str(t.get('voz','A')).upper().startswith('A') else 'Analista'}:** {t['texto'].strip()}"
        for t in turns
    )
    return {
        "title": title,
        "content_md": script_md,
        "file_path": str(file_path),
        "duration_seconds": duration,
        "cost_usd": round(usage.cost + tts_cost, 4),
    }


# ---------------------------------------------------------------------------
# 🧠 Mapa mental (Markdown para markmap)
# ---------------------------------------------------------------------------

_MINDMAP_SYSTEM = """\
Sos analista visual de una consultora. Convertís un informe en un MAPA MENTAL
en Markdown jerárquico (formato markmap):
- Línea 1: `# <tema central>` (nombre corto del proyecto).
- Ramas principales con `## `: Problema, Hipótesis, Hallazgos, Fuentes clave,
  Conclusiones, Próximos pasos (usá las que apliquen según el material).
- Subniveles con `### ` y viñetas `- ` (máximo 4 niveles en total).
- Los nodos con CIFRAS van con la cifra: `- Paraguay: 7-8 USD/hora`.
- Nodos CORTOS (máx. ~8 palabras), entre 25 y 60 nodos en total.
- SOLO datos del material provisto. Sin prosa, sin explicaciones.
Respondé SOLO con el Markdown del mapa, sin envolver en ```.
"""


async def generate_mindmap(db: AsyncSession, project_id: str, project_name: str,
                           description: str | None) -> dict:
    context = await build_context(db, project_id, project_name, description)
    usage = _Usage()
    md = await _chat(_MINDMAP_SYSTEM, context, usage)
    md = re.sub(r"^```[a-z]*\n?|\n?```$", "", md.strip())
    if "#" not in md:
        raise RuntimeError("El mapa mental salió sin estructura")
    return {
        "title": f"Mapa mental · {project_name}",
        "content_md": md,
        "cost_usd": round(usage.cost, 4),
    }


# ---------------------------------------------------------------------------
# 📋 Briefing y ❓ FAQ
# ---------------------------------------------------------------------------

_BRIEFING_SYSTEM = """\
Sos consultor senior. Escribí un BRIEFING EJECUTIVO de una página (350-500
palabras) del proyecto, en Markdown, para que un directivo lo entienda en 3
minutos: **De qué trata** (2-3 líneas), **Los números que importan** (viñetas
con cifras exactas y su fuente), **Qué se concluye hasta ahora**, **Qué falta**.
Registro institucional sobrio, sin adjetivos grandilocuentes. SOLO datos del
material provisto. Respondé SOLO con el Markdown.
"""

_FAQ_SYSTEM = """\
Sos el onboarding de un equipo de consultoría. Escribí las PREGUNTAS
FRECUENTES (8 a 10) que haría un miembro nuevo del equipo sobre este proyecto,
con sus respuestas (2-4 oraciones, con cifras y fuentes cuando existan).
Formato Markdown: `### <pregunta>` seguida de la respuesta. Incluí preguntas
incómodas («¿qué debilidad tiene esta evidencia?»). SOLO datos del material
provisto. Respondé SOLO con el Markdown.
"""


async def generate_briefing(db: AsyncSession, project_id: str, project_name: str,
                            description: str | None) -> dict:
    context = await build_context(db, project_id, project_name, description)
    usage = _Usage()
    md = await _chat(_BRIEFING_SYSTEM, context, usage)
    return {
        "title": f"Briefing ejecutivo · {project_name}",
        "content_md": md.strip(),
        "cost_usd": round(usage.cost, 4),
    }


async def generate_faq(db: AsyncSession, project_id: str, project_name: str,
                       description: str | None) -> dict:
    context = await build_context(db, project_id, project_name, description)
    usage = _Usage()
    md = await _chat(_FAQ_SYSTEM, context, usage)
    return {
        "title": f"Preguntas frecuentes · {project_name}",
        "content_md": md.strip(),
        "cost_usd": round(usage.cost, 4),
    }


GENERATORS = {
    "audio": generate_audio,
    "mindmap": generate_mindmap,
    "briefing": generate_briefing,
    "faq": generate_faq,
}
