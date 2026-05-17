import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../../api";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import { useToast } from "../../ui/Toast";
import { Button } from "../../ui/Button";
import forms from "../../ui/forms.module.css";
import type { NodeResponse } from "../../types";
import {
  allowedTaskTypes,
  buildPayload,
  defaultPayloadText,
  payloadShape,
  supportsExecutionOverrides,
  taskTypeMeta,
} from "./taskTypes";

type Props = {
  node: NodeResponse;
};

export function TaskComposer({ node }: Props): JSX.Element {
  const store = useConsoleStore();
  const toast = useToast();
  const types = useMemo(() => allowedTaskTypes(node.node_type), [node.node_type]);
  const [taskType, setTaskType] = useState<string>(() => types[0] ?? "shell");
  const [taskId, setTaskId] = useState("");
  const [revision, setRevision] = useState(1);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [workdir, setWorkdir] = useState<string>(node.allowed_workdirs[0] ?? "");
  const [requestedGpuIds, setRequestedGpuIds] = useState("");
  const [timeoutSec, setTimeoutSec] = useState<number>(3600);
  const [killGraceSec, setKillGraceSec] = useState<number>(15);
  const [dangerLevel, setDangerLevel] = useState("normal");
  const [executionBackend, setExecutionBackend] = useState("default");
  const [executionTarget, setExecutionTarget] = useState("");
  const [executionPython, setExecutionPython] = useState("");
  const [payloadText, setPayloadText] = useState<string>(() => defaultPayloadText(types[0] ?? "shell"));
  const [envText, setEnvText] = useState<string>("{}");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!types.includes(taskType)) {
      const next = types[0] ?? "shell";
      setTaskType(next);
      setPayloadText(defaultPayloadText(next));
    }
  }, [types, taskType]);

  useEffect(() => {
    if (!node.allowed_workdirs.includes(workdir)) {
      setWorkdir(node.allowed_workdirs[0] ?? "");
    }
  }, [node.allowed_workdirs, workdir]);

  function onTaskTypeChange(value: string) {
    setTaskType(value);
    setPayloadText(defaultPayloadText(value));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const env = envText.trim() ? (JSON.parse(envText) as Record<string, string>) : {};
      const payload = buildPayload(taskType, payloadText);
      if (
        supportsExecutionOverrides(taskType) &&
        (executionBackend !== "default" || executionTarget.trim() || executionPython.trim())
      ) {
        payload.execution = {
          backend: executionBackend,
          ...(executionTarget.trim() ? { target: executionTarget.trim() } : {}),
          ...(executionPython.trim() ? { python: executionPython.trim() } : {}),
        };
      }
      const gpuIds = requestedGpuIds
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => Number(item));
      if (gpuIds.some((item) => !Number.isInteger(item) || item < 0)) {
        throw new Error("requested_gpu_ids 必须是非负整数列表");
      }
      const created = await store.callApi((token) => api.createTask(token, {
        node_id: node.node_id,
        type: taskType,
        payload,
        task_id: taskId.trim() || null,
        revision: Number(revision) || 1,
        idempotency_key: idempotencyKey.trim() || null,
        workdir: workdir || null,
        env,
        requested_gpu_ids: gpuIds,
        timeout_sec: Number(timeoutSec) || null,
        kill_grace_sec: Number(killGraceSec) || 15,
        danger_level: dangerLevel,
      }));
      toast.push({
        tone: "success",
        title: "任务已创建",
        description: `${created.task_id} · ${created.type}`,
      });
      void store.refresh({ silent: true });
      navigate({ name: "task-detail", taskId: created.task_id });
      setTaskId("");
      setRevision(1);
      setIdempotencyKey("");
      setRequestedGpuIds("");
      setKillGraceSec(15);
      setExecutionBackend("default");
      setExecutionTarget("");
      setExecutionPython("");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.body || err.message
          : err instanceof Error
            ? err.message
            : "任务创建失败";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const shape = payloadShape(taskType);
  const meta = taskTypeMeta(taskType);
  const showExecutionOverrides = supportsExecutionOverrides(taskType);
  const payloadLabel =
    shape === "command"
      ? "命令文本"
      : shape === "script"
        ? "Python 脚本"
        : shape === "none"
          ? "无需 payload，可保留 {}"
          : "payload JSON";

  return (
    <form className={forms.stack} onSubmit={onSubmit}>
      <div className={forms.row}>
        <label className={forms.field}>
          <span className={forms.label}>任务类型</span>
          <select
            className={forms.select}
            value={taskType}
            onChange={(event) => onTaskTypeChange(event.target.value)}
          >
            {types.map((kind) => (
              <option key={kind} value={kind}>
                {taskTypeMeta(kind).label}
              </option>
            ))}
          </select>
          <span className={forms.hint}>{meta.description}</span>
        </label>
        <label className={forms.field}>
          <span className={forms.label}>工作目录</span>
          <select
            className={`${forms.select} ${forms.mono}`}
            value={workdir}
            onChange={(event) => setWorkdir(event.target.value)}
          >
            {node.allowed_workdirs.length === 0 ? <option value="">未配置</option> : null}
            {node.allowed_workdirs.map((dir) => (
              <option key={dir} value={dir}>
                {dir}
              </option>
            ))}
          </select>
        </label>
        <label className={forms.field}>
          <span className={forms.label}>超时（秒）</span>
          <input
            className={forms.input}
            type="number"
            min={1}
            max={60 * 60 * 24 * 14}
            value={timeoutSec}
            onChange={(event) => setTimeoutSec(Number(event.target.value || 0))}
          />
        </label>
      </div>

      <div className={forms.row}>
        <label className={forms.field}>
          <span className={forms.label}>自定义 task_id</span>
          <input
            className={`${forms.input} ${forms.mono}`}
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            placeholder="留空则后端自动生成"
          />
        </label>
        <label className={forms.field}>
          <span className={forms.label}>revision</span>
          <input
            className={forms.input}
            type="number"
            min={1}
            value={revision}
            onChange={(event) => setRevision(Number(event.target.value || 1))}
          />
        </label>
        <label className={forms.field}>
          <span className={forms.label}>idempotency_key</span>
          <input
            className={`${forms.input} ${forms.mono}`}
            value={idempotencyKey}
            onChange={(event) => setIdempotencyKey(event.target.value)}
            placeholder="留空则后端自动生成"
          />
        </label>
      </div>

      <div className={forms.row}>
        <label className={forms.field}>
          <span className={forms.label}>requested_gpu_ids</span>
          <input
            className={`${forms.input} ${forms.mono}`}
            value={requestedGpuIds}
            onChange={(event) => setRequestedGpuIds(event.target.value)}
            placeholder="如 0,1"
          />
          <span className={forms.hint}>为空表示不限制 GPU。多 GPU 机器可显式选择。</span>
        </label>
        <label className={forms.field}>
          <span className={forms.label}>kill_grace_sec</span>
          <input
            className={forms.input}
            type="number"
            min={1}
            max={600}
            value={killGraceSec}
            onChange={(event) => setKillGraceSec(Number(event.target.value || 15))}
          />
        </label>
        <label className={forms.field}>
          <span className={forms.label}>danger_level</span>
          <select
            className={forms.select}
            value={dangerLevel}
            onChange={(event) => setDangerLevel(event.target.value)}
          >
            <option value="normal">normal</option>
            <option value="warning">warning</option>
            <option value="dangerous">dangerous</option>
          </select>
        </label>
      </div>

      {showExecutionOverrides ? (
        <div className={forms.row}>
          <label className={forms.field}>
            <span className={forms.label}>执行环境</span>
            <select
              className={forms.select}
              value={executionBackend}
              onChange={(event) => setExecutionBackend(event.target.value)}
            >
              <option value="default">default</option>
              <option value="system_python">system_python</option>
              <option value="venv_path">venv_path</option>
              <option value="uv_project">uv_project</option>
              <option value="conda_name">conda_name</option>
              <option value="conda_prefix">conda_prefix</option>
              <option value="micromamba_prefix">micromamba_prefix</option>
            </select>
            <span className={forms.hint}>
              `shell / python_script / pip_install` 可直接切换到指定 venv、uv、conda、micromamba。
            </span>
          </label>
          <label className={forms.field}>
            <span className={forms.label}>环境目标</span>
            <input
              className={`${forms.input} ${forms.mono}`}
              value={executionTarget}
              onChange={(event) => setExecutionTarget(event.target.value)}
              placeholder="如 .venv / my-env / C:\\mamba\\envs\\train"
            />
            <span className={forms.hint}>
              `venv_path` 填目录或 python 路径，`uv_project` 填项目目录，`conda_name` 填环境名。
            </span>
          </label>
          <label className={forms.field}>
            <span className={forms.label}>Python 入口</span>
            <input
              className={`${forms.input} ${forms.mono}`}
              value={executionPython}
              onChange={(event) => setExecutionPython(event.target.value)}
              placeholder="默认 python"
            />
            <span className={forms.hint}>
              仅在 `system_python / uv_project / conda / micromamba` 下有意义，可改成 `python3.12` 等。
            </span>
          </label>
        </div>
      ) : null}

      <label className={forms.field}>
        <span className={forms.label}>{payloadLabel}</span>
        <textarea
          className={forms.textarea}
          rows={shape === "json" ? 8 : 6}
          value={payloadText}
          onChange={(event) => setPayloadText(event.target.value)}
          disabled={shape === "none"}
        />
      </label>

      <label className={forms.field}>
        <span className={forms.label}>环境变量（JSON）</span>
        <textarea
          className={forms.textarea}
          rows={4}
          value={envText}
          onChange={(event) => setEnvText(event.target.value)}
        />
      </label>

      {error ? <div className={forms.error}>{error}</div> : null}

      <div className={forms.actions}>
        <Button type="submit" variant="accent" disabled={submitting}>
          {submitting ? "下发中…" : "下发任务"}
        </Button>
      </div>
    </form>
  );
}
