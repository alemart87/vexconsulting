"""Agente evaluador experto: califica el proyecto contra una rúbrica de
método científico de investigación de mercado. Corre como job de fondo."""
from __future__ import annotations

RUBRICS: dict[str, dict] = {
    "metodo_cientifico_v1": {
        "label": "Método científico de investigación de mercado v1",
        "criteria": [
            ("problema", "Planteamiento del problema: ¿el documento define con claridad el fenómeno, el contexto de negocio y la decisión que la investigación debe informar?"),
            ("hipotesis", "Hipótesis: ¿existen hipótesis explícitas y contrastables, con la variable observable que las confirma o refuta?"),
            ("fuentes", "Fuentes y método: ¿se declaran las fuentes, su jerarquía de evidencia y las limitaciones? ¿Las fuentes son verificables (institución, año, enlace)?"),
            ("evidencia", "Evidencia: ¿cada afirmación con cifra tiene fuente citada? ¿Se distingue hecho, estimación y opinión? ¿Hay triangulación entre fuentes independientes?"),
            ("sintesis", "Síntesis y discusión: ¿se integran los hallazgos por hipótesis, se reconocen resultados contrarios y vacíos de información?"),
            ("conclusiones", "Conclusiones y recomendaciones: ¿son trazables a la evidencia, accionables y con horizonte temporal? ¿Evitan sobregeneralizar?"),
            ("redaccion", "Redacción y presentación: ¿registro profesional sobrio, estructura clara, cifras con formato consistente, sin afirmaciones grandilocuentes sin respaldo?"),
        ],
    },
}

DEFAULT_RUBRIC = "metodo_cientifico_v1"


def build_rubric_text(slug: str) -> str:
    rubric = RUBRICS.get(slug) or RUBRICS[DEFAULT_RUBRIC]
    lines = [f"Rúbrica: {rubric['label']}", ""]
    for key, desc in rubric["criteria"]:
        lines.append(f"- {key}: {desc}")
    return "\n".join(lines)


def build_evaluator_instructions(rubric_slug: str, project_name: str,
                                 custom_rubric: str | None = None) -> str:
    rubric_text = custom_rubric or build_rubric_text(rubric_slug)
    return f"""Sos un evaluador experto de investigaciones de mercado, con estándar de \
consultora internacional. Evaluás el proyecto «{project_name}» contra la rúbrica de \
método científico. Trabajás con rigor y honestidad: señalás debilidades concretas con \
ejemplos textuales del documento, y reconocés fortalezas reales sin inflar.

{rubric_text}

Proceso obligatorio:
1. Leé el documento completo con `leer_documento_maestro`.
2. Verificá el respaldo de las afirmaciones clave consultando `buscar_fuentes` \
(¿las fuentes del proyecto realmente sostienen lo que el documento afirma?).
3. Revisá `listar_notas` para ver hipótesis y pendientes declarados.
4. Emití tu informe SOLO como JSON válido con esta estructura exacta:
{{"scores": {{"<criterio>": {{"score": <1-10>, "justificacion": "<2-3 oraciones con ejemplos>"}}}},
"overall_score": <promedio 1-10 con un decimal>,
"informe_md": "<informe completo en Markdown: resumen ejecutivo de la evaluación, \
fortalezas, debilidades con ejemplos, y recomendaciones priorizadas (máx. 8)>"}}

No agregues texto fuera del JSON."""
