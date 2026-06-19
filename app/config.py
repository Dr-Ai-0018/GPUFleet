from functools import lru_cache
from pathlib import Path
from typing import Literal
import sys

from pydantic import Field, SecretStr
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
    metrics_token: SecretStr | None = Field(
        default=None,
        description="Bearer token 保护 /metrics 端点. 空则只允许 localhost (127.0.0.1 / ::1) 抓取.",
    )
    public_base_url: str = Field(
        default="",
        description="对外可见的控制面 URL (节点 agent 用来连服务端). onboarding 模板里的 GPUFLEET_AGENT_CONTROL_PLANE_URL 优先用这个值; 空时回退到 request.base_url (但通过 vite 代理 / 反代时 base_url 会算成前端地址, 节点端连不通). 生产 / 跨主机 dev 必须显式配置.",
    )
    log_format: Literal["json", "console"] = Field(
        default="console",
        description="日志输出格式. 生产建议 json (一行一 JSON, 给 fluent-bit/promtail/loki 抓), 开发 console (彩色可读).",
    )
    instance_name: str = Field(
        default="gpufleet-dev",
        description="本控制面实例的人类可读名称. 写入 webhook payload.control_plane, 接收方区分多实例时用.",
    )
    webhook_url: str = Field(
        default="",
        description="Webhook 接收方 URL. 空则全局禁用 webhook (默认). 强烈建议 https://, http:// 启动时 warning.",
    )
    webhook_secret: str = Field(
        default="",
        description="HMAC-SHA256 签名密钥. 非空时请求带 X-Signature: sha256=<hex> header.",
    )
    webhook_events: list[str] = Field(
        default_factory=lambda: ["task.failed", "task.lost", "storage.quota_exceeded"],
        description="启用的 webhook 事件白名单. 不在此列的事件不发送. 默认仅 critical 信号, 其余按需开.",
    )
    webhook_timeout_sec: int = Field(
        default=5,
        ge=1,
        le=60,
        description="单次 HTTP POST 超时. 失败后指数退避 3 次 (1s/2s/4s) 仍失败则丢弃.",
    )
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
