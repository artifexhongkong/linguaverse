"""LinguaVerse backend configuration.

Reads environment variables from the project-root `.env` file using
``python-dotenv`` and exposes them as a single ``settings`` object so any
backend module can simply do::

    from config import settings
    settings.AGNES_API_KEY
    settings.AGNES_BASE_URL
    settings.AGNES_MODEL
"""

from __future__ import annotations

import os
from pathlib import Path
from dataclasses import dataclass

from dotenv import load_dotenv

# Resolve the project root (backend/ -> ..) and load the shared .env file
# so the same file powers both the Python backend and the Vite frontend.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_PATH = _PROJECT_ROOT / ".env"

load_dotenv(_ENV_PATH, override=False)


@dataclass(frozen=True)
class Settings:
    """Strongly-typed view over the environment variables.

    Defaults are applied at construction time so importing this module
    never crashes the app — callers can check ``is_configured`` to decide
    whether to surface a friendly error to the user.
    """

    AGNES_API_KEY: str
    AGNES_BASE_URL: str
    AGNES_MODEL: str

    @property
    def is_configured(self) -> bool:
        return bool(self.AGNES_API_KEY and self.AGNES_API_KEY.startswith("sk-"))

    @property
    def chat_completions_url(self) -> str:
        base = self.AGNES_BASE_URL.rstrip("/")
        return f"{base}/chat/completions"


def _load_settings() -> Settings:
    return Settings(
        AGNES_API_KEY=os.getenv("AGNES_API_KEY", "").strip(),
        AGNES_BASE_URL=os.getenv("AGNES_BASE_URL", "https://apihub.agnes-ai.com/v1").strip(),
        AGNES_MODEL=os.getenv("AGNES_MODEL", "agnes-2.0-flash").strip(),
    )


# Module-level singleton — import this everywhere.
settings: Settings = _load_settings()


__all__ = ["Settings", "settings"]
