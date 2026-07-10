"""Motor de los agentes VEX (OpenAI Agents SDK, import perezoso).

Mismo patrón que el proyecto de referencia: el agente no lleva datos en el
prompt; usa tools acotadas al proyecto y streamea eventos SSE
(token/reasoning/tool/canvas/proposal/done).
"""
from __future__ import annotations

from typing import Any, AsyncIterator, Optional

from ...core.config import settings
from .context import AgentContext
from .roles import build_instructions
from .tools_impl import (
    buscar_fuentes_impl,
    crear_nota_impl,
    leer_documento_impl,
    listar_gantt_impl,
    listar_notas_impl,
)

RunContextWrapper = None  # type: ignore  # inyectado en _build_agent


class AgentNotConfigured(RuntimeError):
    """SDK no instalado o falta OPENAI_API_KEY."""


def build_agent(
    *,
    instructions: str,
    include_write_tools: bool = True,
    include_web_tools: bool = False,
    name: str = "Agente VEX",
):
    """Construye un Agent con las tools del proyecto. Import perezoso del SDK."""
    try:
        from agents import Agent, function_tool, set_default_openai_key
        from agents import RunContextWrapper as _RCW
    except ImportError as exc:
        raise AgentNotConfigured("El SDK 'openai-agents' no está instalado en el servidor.") from exc

    globals()["RunContextWrapper"] = _RCW

    if not settings.openai_api_key:
        raise AgentNotConfigured("Falta OPENAI_API_KEY en la configuración del servidor.")
    set_default_openai_key(settings.openai_api_key)

    @function_tool
    async def buscar_fuentes(ctx: RunContextWrapper[AgentContext], consulta: str, cantidad: int = 8) -> dict:
        """Busca en las fuentes de investigación del proyecto (RAG híbrido sobre los
        documentos subidos: PDF, Excel, Word, links). Devuelve fragmentos con su cita
        [fuente, página/hoja/sección]. Usala SIEMPRE antes de afirmar datos del proyecto."""
        return await buscar_fuentes_impl(ctx.context, consulta, cantidad)

    @function_tool
    async def leer_documento_maestro(ctx: RunContextWrapper[AgentContext]) -> dict:
        """Devuelve el contenido actual del documento maestro del proyecto (Markdown)."""
        return await leer_documento_impl(ctx.context)

    @function_tool
    async def listar_notas(ctx: RunContextWrapper[AgentContext]) -> dict:
        """Lista las notas del proyecto (hipótesis, hallazgos, tareas, notas) con su estado."""
        return await listar_notas_impl(ctx.context)

    @function_tool
    async def listar_gantt(ctx: RunContextWrapper[AgentContext]) -> dict:
        """Lista las tareas del cronograma (Gantt) del proyecto con fechas, avance y estado."""
        return await listar_gantt_impl(ctx.context)

    @function_tool
    async def crear_nota(
        ctx: RunContextWrapper[AgentContext], titulo: str, detalle: str, tipo: str = "hallazgo"
    ) -> dict:
        """Registra una nota en el proyecto. `tipo`: 'nota' | 'hipotesis' | 'hallazgo' | 'tarea'.
        Usala cuando detectes un hallazgo o pendiente que valga la pena registrar."""
        return await crear_nota_impl(ctx.context, titulo, detalle, tipo)

    @function_tool
    async def proponer_texto(
        ctx: RunContextWrapper[AgentContext], titulo: str, texto_md: str
    ) -> dict:
        """Propone un bloque de texto en Markdown listo para insertar en el documento
        maestro. El consultor lo ve como tarjeta con botón «Insertar» — NO lo repitas
        completo en tu respuesta de chat; resumí qué propusiste."""
        proposal = {
            "id": f"prop{len(ctx.context.proposals) + 1}",
            "titulo": titulo,
            "texto_md": texto_md,
        }
        ctx.context.proposals.append(proposal)
        return {"ok": True, "proposal_id": proposal["id"]}

    @function_tool(strict_mode=False)
    async def emit_canvas(
        ctx: RunContextWrapper[AgentContext], tipo: str, titulo: str, datos: dict,
        descripcion: Optional[str] = None,
    ) -> dict:
        """Dibuja un artefacto en el panel derecho. `tipo`: 'bar' | 'line' | 'donut' |
        'table' | 'kpis' | 'markdown'. `datos` según tipo: bar/donut/line:
        {"items":[{"label":..,"valor":..}]}; table: {"columnas":[..],"filas":[[..]]};
        kpis: {"kpis":[{"label":..,"valor":..,"hint":..}]}; markdown: {"texto":..}."""
        artifact = {
            "id": f"art{len(ctx.context.canvas) + 1}",
            "tipo": tipo, "titulo": titulo, "descripcion": descripcion, "datos": datos,
        }
        ctx.context.canvas.append(artifact)
        return {"ok": True, "artifact_id": artifact["id"]}

    tools: list[Any] = [buscar_fuentes, leer_documento_maestro, listar_notas, listar_gantt]
    if include_write_tools:
        tools += [crear_nota, proponer_texto, emit_canvas]

    if include_web_tools:
        try:
            from agents import WebSearchTool

            tools.append(WebSearchTool())
        except Exception:
            pass
        if settings.perplexity_enabled:
            from .web_tools import make_perplexity_tool

            tools.append(make_perplexity_tool(function_tool))

    model_settings = None
    try:
        from agents import ModelSettings

        try:
            from openai.types.shared import Reasoning

            rkwargs: dict[str, Any] = {"effort": settings.agent_reasoning_effort}
            if settings.agent_reasoning_summary:
                rkwargs["summary"] = settings.agent_reasoning_summary
            model_settings = ModelSettings(reasoning=Reasoning(**rkwargs))
        except Exception:
            model_settings = ModelSettings()
    except Exception:
        model_settings = None

    kwargs: dict[str, Any] = dict(
        name=name, instructions=instructions, model=settings.agent_model, tools=tools,
    )
    if model_settings is not None:
        kwargs["model_settings"] = model_settings
    return Agent(**kwargs)


def build_companion_agent(project, role_slug: str | None = None):
    """Agente acompañante del proyecto, con rol seleccionable y web search."""
    instructions = build_instructions(
        role_slug or project.agent_role_slug or "consultor_bpo",
        project.name,
        project.agent_instructions_override,
    )
    return build_agent(
        instructions=instructions,
        include_write_tools=True,
        include_web_tools=True,
        name="Agente acompañante VEX",
    )


def build_viewer_agent(project):
    """Agente del visualizador: solo lectura del documento PUBLICADO y las fuentes."""
    instructions = f"""Sos el asistente de lectura del informe «{project.name}» de VEX \
Consulting. Ayudás al lector a entender el documento publicado: explicás secciones, \
resumís, ubicás datos y sus fuentes. SOLO hablás de este documento y sus fuentes \
(tools `leer_documento_maestro` y `buscar_fuentes`); si te preguntan otra cosa, \
respondé amablemente que tu alcance es este informe. No inventás datos y citás la \
fuente de cada cifra. Respondés en español."""
    return build_agent(
        instructions=instructions,
        include_write_tools=False,
        include_web_tools=False,
        name="Asistente de lectura VEX",
    )


async def stream_agent(
    messages: list[dict], context: AgentContext, agent
) -> AsyncIterator[dict]:
    """Corre el agente en streaming. Eventos: token, reasoning, tool, canvas,
    proposal, done, error (formato del proyecto de referencia + proposal)."""
    try:
        from agents import Runner
    except ImportError as exc:
        raise AgentNotConfigured("El SDK 'openai-agents' no está instalado.") from exc

    result = Runner.run_streamed(
        agent, input=messages, context=context, max_turns=settings.agent_max_tool_turns,
    )

    emitted_canvas = 0
    emitted_proposals = 0
    full_text: list[str] = []
    full_reasoning: list[str] = []

    def _drain() -> list[dict]:
        nonlocal emitted_canvas, emitted_proposals
        events: list[dict] = []
        while emitted_canvas < len(context.canvas):
            events.append({"type": "canvas", "artifact": context.canvas[emitted_canvas]})
            emitted_canvas += 1
        while emitted_proposals < len(context.proposals):
            events.append({"type": "proposal", "proposal": context.proposals[emitted_proposals]})
            emitted_proposals += 1
        return events

    async for event in result.stream_events():
        etype = getattr(event, "type", "")
        if etype == "raw_response_event":
            data = getattr(event, "data", None)
            dtype = getattr(data, "type", "") or ""
            if dtype == "response.output_text.delta":
                delta = getattr(data, "delta", "") or ""
                if delta:
                    full_text.append(delta)
                    yield {"type": "token", "text": delta}
            elif dtype == "response.reasoning_summary_text.delta":
                delta = getattr(data, "delta", "") or ""
                if delta:
                    full_reasoning.append(delta)
                    yield {"type": "reasoning", "text": delta}
            elif dtype == "response.reasoning_summary_part.added" and full_reasoning:
                full_reasoning.append("\n\n")
                yield {"type": "reasoning", "text": "\n\n"}
        elif etype == "run_item_stream_event":
            item = getattr(event, "item", None)
            if getattr(item, "type", "") == "tool_call_item":
                raw = getattr(item, "raw_item", None)
                name = getattr(raw, "name", None) or "tool"
                context.tool_trace.append({"tool": name})
                yield {"type": "tool", "name": name}
            for ev in _drain():
                yield ev

    for ev in _drain():
        yield ev

    usage_out = {"input_tokens": 0, "cached_tokens": 0, "output_tokens": 0,
                 "reasoning_tokens": 0, "total_tokens": 0}
    try:
        usage = getattr(getattr(result, "context_wrapper", None), "usage", None)
        if usage:
            usage_out["input_tokens"] = int(getattr(usage, "input_tokens", 0) or 0)
            usage_out["output_tokens"] = int(getattr(usage, "output_tokens", 0) or 0)
            usage_out["total_tokens"] = int(getattr(usage, "total_tokens", 0) or 0)
            itd = getattr(usage, "input_tokens_details", None)
            if itd is not None:
                usage_out["cached_tokens"] = int(getattr(itd, "cached_tokens", 0) or 0)
            otd = getattr(usage, "output_tokens_details", None)
            if otd is not None:
                usage_out["reasoning_tokens"] = int(getattr(otd, "reasoning_tokens", 0) or 0)
    except Exception:
        pass

    content = "".join(full_text) or (getattr(result, "final_output", "") or "")
    yield {
        "type": "done",
        "content": content,
        "reasoning": "".join(full_reasoning),
        "proposals": context.proposals,
        "tool_trace": context.tool_trace,
        "usage": usage_out,
    }
