"""Arranque de los workers de fondo (llamado desde el lifespan)."""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger("vexconsulting")


async def start_workers() -> list[asyncio.Task]:
    tasks: list[asyncio.Task] = []

    from .source_worker import recover_stale, source_worker

    await recover_stale()
    tasks.append(asyncio.create_task(source_worker(), name="source_worker"))

    try:
        from .export_worker import export_worker, recover_stale_exports

        await recover_stale_exports()
        tasks.append(asyncio.create_task(export_worker(), name="export_worker"))
    except ImportError:
        pass

    try:
        from .evaluation_worker import evaluation_worker, recover_stale_evaluations

        await recover_stale_evaluations()
        tasks.append(asyncio.create_task(evaluation_worker(), name="evaluation_worker"))
    except ImportError:
        pass

    try:
        from .auto_worker import auto_worker, recover_stale_auto

        await recover_stale_auto()
        tasks.append(asyncio.create_task(auto_worker(), name="auto_worker"))
    except ImportError:
        pass

    logger.info("%d workers de fondo iniciados", len(tasks))
    return tasks
