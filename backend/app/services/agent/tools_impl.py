"""Implementaciones puras de las tools del agente (sin decoradores del SDK).

Cada _impl abre su propia sesión, y el filtro por project_id vive acá
(defensa en profundidad: el agente no puede salirse de su proyecto).
"""
from __future__ import annotations

from sqlalchemy import select

from ...core.database import session_scope
from ...models.document import Document
from ...models.document_version import DocumentVersion
from ...models.gantt_task import GanttTask
from ...models.note import NOTE_KINDS, Note
from ..rag.retriever import format_citation, search_chunks
from .context import AgentContext


async def buscar_fuentes_impl(ctx: AgentContext, consulta: str, cantidad: int = 8) -> dict:
    if not ctx.project_id:
        return {"error": "Sin proyecto activo"}
    cantidad = max(1, min(int(cantidad or 8), 15))
    async with session_scope() as db:
        results = await search_chunks(db, ctx.project_id, consulta, k=cantidad)
    if not results:
        return {"sin_datos": True, "mensaje": "Ninguna fuente del proyecto matchea la consulta."}
    return {
        "resultados": [
            {
                "cita": format_citation(r),
                "fuente_id": r["source_id"],
                "contenido": r["content"][:1500],
            }
            for r in results
        ]
    }


async def leer_documento_impl(ctx: AgentContext) -> dict:
    if not ctx.project_id:
        return {"error": "Sin proyecto activo"}
    async with session_scope() as db:
        # Visualizador: SOLO la versión publicada congelada.
        if ctx.agent_type == "visualizador":
            if not ctx.published_version_id:
                return {"error": "El proyecto no tiene versión publicada"}
            version = await db.get(DocumentVersion, ctx.published_version_id)
            if not version or version.project_id != ctx.project_id:
                return {"error": "Versión publicada no encontrada"}
            return {"contenido_md": version.content_md[:60000], "version": version.version_number}

        result = await db.execute(
            select(Document).where(Document.project_id == ctx.project_id)
        )
        doc = result.scalar_one_or_none()
        if not doc:
            return {"sin_datos": True}
        return {"contenido_md": (doc.content_md or "")[:60000], "palabras": doc.word_count}


async def listar_notas_impl(ctx: AgentContext) -> dict:
    if not ctx.project_id:
        return {"error": "Sin proyecto activo"}
    async with session_scope() as db:
        result = await db.execute(
            select(Note).where(Note.project_id == ctx.project_id).order_by(Note.created_at.desc()).limit(50)
        )
        notes = result.scalars().all()
    return {
        "notas": [
            {"id": n.id, "titulo": n.title, "tipo": n.kind, "estado": n.status,
             "detalle": (n.body_md or "")[:300]}
            for n in notes
        ]
    }


async def crear_nota_impl(ctx: AgentContext, titulo: str, detalle: str, tipo: str) -> dict:
    if not ctx.project_id:
        return {"error": "Sin proyecto activo"}
    if ctx.agent_type == "visualizador":
        return {"error": "El agente del visualizador no puede crear notas"}
    tipo = tipo if tipo in NOTE_KINDS else "nota"
    async with session_scope() as db:
        note = Note(
            project_id=ctx.project_id,
            title=titulo.strip()[:300],
            body_md=detalle,
            kind=tipo,
            created_by=ctx.user_id,
            created_by_name=f"{ctx.user_name} (vía agente IA)",
            created_by_agent=True,
        )
        db.add(note)
        await db.commit()
        return {"ok": True, "nota_id": note.id}


async def listar_gantt_impl(ctx: AgentContext) -> dict:
    if not ctx.project_id:
        return {"error": "Sin proyecto activo"}
    async with session_scope() as db:
        result = await db.execute(
            select(GanttTask).where(GanttTask.project_id == ctx.project_id).order_by(GanttTask.order_index)
        )
        tasks = result.scalars().all()
    return {
        "tareas": [
            {"titulo": t.title, "fase": t.phase, "inicio": str(t.start_date),
             "fin": str(t.end_date), "avance": t.progress, "estado": t.status}
            for t in tasks
        ]
    }
