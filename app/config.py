from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "GPUFleet Control Plane"
    environment: str = "development"
    debug: bool = True

    database_path: Path = Field(default=Path("data/gpufleet.db"))
    storage_path: Path = Field(default=Path("data/storage"))

    jwt_secret: str = "change-this-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_minutes: int = 60 * 24 * 7

    default_admin_username: str = "admin"
    default_admin_password: str = "admin123456"

    node_allowed_clock_skew_sec: int = 300
    nonce_ttl_sec: int = 600
    max_status_history_per_node: int = 200

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="GPUFLEET_",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    return settings
