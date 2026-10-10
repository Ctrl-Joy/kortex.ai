"""Application settings loaded from environment variables / the repo-root .env file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_HERE = Path(__file__).resolve()
# services/api/app/core/config.py → repo root. When only services/api is deployed
# (e.g. Railway root directory), fall back to the service directory itself.
REPO_ROOT = _HERE.parents[4] if len(_HERE.parents) > 4 else _HERE.parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_prefix="KORTEX_",
        extra="ignore",
    )

    database_url: str = Field(default=f"sqlite:///{(REPO_ROOT / 'data' / 'kortex.db').as_posix()}")
    secret_key: str = "dev-insecure-secret-change-me"
    vision_api_key: str = "dev-vision-key"
    seed_staff_password: str = "kortex-dev-password"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Optional regex for additional origins, e.g. Vercel preview deployments:
    #   https://kortex-ai(-[a-z0-9-]+)?\.vercel\.app
    cors_origin_regex: str | None = None
    token_ttl_minutes: int = 720
    # Interval of the background sweeper that finalises pending vision events.
    sweep_interval_seconds: float = 2.0
    environment: str = "development"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def resolved_database_url(self) -> str:
        """Resolve relative sqlite paths against the repository root."""
        url = self.database_url
        prefix = "sqlite:///"
        if not url.startswith(prefix):
            return url
        path = url[len(prefix) :]
        is_absolute = path.startswith("/") or (len(path) > 1 and path[1] == ":")
        if path == ":memory:" or is_absolute:
            return url
        return prefix + (REPO_ROOT / path).resolve().as_posix()

    @property
    def uses_insecure_defaults(self) -> bool:
        return self.secret_key.startswith("dev-") or self.secret_key.startswith("change-me")


@lru_cache
def get_settings() -> Settings:
    return Settings()
