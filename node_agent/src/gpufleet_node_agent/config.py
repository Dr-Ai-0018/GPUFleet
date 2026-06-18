from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from pydantic import Field, PrivateAttr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AgentSettings(BaseSettings):
    control_plane_url: str = "http://127.0.0.1:8000"
    node_id: str = "node-example"
    node_secret: str = ""
    node_secret_encrypted_path: Path | None = None
    node_secret_passphrase: str = ""
    heartbeat_interval_sec: int = Field(default=5, ge=3, le=3600)
    sample_interval_sec: int = Field(
        default=1,
        ge=1,
        le=3600,
        description="高密采样间隔 (秒). 默认 1s/次, 心跳时批量上传.",
    )
    sample_buffer_size: int = Field(
        default=5,
        ge=1,
        le=60,
        description="ring buffer 容量. 推荐 = heartbeat_interval_sec / sample_interval_sec.",
    )
    tls_skip_verify: bool = False
    deployment_mode: Literal["auto", "windows_server", "linux_server", "cloud_gpu_runner"] = "auto"
    circuit_breaker_failure_threshold: int = Field(default=3, ge=1, le=20)
    circuit_breaker_open_sec: int = Field(default=60, ge=1, le=3600)

    agent_root: Path = Field(default=Path("./runtime"))
    repos_dir: Path = Field(default=Path("./runtime/repos"))
    runs_dir: Path = Field(default=Path("./runtime/runs"))
    artifacts_dir: Path = Field(default=Path("./runtime/artifacts"))
    logs_dir: Path = Field(default=Path("./runtime/logs"))
    state_dir: Path = Field(default=Path("./runtime/state"))
    modal_profiles_dir: Path = Field(default=Path("./runtime/modal_profiles"))

    python_executable: str | None = None
    venv_path: str | None = None
    uv_executable: str | None = None
    conda_executable: str | None = None
    micromamba_executable: str | None = None
    modal_credentials_path: Path | None = None
    modal_default_credential_name: str | None = None
    modal_default_environment: str | None = None
    modal_default_workspace: str | None = None

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_prefix="GPUFLEET_AGENT_",
        case_sensitive=False,
        extra="ignore",
    )
    _resolved_node_secret: str | None = PrivateAttr(default=None)

    @model_validator(mode="after")
    def validate_sampling_window(self) -> AgentSettings:
        if self.sample_interval_sec > self.heartbeat_interval_sec:
            raise ValueError("sample_interval_sec must be <= heartbeat_interval_sec")
        return self

    def ensure_dirs(self) -> None:
        for path in (
            self.agent_root,
            self.repos_dir,
            self.runs_dir,
            self.artifacts_dir,
            self.logs_dir,
            self.state_dir,
            self.modal_profiles_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)

    def resolve_agent_path(self, path: Path | None) -> Path | None:
        if path is None:
            return None
        if path.is_absolute():
            return path.resolve(strict=False)
        return (Path.cwd() / path).resolve(strict=False)

    def secret_store_path(self) -> Path:
        candidate = self.node_secret_encrypted_path or (self.state_dir / "node_secret.enc")
        resolved = self.resolve_agent_path(candidate)
        if resolved is None:
            raise ValueError("node_secret_encrypted_path could not be resolved")
        return resolved

    def get_node_secret(self) -> str:
        if self._resolved_node_secret is None:
            from gpufleet_node_agent.security import load_or_seal_node_secret

            self._resolved_node_secret = load_or_seal_node_secret(self)
        return self._resolved_node_secret

    def effective_deployment_mode(self) -> str:
        if self.deployment_mode != "auto":
            return self.deployment_mode
        if self.resolve_agent_path(self.modal_credentials_path) or os.environ.get("MODAL_TOKEN_ID") or os.environ.get("MODAL_TOKEN_SECRET"):
            return "cloud_gpu_runner"
        if os.name == "nt":
            return "windows_server"
        return "linux_server"
