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

_CONSULTORIA_CLIENTES_MD = """# {name}

**Estado**: borrador · **Metodología**: consultoría a clientes de BPO · **Cliente**: *(completar)*

## Resumen ejecutivo

*(Redactar al final: el problema del cliente, la solución propuesta y el impacto esperado, en una página.)*

## 1. Ficha del cliente y del encargo

- **Razón social e industria**: *(banco, financiera, cooperativa, aseguradora, retail...)*
- **Tamaño**: clientes activos, sucursales, dotación propia de atención.
- **Sponsor del encargo y contactos operativos**: *(nombre, cargo, correo)*
- **Decisión que esta consultoría debe informar**: *(tercerizar, ampliar, migrar canales, renegociar...)*
- **Alcance y plazo acordados**: *(servicios cubiertos, fecha de entrega)*

## 2. Relevamiento — preguntas guía

*(Completar en las sesiones de discovery. Registrar la respuesta con fecha y quién la dio; lo no respondido queda como supuesto explícito en la sección 7.)*

### 2.1 Operación y demanda

- ¿Qué volúmenes mensuales maneja por canal (llamadas, WhatsApp, chat, correo, presencial) y cómo se distribuyen por franja horaria y día?
- ¿Cuál es la estacionalidad (cierres, vencimientos, campañas) y los picos históricos?
- ¿Qué tipos de gestión concentran el volumen (consultas, reclamos, cobranzas, ventas, back office)?
- ¿Cuál es el AHT actual por tipo de gestión y canal?
- ¿Qué horario de atención exige el negocio y qué cobertura tiene hoy?

### 2.2 Canales y tecnología

- ¿Qué plataformas usa hoy (telefonía, CRM, ticketing, IVR, bots) y cuáles son propias vs. del proveedor?
- ¿Qué canales digitales están activos y qué porcentaje del contacto resuelven de punta a punta?
- ¿Existen integraciones obligatorias (core bancario, CRM del cliente) y con qué accesos?
- ¿Hay iniciativas de automatización o IA en curso o planificadas?

### 2.3 Personas y organización

- ¿Qué dotación atiende hoy (propia y tercerizada), con qué perfiles y esquema de supervisión?
- ¿Cuál es la rotación anual del equipo de atención y sus causas conocidas?
- ¿Qué formación inicial y continua reciben los agentes? ¿Cuánto dura la curva de aprendizaje?
- ¿Qué complejidad tienen las consultas que llegan a un agente (vs. las autoresueltas)?

### 2.4 Calidad y métricas

- ¿Qué indicadores rige el servicio (SLA, abandono, FCR, NPS, CSAT) y cuáles son sus valores actuales?
- ¿Cómo se mide la calidad (monitoreo, speech analytics, encuestas) y con qué frecuencia?
- ¿Existen penalidades o incentivos por nivel de servicio en los contratos vigentes?

### 2.5 Cumplimiento y seguridad

- ¿Qué normativa aplica a la operación (BCP, SEPRELAD, protección de datos personales, defensa del consumidor)?
- ¿Se exige grabación y resguardo de interacciones? ¿Por cuánto tiempo?
- ¿Qué requisitos de seguridad de la información pide el cliente (accesos, VPN, PCI, auditorías)?
- ¿Los datos pueden salir de las instalaciones del cliente o del país?

### 2.6 Economía del servicio

- ¿Cuál es el costo actual del servicio (por hora, por posición o por contacto) y qué incluye?
- ¿Qué modelo de facturación prefiere el cliente (hora-agente, transacción, resultado, híbrido)?
- ¿Qué presupuesto anual maneja para atención y qué expectativa de ahorro o mejora tiene?
- ¿Quién decide la adjudicación y con qué proceso (licitación, adjudicación directa)?

## 3. Diagnóstico

Hallazgos del relevamiento, cada uno con su evidencia (dato del cliente, observación o benchmark).

| Hallazgo | Impacto en el negocio | Evidencia |
| --- | --- | --- |
| *(ej.: 35 % del volumen llega fuera del horario cubierto)* | *(abandono, pérdida de venta)* | *(reporte del cliente, fecha)* |

## 4. Benchmarks y comparables

Comparar la operación del cliente con el mercado: tarifas por servicio y país, AHT por industria, mejores prácticas de canales digitales. *(Usar el investigador con la jerarquía de fuentes: reguladores, consultoras reconocidas, informes de industria.)*

## 5. Solución propuesta

- **Dimensionamiento**: posiciones y dotación por franja, a partir de los volúmenes relevados.
- **Canales y tecnología**: mezcla propuesta (voz, digital, automatización) y quién aporta cada plataforma.
- **Modelo operativo**: horarios, supervisión, formación, curva de implementación.
- **Gobernanza**: comité de servicio, reportes, revisión de indicadores.

## 6. Modelo económico

Opciones de tarifa con sus supuestos (presentar al menos dos):

| Modelo | Tarifa propuesta | Incluye | Riesgo asignado |
| --- | --- | --- | --- |
| Por hora-agente | | | |
| Por transacción | | | |

## 7. Riesgos y supuestos

Todo dato no confirmado por el cliente se registra acá como supuesto, con su plan de validación.

## 8. Recomendaciones

*(Numeradas y accionables: cada una con responsable, horizonte (30/90/180 días) e indicador de éxito. Separar victorias rápidas de cambios estructurales. Toda recomendación debe trazar a un hallazgo de la sección 3.)*

1. ...

## 9. Plan de implementación

Fases con hitos verificables: transición, estabilización, mejora continua.

## 10. Próximos pasos y acuerdos

Compromisos de la reunión de cierre: quién, qué y para cuándo.

## Referencias

Listar todas las fuentes citadas con enlace verificable.
"""

_CAPACITACION_MD = """# {name}

**Estado**: borrador · **Tipo**: curso / capacitación · **Modalidad**: *(presencial, virtual en vivo, e-learning, mixta)*

## Resumen ejecutivo

*(Redactar al final: qué problema del negocio resuelve este curso, a quién forma y qué resultado medible se espera.)*

## 1. Ficha del curso

- **Necesidad del negocio que origina la capacitación**: *(ej.: NPS bajo en atención, curva de aprendizaje larga, nuevo producto)*
- **Resultado esperado en el puesto**: *(qué va a hacer distinto la persona al terminar)*
- **Solicitante / sponsor**: *(área, nombre, cargo)*
- **Modalidad y duración total**: *(horas, sesiones, semanas)*
- **Cupo y grupos**: *(participantes por edición, cantidad de ediciones)*
- **Fecha objetivo de dictado**: *(completar)*

## 2. Público y prerrequisitos

- **Perfil de los participantes**: *(rol, antigüedad, conocimientos previos)*
- **Prerrequisitos**: *(qué deben saber o tener antes de empezar)*
- **Diagnóstico de partida**: *(pre-test, evaluación de desempeño, entrevistas con supervisores)*

## 3. Objetivos de aprendizaje

*(Medibles y observables: «al finalizar, el participante será capaz de…». Cada objetivo se evalúa en la sección 6.)*

1. ...
2. ...

## 4. Malla curricular

| Módulo | Contenidos | Actividad práctica | Duración | Evaluación |
| --- | --- | --- | --- | --- |
| 1. *(nombre)* | | *(role-play, caso, ejercicio)* | | *(quiz, rúbrica, observación)* |
| 2. | | | | |

## 5. Metodología y materiales

- **Metodología**: *(exposición breve + práctica guiada, microlearning, casos reales de la operación...)*
- **Materiales a producir**: *(manual del participante, guía del instructor, presentaciones, ejercicios, guiones de role-play)*
- **Recursos necesarios**: *(sala, plataforma, accesos a sistemas de práctica, instructores)*

## 6. Evaluación y certificación

- **Evaluación de aprendizaje**: *(pre-test / post-test, trabajos prácticos, observación en simulación)*
- **Criterio de aprobación**: *(nota mínima, asistencia mínima, desempeño en práctica)*
- **Certificación**: *(quién certifica, vigencia, registro)*

## 7. Plan de sesiones

| Sesión | Fecha | Módulos | Instructor | Grupo |
| --- | --- | --- | --- | --- |
| 1 | | | | |

## 8. Medición de impacto (Kirkpatrick)

- **Nivel 1 — Reacción**: encuesta de satisfacción al cierre.
- **Nivel 2 — Aprendizaje**: comparación pre-test vs. post-test.
- **Nivel 3 — Transferencia**: observación en el puesto a los 30-60 días *(qué indicador operativo se revisa: calidad, AHT, FCR...)*.
- **Nivel 4 — Resultados**: impacto en el indicador de negocio que originó el curso.

## 9. Riesgos y supuestos

*(Disponibilidad de participantes en operación, cobertura de la posición durante el curso, accesos a sistemas...)*

## Referencias

Listar bibliografía, normativas y materiales de terceros utilizados, con enlace verificable.
"""

_CAPACITACION_CONTENIDO_MD = """# {name}

**Estado**: borrador · **Tipo**: material del curso · **Plan vinculado**: *(se carga como fuente de este proyecto)*

> **Cómo trabajar este documento**: el plan de la capacitación está cargado en
> **Fuentes** de este proyecto. Pedile al investigador (Diseñador instruccional)
> que redacte cada módulo **citando el plan**: «Redactá el contenido del Módulo 1
> según la malla curricular del plan vinculado». Duplicá el bloque de módulo
> tantas veces como módulos tenga la malla.

## Ficha del material

- **Curso**: *(nombre del curso, del plan vinculado)*
- **Versión del material**: 0.1 · **Última revisión pedagógica**: *(fecha)*
- **Instructores que lo usarán**: *(nombres)*

---

## Módulo 1 — *(nombre del módulo, según la malla del plan)*

### Objetivos del módulo

*(Copiar de la malla: qué será capaz de hacer el participante al terminar este módulo.)*

### Contenido desarrollado

*(El contenido completo que se enseña: conceptos, ejemplos de la operación,
capturas de sistemas, casos reales anonimizados. Escribir para el participante.)*

### Actividad práctica

- **Consigna**: *(qué hace el participante, individual o en grupo)*
- **Materiales**: *(guion de role-play, dataset de práctica, accesos)*
- **Tiempo**: *(minutos)* · **Cierre**: *(qué se pone en común y cómo se corrige)*

### Guion del instructor

| Momento | Duración | Qué hace el instructor | Qué hacen los participantes |
| --- | --- | --- | --- |
| Apertura | | *(gancho, conexión con el puesto)* | |
| Desarrollo | | | |
| Práctica | | | |
| Cierre | | *(síntesis, puente al módulo siguiente)* | |

### Evaluación del módulo

*(Preguntas del quiz con sus respuestas correctas marcadas, o rúbrica de la
observación en práctica. Alineadas a los objetivos del módulo.)*

### Material del participante

*(Resumen de una página que se lleva el participante: ideas clave, pasos del
procedimiento, errores frecuentes.)*

---

## Anexos

- **Glosario**: términos del curso con definición breve.
- **Banco de preguntas**: preguntas adicionales para re-evaluaciones.
- **Plantillas de role-play**: guiones completos con variantes.

## Referencias

Bibliografía y materiales de terceros usados en el contenido, con enlace verificable.
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
    "consultoria_clientes": {
        "label": "Consultoría a clientes (BPO)",
        "content": _CONSULTORIA_CLIENTES_MD,
        "gantt": [
            ("Kick-off y ficha del encargo", "hipotesis", 0, 3),
            ("Sesiones de relevamiento con el cliente (preguntas guía)", "fuentes", 3, 10),
            ("Solicitud y carga de datos del cliente", "fuentes", 5, 12),
            ("Diagnóstico y benchmarks de mercado", "evidencia", 17, 10),
            ("Diseño de solución y modelo económico", "sintesis", 27, 10),
            ("Recomendaciones e informe final (edición APA)", "sintesis", 37, 5),
            ("Presentación al cliente y acuerdos", "evaluacion", 42, 5),
        ],
        "notes": [
            ("Agendar kick-off con el sponsor del cliente", "tarea"),
            ("Solicitar volúmenes históricos de contactos (12 meses, por canal)", "tarea"),
            ("Solicitar métricas actuales: AHT, SLA, abandono, FCR, NPS/CSAT", "tarea"),
            ("Confirmar requisitos normativos aplicables (BCP, SEPRELAD, datos personales)", "tarea"),
            ("Relevar costo actual del servicio y modelo de facturación preferido", "tarea"),
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
    "capacitacion_curso": {
        "label": "Curso / Capacitación",
        "agent_role": "disenador_instruccional",
        "content": _CAPACITACION_MD,
        # Las fases del Gantt reutilizan las etapas existentes; el título de
        # cada tarea lleva el significado del ciclo formativo.
        "gantt": [
            ("Diagnóstico de necesidad y objetivos de aprendizaje", "hipotesis", 0, 5),
            ("Diseño de la malla curricular y evaluaciones", "hipotesis", 5, 7),
            ("Producción de materiales (manual, guía del instructor, ejercicios)", "fuentes", 12, 10),
            ("Convocatoria y logística (grupos, sala/plataforma, accesos)", "fuentes", 15, 7),
            ("Piloto con grupo de prueba y ajustes", "evidencia", 22, 5),
            ("Dictado de la capacitación", "sintesis", 27, 10),
            ("Evaluación, certificación y cierre", "evaluacion", 37, 5),
            ("Medición de transferencia al puesto (30-60 días)", "evaluacion", 42, 30),
        ],
        "notes": [
            ("Definir objetivos de aprendizaje medibles con el sponsor", "tarea"),
            ("Validar perfil y disponibilidad de los participantes con el área", "tarea"),
            ("Preparar pre-test y post-test alineados a los objetivos", "tarea"),
            ("Confirmar cobertura de las posiciones durante el dictado", "tarea"),
            ("Definir el indicador operativo que medirá la transferencia (Kirkpatrick N3)", "tarea"),
        ],
    },
    "capacitacion_contenido": {
        "label": "Material del curso (contenido)",
        "agent_role": "disenador_instruccional",
        "content": _CAPACITACION_CONTENIDO_MD,
        "gantt": [
            ("Redacción del contenido — Módulo 1", "fuentes", 0, 5),
            ("Redacción del contenido — Módulos siguientes", "fuentes", 5, 10),
            ("Guiones del instructor y actividades prácticas", "evidencia", 10, 7),
            ("Quices, rúbricas y material del participante", "evidencia", 15, 5),
            ("Revisión pedagógica contra el plan", "sintesis", 20, 4),
            ("Prueba con un instructor y ajustes", "evaluacion", 24, 4),
            ("Versión final del material", "evaluacion", 28, 2),
        ],
        "notes": [
            ("Confirmar cantidad y nombres de módulos según la malla del plan", "tarea"),
            ("Recolectar casos reales de la operación para los ejemplos", "tarea"),
            ("Verificar que cada quiz evalúa el objetivo de su módulo", "tarea"),
        ],
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


def suggested_role(slug: str | None) -> str | None:
    """Rol del agente acompañante sugerido por la plantilla (o None)."""
    template = _TEMPLATES.get(slug or "")
    return template.get("agent_role") if template else None


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
