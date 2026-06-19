import { type FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { navigate } from "../../lib/routing";
import { labelForError } from "../../lib/labels";
import { useConsoleStore } from "../../state/ConsoleStore";
import { useToast } from "../../ui/Toast";
import { Button } from "../../ui/Button";
import { Dropdown } from "../../ui/Dropdown";
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
  const [payloadText, setPayloadText] = useState<string>(() =>
    defaultPayloadText(types[0] ?? "shell"),
  );
  const [envText, setEnvText] = useState<string>("{}");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ requestedGpuIds?: string; env?: string }>({});

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
    setFieldErrors({});
    try {
      let env: Record<string, string> = {};
      if (envText.trim()) {
        try {
          env = JSON.parse(envText) as Record<string, string>;
        } catch {
          setFieldErrors({ env: "环境变量 JSON 格式无效，请检查语法" });
          return;
        }
      }
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
        setFieldErrors({ requestedGpuIds: "requested_gpu_ids 必须是逗号分隔的非负整数列表" });
        return;
      }
      const created = await store.callApi((token) =>
        api.createTask(token, {
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
        }),
      );
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
      setError(labelForError(err, "任务创建失败"));
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
        <div className={forms.field}>
          <span className={forms.label}>任务类型</span>
          <Dropdown
            value={taskType}
            onChange={onTaskTypeChange}
            options={types.map((kind) => ({ value: kind, label: taskTypeMeta(kind).label }))}
          />
          <span className={forms.hint}>{meta.description}</span>
        </div>
        <div className={forms.field}>
          <span className={forms.label}>工作目录</span>
          <Dropdown
            value={workdir}
            onChange={setWorkdir}
            options={
              node.allowed_workdirs.length === 0
                ? [{ value: "", label: "未配置", disabled: true }]
                : node.allowed_workdirs.map((dir) => ({ value: dir, label: dir }))
            }
            mono
            placeholder="未配置"
          />
        </div>
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
          {fieldErrors.requestedGpuIds ? (
            <span className={forms.errorText}>{fieldErrors.requestedGpuIds}</span>
          ) : null}
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
        <div className={forms.field}>
          <span className={forms.label}>danger_level</span>
          <Dropdown
            value={dangerLevel}
            onChange={setDangerLevel}
            options={[
              { value: "normal", label: "normal" },
              { value: "warning", label: "warning" },
              { value: "dangerous", label: "dangerous" },
            ]}
            mono
          />
        </div>
      </div>

      {showExecutionOverrides ? (
        <div className={forms.row}>
          <div className={forms.field}>
            <span className={forms.label}>执行环境</span>
            <Dropdown
              value={executionBackend}
              onChange={setExecutionBackend}
              options={[
                { value: "default", label: "default" },
                { value: "system_python", label: "system_python" },
                { value: "venv_path", label: "venv_path" },
                { value: "uv_project", label: "uv_project" },
                { value: "conda_name", label: "conda_name" },
                { value: "conda_prefix", label: "conda_prefix" },
                { value: "micromamba_prefix", label: "micromamba_prefix" },
              ]}
              mono
            />
            <span className={forms.hint}>
              `shell / python_script / pip_install` 可直接切换到指定 venv、uv、conda、micromamba。
            </span>
          </div>
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
              仅在 `system_python / uv_project / conda / micromamba` 下有意义，可改成 `python3.12`
              等。
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
        {fieldErrors.env ? <span className={forms.errorText}>{fieldErrors.env}</span> : null}
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
