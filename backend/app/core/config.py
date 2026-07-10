"""Configuración de VEX Consulting cargada desde el entorno."""
from __future__ import annotations

from pathlib import Path
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "development"
    secret_key: str = "change-me"

    database_url: str = "sqlite+aiosqlite:///./vex_local.db"

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, v: str) -> str:
        """Render entrega `postgresql://`; SQLAlchemy async requiere `postgresql+asyncpg://`."""
        if v.startswith("postgres://"):
            v = v.replace("postgres://", "postgresql://", 1)
        if v.startswith("postgresql://"):
            v = v.replace("postgresql://", "postgresql+asyncpg://", 1)
        if "?sslmode=" in v and "+asyncpg" in v:
            v = v.split("?sslmode=")[0]
        return v

    # --- Superadmin: SOLO existe en .env, nunca en la base de datos ---
    superadmin_email: str = "admin@vexconsulting.com.py"
    superadmin_password: str = ""            # opción simple: password en plano
    superadmin_password_hash: str = ""       # opción avanzada: hash bcrypt
    superadmin_name: str = "Administrador VEX"

    jwt_algorithm: str = "HS256"
    jwt_access_expire_minutes: int = 60
    jwt_refresh_expire_days: int = 7

    upload_dir: str = "./uploads"
    export_dir: str = "./exports"
    max_upload_size_mb: int = 40
    upload_proc_timeout_s: int = 300
    upload_max_rows: int = 200000
    max_chunks_per_source: int = 2000

    log_level: str = "INFO"
    audit_retention_days: int = 730

    cors_origins: str = "http://localhost:3000,http://localhost:8080"

    # --- Agentes (OpenAI Agents SDK) ---
    openai_api_key: str = ""
    agent_model: str = "gpt-5.4"
    agent_reasoning_effort: str = "medium"
    agent_reasoning_summary: str = "auto"
    agent_max_history: int = 30
    agent_max_tool_turns: int = 30

    # Precios (USD por 1M tokens); defaults de gpt-5.4
    agent_price_input_per_mtok: float = 2.50
    agent_price_cached_input_per_mtok: float = 0.25
    agent_price_output_per_mtok: float = 15.00

    # Embeddings
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    embedding_price_per_mtok: float = 0.02

    # Investigación profunda (Perplexity Agent API, multi-proveedor)
    perplexity_api_key: str = ""
    # Nota: el Agent API habilita modelos según el nivel de uso de la cuenta;
    # "perplexity/sonar" está disponible desde el nivel inicial, "sonar-pro"
    # requiere nivel superior. También acepta openai/*, anthropic/*, etc.
    perplexity_model: str = "perplexity/sonar"
    perplexity_agent_url: str = "https://api.perplexity.ai/v1/agent"

    # OCR opcional para PDFs escaneados
    ocr_enabled: bool = False

    @property
    def agent_enabled(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def perplexity_enabled(self) -> bool:
        return bool(self.perplexity_api_key)

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def upload_path(self) -> Path:
        path = Path(self.upload_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def export_path(self) -> Path:
        path = Path(self.export_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path


settings = Settings()
