"""Async SQLAlchemy engine and session factory."""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings


class Base(DeclarativeBase):
    pass


# Postgres: un UPDATE que espera un row-lock huérfano (conexión que quedó
# «idle in transaction» tras una cancelación) esperaría PARA SIEMPRE con la
# configuración por defecto. Estos límites convierten ese cuelgue infinito en
# un error inmediato y matan a la conexión huérfana que sostenía el lock.
_connect_args: dict = {}
if settings.database_url.startswith("postgresql+asyncpg"):
    _connect_args["server_settings"] = {
        "lock_timeout": "8000",                          # 8 s esperando un lock → error claro
        "idle_in_transaction_session_timeout": "300000", # 5 min idle con tx abierta → Postgres la corta
    }

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=1800,
    connect_args=_connect_args,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        yield session


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        yield session
