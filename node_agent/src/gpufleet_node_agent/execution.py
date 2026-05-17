from __future__ import annotations

import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from gpufleet_node_agent.config import AgentSettings


SUPPORTED_EXECUTION_BACKENDS = {
    "default",
    "system_python",
    "venv_path",
    "uv_project",
    "conda_name",
    "conda_prefix",
    "micromamba_prefix",
}


@dataclass(slots=True)
class ExecutionSpec:
    backend: str = "default"
    target: str | None = None
    python: str | None = None


@dataclass(slots=True)
class PreparedCommand:
    command: list[str]
    env_overrides: dict[str, str]
    summary: dict[str, Any]


def _resolve_executable(candidate: str | None, fallback_name: str | None = None) -> str | None:
    if candidate:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
        path = Path(candidate)
        if path.exists():
            return str(path.resolve(strict=False))
    if fallback_name:
        resolved = shutil.which(fallback_name)
        if resolved:
            return resolved
    return None


def resolve_default_python(settings: AgentSettings) -> str:
    configured = settings.python_executable
    if configured:
        resolved = _resolve_executable(configured)
        if not resolved:
            raise ValueError(f"configured python executable not found: {configured}")
        return resolved
    return sys.executable


def resolve_uv_executable(settings: AgentSettings) -> str | None:
    return _resolve_executable(settings.uv_executable, "uv")


def resolve_conda_executable(settings: AgentSettings) -> str | None:
    return _resolve_executable(settings.conda_executable, "conda")


def resolve_micromamba_executable(settings: AgentSettings) -> str | None:
    return _resolve_executable(settings.micromamba_executable, "micromamba")


def parse_execution_spec(payload: dict[str, Any]) -> ExecutionSpec:
    raw = payload.get("execution")
    if raw is None:
        return ExecutionSpec()
    if not isinstance(raw, dict):
        raise ValueError("payload.execution must be an object")

    backend = str(raw.get("backend", "default")).strip() or "default"
    if backend not in SUPPORTED_EXECUTION_BACKENDS:
        raise ValueError(
            "payload.execution.backend must be one of: "
            + ", ".join(sorted(SUPPORTED_EXECUTION_BACKENDS))
        )
    target = raw.get("target")
    python = raw.get("python")
    return ExecutionSpec(
        backend=backend,
        target=str(target).strip() if target not in {None, ""} else None,
        python=str(python).strip() if python not in {None, ""} else None,
    )


def _resolve_path_target(raw_target: str, base_dir: Path) -> Path:
    target_path = Path(raw_target)
    if not target_path.is_absolute():
        target_path = base_dir / target_path
    return target_path.resolve(strict=False)


def _resolve_venv_python(raw_target: str, base_dir: Path) -> Path:
    target_path = _resolve_path_target(raw_target, base_dir)
    if target_path.is_file():
        return target_path
    candidate = target_path / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if candidate.exists():
        return candidate.resolve(strict=False)
    raise ValueError(f"venv interpreter not found under: {target_path}")


def _shell_wrapper(command_text: str) -> list[str]:
    if os.name == "nt":
        shell_exe = shutil.which("pwsh") or shutil.which("powershell") or "powershell"
        return [shell_exe, "-NoProfile", "-Command", command_text]
    return ["/bin/bash", "-lc", command_text]


def _build_venv_env(venv_python: Path) -> dict[str, str]:
    venv_root = venv_python.parent.parent
    bin_dir = venv_python.parent
    path_parts = [str(bin_dir), os.environ.get("PATH", "")]
    return {
        "VIRTUAL_ENV": str(venv_root),
        "PATH": os.pathsep.join(part for part in path_parts if part),
    }


def _conda_run_prefix(executable: str, workdir: Path, *, flag: str, target: str) -> list[str]:
    return [executable, "run", "--cwd", str(workdir), flag, target]


def detect_python_env(settings: AgentSettings) -> dict[str, Any]:
    python_resolution_error: str | None = None
    try:
        default_python = resolve_default_python(settings)
    except ValueError as exc:
        default_python = settings.python_executable or sys.executable
        python_resolution_error = str(exc)
    detected_venv = settings.venv_path
    active_kind = "system"
    active_name: str | None = None

    if not detected_venv and sys.prefix != getattr(sys, "base_prefix", sys.prefix):
        detected_venv = sys.prefix
    if detected_venv:
        active_kind = "venv"
        active_name = Path(detected_venv).name

    conda_prefix = os.environ.get("CONDA_PREFIX")
    conda_default_env = os.environ.get("CONDA_DEFAULT_ENV")
    mamba_root_prefix = os.environ.get("MAMBA_ROOT_PREFIX")
    if mamba_root_prefix and os.environ.get("CONDA_PREFIX"):
        active_kind = "micromamba"
        active_name = conda_default_env or Path(os.environ["CONDA_PREFIX"]).name
    elif conda_prefix:
        active_kind = "conda"
        active_name = conda_default_env or Path(conda_prefix).name

    uv_executable = resolve_uv_executable(settings)
    conda_executable = resolve_conda_executable(settings)
    micromamba_executable = resolve_micromamba_executable(settings)

    supported_backends = ["default", "system_python", "venv_path"]
    if uv_executable:
        supported_backends.append("uv_project")
    if conda_executable:
        supported_backends.extend(["conda_name", "conda_prefix"])
    if micromamba_executable:
        supported_backends.append("micromamba_prefix")

    return {
        "python_executable": default_python,
        "venv_path": detected_venv,
        "python_version": ".".join(str(part) for part in sys.version_info[:3]),
        "python_resolution_error": python_resolution_error,
        "active_environment_kind": active_kind,
        "active_environment_name": active_name,
        "conda_prefix": conda_prefix,
        "conda_default_env": conda_default_env,
        "mamba_root_prefix": mamba_root_prefix,
        "uv_available": bool(uv_executable),
        "uv_executable": uv_executable,
        "conda_available": bool(conda_executable),
        "conda_executable": conda_executable,
        "micromamba_available": bool(micromamba_executable),
        "micromamba_executable": micromamba_executable,
        "supported_backends": supported_backends,
    }


def prepare_python_command(
    settings: AgentSettings,
    payload: dict[str, Any],
    argv: list[str],
    *,
    workdir: Path,
) -> PreparedCommand:
    spec = parse_execution_spec(payload)
    env_overrides: dict[str, str] = {}
    summary: dict[str, Any] = {
        "backend": spec.backend,
        "target": spec.target,
        "python": spec.python,
    }

    if spec.backend in {"default", "system_python"}:
        interpreter = spec.python or resolve_default_python(settings)
        resolved = _resolve_executable(interpreter)
        if not resolved:
            raise ValueError(f"python executable not found: {interpreter}")
        summary["resolved_python"] = resolved
        return PreparedCommand([resolved, *argv], env_overrides, summary)

    if spec.backend == "venv_path":
        target = spec.target or settings.venv_path
        if not target:
            raise ValueError("venv_path backend requires payload.execution.target or GPUFLEET_AGENT_VENV_PATH")
        venv_python = _resolve_venv_python(target, workdir)
        env_overrides.update(_build_venv_env(venv_python))
        summary["resolved_python"] = str(venv_python)
        summary["resolved_venv"] = env_overrides["VIRTUAL_ENV"]
        return PreparedCommand([str(venv_python), *argv], env_overrides, summary)

    if spec.backend == "uv_project":
        uv_executable = resolve_uv_executable(settings)
        if not uv_executable:
            raise ValueError("uv executable not found on this node")
        project_dir = _resolve_path_target(spec.target or str(workdir), workdir)
        summary["resolved_project"] = str(project_dir)
        return PreparedCommand(
            [uv_executable, "run", "--project", str(project_dir), *(spec.python and [spec.python] or ["python"]), *argv],
            env_overrides,
            summary,
        )

    if spec.backend == "conda_name":
        conda_executable = resolve_conda_executable(settings)
        if not conda_executable:
            raise ValueError("conda executable not found on this node")
        if not spec.target:
            raise ValueError("conda_name backend requires payload.execution.target")
        python_name = spec.python or "python"
        summary["resolved_conda"] = conda_executable
        return PreparedCommand(
            _conda_run_prefix(conda_executable, workdir, flag="-n", target=spec.target) + [python_name, *argv],
            env_overrides,
            summary,
        )

    if spec.backend == "conda_prefix":
        conda_executable = resolve_conda_executable(settings)
        if not conda_executable:
            raise ValueError("conda executable not found on this node")
        if not spec.target:
            raise ValueError("conda_prefix backend requires payload.execution.target")
        prefix = str(_resolve_path_target(spec.target, workdir))
        python_name = spec.python or "python"
        summary["resolved_conda"] = conda_executable
        summary["resolved_prefix"] = prefix
        return PreparedCommand(
            _conda_run_prefix(conda_executable, workdir, flag="-p", target=prefix) + [python_name, *argv],
            env_overrides,
            summary,
        )

    if spec.backend == "micromamba_prefix":
        micromamba_executable = resolve_micromamba_executable(settings)
        if not micromamba_executable:
            raise ValueError("micromamba executable not found on this node")
        if not spec.target:
            raise ValueError("micromamba_prefix backend requires payload.execution.target")
        prefix = str(_resolve_path_target(spec.target, workdir))
        python_name = spec.python or "python"
        summary["resolved_micromamba"] = micromamba_executable
        summary["resolved_prefix"] = prefix
        return PreparedCommand(
            [micromamba_executable, "run", "-p", prefix, python_name, *argv],
            env_overrides,
            summary,
        )

    raise ValueError(f"Unsupported execution backend: {spec.backend}")


def prepare_shell_command(
    settings: AgentSettings,
    payload: dict[str, Any],
    command_text: str,
    *,
    workdir: Path,
) -> PreparedCommand:
    spec = parse_execution_spec(payload)
    env_overrides: dict[str, str] = {}
    summary: dict[str, Any] = {
        "backend": spec.backend,
        "target": spec.target,
        "python": spec.python,
    }
    wrapped_shell = _shell_wrapper(command_text)

    if spec.backend in {"default", "system_python"}:
        return PreparedCommand(wrapped_shell, env_overrides, summary)

    if spec.backend == "venv_path":
        target = spec.target or settings.venv_path
        if not target:
            raise ValueError("venv_path backend requires payload.execution.target or GPUFLEET_AGENT_VENV_PATH")
        venv_python = _resolve_venv_python(target, workdir)
        env_overrides.update(_build_venv_env(venv_python))
        summary["resolved_venv"] = env_overrides["VIRTUAL_ENV"]
        return PreparedCommand(wrapped_shell, env_overrides, summary)

    if spec.backend == "uv_project":
        uv_executable = resolve_uv_executable(settings)
        if not uv_executable:
            raise ValueError("uv executable not found on this node")
        project_dir = _resolve_path_target(spec.target or str(workdir), workdir)
        summary["resolved_project"] = str(project_dir)
        return PreparedCommand(
            [uv_executable, "run", "--project", str(project_dir), *wrapped_shell],
            env_overrides,
            summary,
        )

    if spec.backend == "conda_name":
        conda_executable = resolve_conda_executable(settings)
        if not conda_executable:
            raise ValueError("conda executable not found on this node")
        if not spec.target:
            raise ValueError("conda_name backend requires payload.execution.target")
        summary["resolved_conda"] = conda_executable
        return PreparedCommand(
            _conda_run_prefix(conda_executable, workdir, flag="-n", target=spec.target) + wrapped_shell,
            env_overrides,
            summary,
        )

    if spec.backend == "conda_prefix":
        conda_executable = resolve_conda_executable(settings)
        if not conda_executable:
            raise ValueError("conda executable not found on this node")
        if not spec.target:
            raise ValueError("conda_prefix backend requires payload.execution.target")
        prefix = str(_resolve_path_target(spec.target, workdir))
        summary["resolved_conda"] = conda_executable
        summary["resolved_prefix"] = prefix
        return PreparedCommand(
            _conda_run_prefix(conda_executable, workdir, flag="-p", target=prefix) + wrapped_shell,
            env_overrides,
            summary,
        )

    if spec.backend == "micromamba_prefix":
        micromamba_executable = resolve_micromamba_executable(settings)
        if not micromamba_executable:
            raise ValueError("micromamba executable not found on this node")
        if not spec.target:
            raise ValueError("micromamba_prefix backend requires payload.execution.target")
        prefix = str(_resolve_path_target(spec.target, workdir))
        summary["resolved_micromamba"] = micromamba_executable
        summary["resolved_prefix"] = prefix
        return PreparedCommand(
            [micromamba_executable, "run", "-p", prefix, *wrapped_shell],
            env_overrides,
            summary,
        )

    raise ValueError(f"Unsupported execution backend: {spec.backend}")
