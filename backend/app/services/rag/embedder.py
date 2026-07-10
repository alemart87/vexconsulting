"""Embeddings con OpenAI (text-embedding-3-small), en lotes con reintentos.

Sin OPENAI_API_KEY los chunks se guardan sin embedding y la búsqueda
degrada a texto — el sistema sigue siendo usable.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from ...core.config import settings

logger = logging.getLogger("vexconsulting")

BATCH_SIZE = 100
_client = None


def _get_client():
    global _client
    if _client is None:
        from openai import AsyncOpenAI

        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


async def embed_texts(texts: list[str]) -> tuple[Optional[list[list[float]]], float]:
    """Devuelve (embeddings | None, costo_usd)."""
    if not settings.openai_api_key or not texts:
        return None, 0.0

    client = _get_client()
    vectors: list[list[float]] = []
    total_tokens = 0

    for start in range(0, len(texts), BATCH_SIZE):
        batch = [t[:30000] for t in texts[start : start + BATCH_SIZE]]
        for attempt in range(3):
            try:
                resp = await client.embeddings.create(
                    model=settings.embedding_model,
                    input=batch,
                    dimensions=settings.embedding_dimensions,
                )
                vectors.extend(item.embedding for item in resp.data)
                total_tokens += getattr(resp.usage, "total_tokens", 0) or 0
                break
            except Exception as exc:
                if attempt == 2:
                    raise
                wait = 2 ** (attempt + 1)
                logger.warning("Embeddings reintento en %ss: %s", wait, exc)
                await asyncio.sleep(wait)

    cost = total_tokens / 1_000_000 * settings.embedding_price_per_mtok
    return vectors, round(cost, 6)
