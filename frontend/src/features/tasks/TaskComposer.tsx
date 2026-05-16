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
} from "./taskTypes";

type Props = {
  node: NodeResponse;
};

export function TaskComposer({ node }: Props): JSX.Element {
  const store = useConsoleStore();
  const toast = useToast();
  const types = useMemo(() => allowedTaskTypes(node.node_type), [node.node_type]);
  const [taskType, setTaskType] = useState<string>(() => types[0] ?? "shell");
  const [workdir, setWorkdir] = useState<string>(node.allowed_workdirs[0] ?? "");
  const [timeoutSec, setTimeoutSec] = useState<number>(3600);
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
      const created = await api.createTask(store.token, {
        node_id: node.node_id,
        type: taskType,
        payload,
        workdir: workdir || null,
        env,
        timeout_sec: Number(timeoutSec) || null,
      });
      toast.push({
        tone: "success",
        title: "任务已创建",
        description: `${created.task_id} · ${created.type}`,
      });
      void store.refresh({ silent: true });
      navigate({ name: "task-detail", taskId: created.task_id });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        store.signalAuthFailure();
        return;
      }
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
                {kind}
              </option>
            ))}
          </select>
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
