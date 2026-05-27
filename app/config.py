from functools import lru_cache
from pathlib import Path
import sys

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


_SENTINEL = "__NOT_SET__"


class Settings(BaseSettings):
    app_name: str = "GPUFleet Control Plane"
    environment: str = "development"
    debug: bool = True

    database_path: Path = Field(default=Path("data/gpufleet.db"))
    storage_path: Path = Field(default=Path("data/storage"))

    jwt_secret: str = _SENTINEL
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_minutes: int = 60 * 24 * 7
    node_key_encryption_secret: str = ""

    default_admin_username: str = "admin"
    default_admin_password: str = _SENTINEL

    node_allowed_clock_skew_sec: int = 300
    nonce_ttl_sec: int = 120
    max_status_history_per_node: int = 200
    max_artifact_bytes: int = 500 * 1024 * 1024  # 500 MB
    sqlite_busy_timeout_ms: int = 5000
    snapshot_retention_days: int = 7
    task_log_retention_days: int = 30
    artifact_retention_days: int = 30
    task_log_stream_max_bytes: int = 100 * 1024 * 1024
    storage_quota_bytes: int = 5 * 1024 * 1024 * 1024
    review_llm_base_url: str = "https://api.openai.com/v1"
    review_llm_api_key: str = ""
    review_llm_model: str = "gpt-5.4"
    review_llm_timeout_sec: int = 30
    review_llm_max_tokens: int = 1024
    review_llm_temperature: float = 0.1
    cors_allowed_origins: list[str] = Field(
        default_factory=lambda: [
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:4173",
            "http://localhost:4173",
        ]
    )
    frontend_dist_path: Path = Field(default=Path("frontend/dist"))

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="GPUFLEET_",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()

    missing = []
    if settings.jwt_secret == _SENTINEL:
        missing.append("GPUFLEET_JWT_SECRET")
    if settings.default_admin_password == _SENTINEL:
        missing.append("GPUFLEET_DEFAULT_ADMIN_PASSWORD")
    if missing:
        print(
            f"[FATAL] Required environment variables not set: {', '.join(missing)}. "
            f"Set them in .env or as environment variables.",
            file=sys.stderr,
        )
        sys.exit(1)

    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    return settings
