"""Plantillas metodológicas de proyecto.

Cada plantilla define: contenido inicial del documento maestro, tareas de
Gantt sugeridas y notas-hipótesis semilla. Basadas en el método científico
aplicado a investigación de mercado.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from ..models.gantt_task import GanttTask
from ..models.note import Note
from ..models.project import Project


_METODO_CIENTIFICO_MD = """# {name}

**Estado**: borrador · **Metodología**: investigación de mercado con método científico

## Resumen ejecutivo

*(Redactar al final: una página con las conclusiones principales, cada una con su dato de respaldo.)*

## 1. Planteamiento del problema

Describir el fenómeno observado, el contexto de negocio y la decisión que esta investigación debe informar.

## 2. Hipótesis

Formular hipótesis contrastables (H1, H2...). Cada hipótesis debe indicar la variable observable que la confirma o la refuta.

## 3. Fuentes y método

Detallar las fuentes primarias y secundarias, la jerarquía de evidencia adoptada y las limitaciones conocidas.

## 4. Evidencia

Presentar los hallazgos por hipótesis, con cifra, fuente y estado de verificación.

## 5. Síntesis y discusión

Integrar los hallazgos: qué se confirma, qué se refuta, qué queda abierto. Contrastar con la literatura y los comparables.

## 6. Conclusiones y recomendaciones

Conclusiones numeradas, cada una trazable a la evidencia. Recomendaciones accionables con horizonte temporal.

## Referencias

Listar todas las fuentes citadas con enlace verificable.
"""

_BLANK_MD = """# {name}

*(Documento maestro del proyecto.)*
"""

_TEMPLATES: dict[str, dict] = {
    "metodo_cientifico_bpo": {
        "label": "Investigación de mercado BPO (método científico)",
        "content": _METODO_CIENTIFICO_MD,
        "gantt": [
            ("Planteamiento del problema e hipótesis", "hipotesis", 0, 7),
            ("Relevamiento y carga de fuentes", "fuentes", 7, 14),
            ("Análisis de evidencia por hipótesis", "evidencia", 21, 21),
            ("Síntesis y redacción", "sintesis", 42, 14),
            ("Evaluación experta y ajustes", "evaluacion", 56, 7),
        ],
        "notes": [
            ("Definir hipótesis H1", "hipotesis"),
            ("Identificar fuentes oficiales disponibles", "tarea"),
        ],
    },
    "estudio_mercado_general": {
        "label": "Estudio de mercado general",
        "content": _METODO_CIENTIFICO_MD,
        "gantt": [
            ("Definición de alcance", "hipotesis", 0, 5),
            ("Recolección de datos", "fuentes", 5, 15),
            ("Análisis", "evidencia", 20, 15),
            ("Informe final", "sintesis", 35, 10),
        ],
        "notes": [],
    },
    "blank": {
        "label": "Documento en blanco",
        "content": _BLANK_MD,
        "gantt": [],
        "notes": [],
    },
}


def list_templates() -> list[dict]:
    return [{"slug": slug, "label": t["label"]} for slug, t in _TEMPLATES.items()]


def initial_content(slug: str, project_name: str) -> str:
    template = _TEMPLATES.get(slug) or _TEMPLATES["blank"]
    return template["content"].format(name=project_name)


async def seed_project_extras(db: AsyncSession, project: Project, actor) -> None:
    """Crea Gantt y notas semilla de la plantilla. Idempotente por diseño:
    solo se llama en la creación del proyecto."""
    template = _TEMPLATES.get(project.template_slug or "blank")
    if not template:
        return
    today = date.today()
    for idx, (title, phase, offset, duration) in enumerate(template["gantt"]):
        db.add(
            GanttTask(
                project_id=project.id,
                title=title,
                phase=phase,
                start_date=today + timedelta(days=offset),
                end_date=today + timedelta(days=offset + duration),
                order_index=idx,
                created_by=actor.id,
            )
        )
    for title, kind in template["notes"]:
        db.add(
            Note(
                project_id=project.id,
                title=title,
                kind=kind,
                created_by=actor.id,
                created_by_name=actor.full_name,
            )
        )
    await db.commit()
