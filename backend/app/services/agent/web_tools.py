"""Investigación profunda: tool de Perplexity (la búsqueda web nativa de OpenAI
se agrega vía WebSearchTool del SDK en core.build_agent)."""
from __future__ import annotations

import httpx

from ...core.config import settings


def make_perplexity_tool(function_tool):
    @function_tool
    async def investigar_perplexity(consulta: str) -> dict:
        """Investigación profunda en la web con Perplexity (modelo sonar): devuelve
        una respuesta documentada CON CITAS a fuentes reales. Usala para datos de
        mercado, estadísticas o hechos externos al proyecto que requieran fuentes
        verificables. Formulá la consulta específica y con contexto."""
        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(
                "https://api.perplexity.ai/chat/completions",
                headers={"Authorization": f"Bearer {settings.perplexity_api_key}"},
                json={
                    "model": settings.perplexity_model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "Respondé en español con datos verificables y citá las fuentes.",
                        },
                        {"role": "user", "content": consulta},
                    ],
                },
            )
            resp.raise_for_status()
            data = resp.json()
        answer = data["choices"][0]["message"]["content"]
        citations = data.get("citations") or data.get("search_results") or []
        return {"respuesta": answer, "citas": citations}

    return investigar_perplexity
