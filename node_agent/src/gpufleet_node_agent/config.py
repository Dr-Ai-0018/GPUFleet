from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AgentSettings(BaseSettings):
    control_plane_url: str = "http://127.0.0.1:8000"
    node_id: str = "node-example"
    node_secret: str = "replace-me"
    heartbeat_interval_sec: int = Field(default=5, ge=3, le=3600)

    agent_root: Path = Field(default=Path("./runtime"))
    repos_dir: Path = Field(default=Path("./runtime/repos"))
    runs_dir: Path = Field(default=Path("./runtime/runs"))
    artifacts_dir: Path = Field(default=Path("./runtime/artifacts"))
    logs_dir: Path = Field(default=Path("./runtime/logs"))
    state_dir: Path = Field(default=Path("./runtime/state"))

    python_executable: str | None = None
    venv_path: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="GPUFLEET_AGENT_",
        case_sensitive=False,
        extra="ignore",
    )

    def ensure_dirs(self) -> None:
        for path in (
            self.agent_root,
            self.repos_dir,
            self.runs_dir,
            self.artifacts_dir,
            self.logs_dir,
            self.state_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)
