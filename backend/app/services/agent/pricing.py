"""Costo en USD por mensaje del agente, con precios configurables por env."""
from __future__ import annotations

from ...core.config import settings


def compute_cost_usd(input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> float:
    non_cached = max(0, input_tokens - cached_tokens)
    cost = (
        non_cached / 1_000_000 * settings.agent_price_input_per_mtok
        + cached_tokens / 1_000_000 * settings.agent_price_cached_input_per_mtok
        + output_tokens / 1_000_000 * settings.agent_price_output_per_mtok
    )
    return round(cost, 6)
