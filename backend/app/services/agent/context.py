"""Contexto compartido de una corrida del agente."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentContext:
    user_id: str
    user_name: str
    project_id: str | None = None
    agent_type: str = "acompanante"  # acompanante | evaluador | visualizador | investigacion
    published_version_id: str | None = None  # restricción del visualizador
    canvas: list[dict[str, Any]] = field(default_factory=list)
    proposals: list[dict[str, Any]] = field(default_factory=list)
    tool_trace: list[dict[str, Any]] = field(default_factory=list)
