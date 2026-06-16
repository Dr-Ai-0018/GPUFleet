import { useEffect, useState } from "react";
import { ApiError, api } from "../../api";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import type { AdminTaskDetail } from "../../types";
import { CodeBlock } from "../../ui/CodeBlock";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { EmptyState } from "../../ui/EmptyState";
import { StatusPill } from "../../ui/StatusPill";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { labelForError, taskStatusLabel, taskStatusTone } from "../../lib/labels";
import { bytesToReadable, formatRelative, formatTime, prettyJson } from "../../lib/format";

const cardCls =
  "rounded-xl p-5 transition-all duration-300 bg-[var(--surface-card)] border border-[var(--card-border)] shadow-[var(--shadow-card-lite)]";
const ACTIVE_STATUSES = new Set(["pending", "claimed", "running", "cancel_requested"]);

type Props = { taskId: string };
type TaskResultSummary = { execution?: { backend?: unknown } };

export function TaskDetailView({ taskId }: Props): JSX.Element {
  const store = useConsoleStore();
  const { callApi } = store;
  const toast = useToast();
  const [detail, setDetail] = useState<AdminTaskDetail | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(silent = false) {
      if (!store.token) return;
      if (!silent) setLoadState("loading");
      try {
        const next = await callApi((t) => api.getTaskDetail(t, taskId));
        if (!cancelled) {
          setDetail(next);
          setLoadState("ready");
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setLoadState("missing");
          return;
        }
        setLoadState("error");
      }
    }
    void load();
    const id = window.setInterval(() => void load(true), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [store.token, taskId, callApi]);

  async function handleCancel() {
    if (!detail) return;
    setBusy(true);
    try {
      const updated = await store.callApi((t) => api.cancelTask(t, detail.task_id));
      setDetail(updated);
      toast.push({ tone: "warning", title: "已请求取消" });
      void store.refresh({ silent: true });
    } catch (err) {
      toast.push({ tone: "error", title: "取消失败", description: labelForError(err, "") });
    } finally {
      setBusy(false);
    }
  }

  if (loadState === "missing")
    return (
      <div className="mx-auto max-w-[1000px] py-20">
        <EmptyState
          title="未找到任务"
          description={`任务 ${taskId} 不存在。`}
          action={
            <Button variant="accent" onClick={() => navigate({ name: "tasks" })}>
              返回任务中心
            </Button>
          }
        />
      </div>
    );
  if (loadState === "loading" && !detail)
    return (
      <div className="mx-auto max-w-[1000px] py-20 text-center font-mono text-xs text-gray-500">
        加载中…
      </div>
    );
  if (loadState === "error" && !detail)
    return (
      <div className="mx-auto max-w-[1000px] py-20">
        <EmptyState title="加载失败" />
      </div>
    );
  if (!detail) return <div />;

  const isActive = ACTIVE_STATUSES.has(detail.status);
  const resultSummary = detail.result?.summary as TaskResultSummary | undefined;
  const resultBackend =
    typeof resultSummary?.execution?.backend === "string"
      ? resultSummary.execution.backend
      : "default";

  return (
    <div className="mx-auto max-w-[1300px] space-y-6">
      <ConfirmDialog
        open={confirmCancel}
        title="取消任务"
        message={`确定取消 ${detail.task_id}？`}
        confirmLabel="取消任务"
        cancelLabel="返回"
        variant="danger"
        onConfirm={() => {
          setConfirmCancel(false);
          void handleCancel();
        }}
        onCancel={() => setConfirmCancel(false)}
      />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 font-mono text-[11px] text-gray-500">{detail.task_id}</div>
          <h1 className="font-mono text-xl font-bold text-white">{detail.type}</h1>
          <div className="mt-2 flex items-center gap-3">
            <StatusPill
              tone={taskStatusTone[detail.status] ?? "muted"}
              label={taskStatusLabel[detail.status] ?? detail.status}
              pulse={isActive}
            />
            <button
              type="button"
              onClick={() => navigate({ name: "node-detail", nodeId: detail.node_id })}
              className="font-mono text-xs text-cyan-400 transition-colors hover:text-white"
            >
              {detail.node_id}
            </button>
          </div>
        </div>
        {isActive ? (
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            disabled={busy}
            className="rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-1.5 font-mono text-[11px] font-bold text-red-400 transition-all hover:bg-red-500/20 disabled:opacity-40"
          >
            请求取消
          </button>
        ) : null}
      </div>

      {/* Timeline */}
      <div className={cardCls}>
        <div className="mb-4 font-mono text-[12px] font-bold text-gray-500 uppercase">时间线</div>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <span className="block font-mono text-[10px] text-gray-500">创建</span>
            <span className="font-mono text-xs text-white">{formatTime(detail.created_at)}</span>
            <span className="block text-[10px] text-gray-600">
              {formatRelative(detail.created_at)}
            </span>
          </div>
          <div>
            <span className="block font-mono text-[10px] text-gray-500">领取</span>
            <span className="font-mono text-xs text-white">
              {detail.claimed_at ? formatTime(detail.claimed_at) : "—"}
            </span>
          </div>
          <div>
            <span className="block font-mono text-[10px] text-gray-500">开始</span>
            <span className="font-mono text-xs text-white">
              {detail.started_at ? formatTime(detail.started_at) : "—"}
            </span>
          </div>
          <div>
            <span className="block font-mono text-[10px] text-gray-500">结束</span>
            <span className="font-mono text-xs text-white">
              {detail.finished_at ? formatTime(detail.finished_at) : "—"}
            </span>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-4 border-t border-white/5 pt-4">
          <div>
            <span className="block font-mono text-[10px] text-gray-500">工作目录</span>
            <span className="font-mono text-xs text-white">{detail.workdir ?? "默认"}</span>
          </div>
          <div>
            <span className="block font-mono text-[10px] text-gray-500">超时</span>
            <span className="font-mono text-xs text-white">{detail.timeout_sec}s</span>
          </div>
          <div>
            <span className="block font-mono text-[10px] text-gray-500">kill_grace</span>
            <span className="font-mono text-xs text-white">{detail.kill_grace_sec}s</span>
          </div>
          <div>
            <span className="block font-mono text-[10px] text-gray-500">幂等键</span>
            <span className="truncate font-mono text-xs text-white">{detail.idempotency_key}</span>
          </div>
        </div>
      </div>

      {/* Payload + Env */}
      <div className="grid grid-cols-2 gap-6">
        <div className={cardCls}>
          <div className="mb-3 font-mono text-[12px] font-bold text-gray-500 uppercase">
            payload
          </div>
          <CodeBlock value={prettyJson(detail.payload)} maxHeight={280} />
        </div>
        <div className={cardCls}>
          <div className="mb-3 font-mono text-[12px] font-bold text-gray-500 uppercase">
            环境变量
          </div>
          <CodeBlock value={prettyJson(detail.env)} maxHeight={280} />
        </div>
      </div>

      {/* Result */}
      <div className={cardCls}>
        <div className="mb-4 font-mono text-[12px] font-bold text-gray-500 uppercase">执行结果</div>
        {detail.result ? (
          <>
            <div className="mb-4 grid grid-cols-3 gap-4">
              <div>
                <span className="block font-mono text-[10px] text-gray-500">退出码</span>
                <span className="font-mono text-sm font-bold text-white">
                  {String(detail.result.exit_code ?? "—")}
                </span>
              </div>
              <div>
                <span className="block font-mono text-[10px] text-gray-500">完成时间</span>
                <span className="font-mono text-xs text-white">
                  {detail.result.finished_at ? formatTime(detail.result.finished_at) : "—"}
                </span>
              </div>
              <div>
                <span className="block font-mono text-[10px] text-gray-500">后端</span>
                <span className="font-mono text-xs text-white">{resultBackend}</span>
              </div>
            </div>
            <CodeBlock
              label="result.summary"
              value={prettyJson(detail.result.summary)}
              maxHeight={240}
            />
          </>
        ) : (
          <div className="py-8 text-center font-mono text-xs text-gray-600">尚无结果</div>
        )}
      </div>

      {/* Logs */}
      <div className={cardCls}>
        <div className="mb-4 font-mono text-[12px] font-bold text-gray-500 uppercase">日志预览</div>
        {detail.logs.length === 0 ? (
          <div className="py-8 text-center font-mono text-xs text-gray-600">尚无日志</div>
        ) : (
          <div className="space-y-3">
            {detail.logs.map((log) => (
              <CodeBlock
                key={log.stream}
                label={`${log.stream} · ${log.last_offset} bytes`}
                value={log.preview_text || "(empty)"}
                maxHeight={280}
              />
            ))}
          </div>
        )}
      </div>

      {/* Artifacts */}
      {detail.artifacts.length > 0 ? (
        <div className={`${cardCls} p-0`}>
          <div className="border-b border-white/5 px-5 py-4 font-mono text-[12px] font-bold text-gray-500 uppercase">
            产物
          </div>
          {detail.artifacts.map((a) => (
            <div
              key={a.storage_path}
              className="flex items-center justify-between border-b border-white/[0.03] px-5 py-3 last:border-0"
            >
              <div>
                <div className="text-xs font-medium text-white">{a.artifact_name}</div>
                <div className="font-mono text-[11px] text-gray-500">{a.storage_path}</div>
              </div>
              <div className="text-right font-mono text-[11px] text-gray-500">
                <span>{a.artifact_type}</span> · <span>{bytesToReadable(a.size_bytes)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
