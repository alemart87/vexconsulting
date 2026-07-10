"""Centralized logger setup."""
import logging
from .config import settings


def configure_logging() -> None:
    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s [%(levelname)s] %(name)s :: %(message)s",
    )


logger = logging.getLogger("vexconsulting")
