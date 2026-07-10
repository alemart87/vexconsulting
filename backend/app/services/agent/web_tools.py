"""Investigación profunda vía Perplexity para el agente del chat.

Reutiliza el mismo cliente del Agent API (/v1/agent) del router de research,
con fallback al /chat/completions clásico.
"""
from __future__ import annotations


def make_perplexity_tool(function_tool):
    @function_tool
    async def investigar_perplexity(consulta: str) -> dict:
        """Investigación profunda en la web con Perplexity: devuelve una respuesta
        documentada CON CITAS a fuentes reales. Usala para datos de mercado,
        estadísticas o hechos externos al proyecto que requieran fuentes
        verificables. Formulá la consulta específica y con contexto."""
        from ...api.v1.agent import _perplexity_research

        answer, citations = await _perplexity_research(consulta)
        return {"respuesta": answer, "citas": citations[:12]}

    return investigar_perplexity
