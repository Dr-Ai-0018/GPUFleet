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
import { taskStatusLabel, taskStatusTone } from "../../lib/labels";
import { bytesToReadable, formatRelative, formatTime, prettyJson } from "../../lib/format";

const cardCls = "rounded-xl p-5 transition-all duration-300 bg-[var(--surface-card)] border border-[var(--card-border)] shadow-[var(--shadow-card-lite)]";
const ACTIVE_STATUSES = new Set(["pending", "claimed", "running", "cancel_requested"]);

type Props = { taskId: string };

export function TaskDetailView({ taskId }: Props): JSX.Element {
  const store = useConsoleStore();
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
        const next = await store.callApi((t) => api.getTaskDetail(t, taskId));
        if (!cancelled) { setDetail(next); setLoadState("ready"); }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) { setLoadState("missing"); return; }
        setLoadState("error");
      }
    }
    void load();
    const id = window.setInterval(() => void load(true), 4000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [store.token, taskId, store.callApi]);

  async function handleCancel() {
    if (!detail) return;
    setBusy(true);
    try {
      const updated = await store.callApi((t) => api.cancelTask(t, detail.task_id));
      setDetail(updated);
      toast.push({ tone: "warning", title: "已请求取消" });
      void store.refresh({ silent: true });
    } catch (err) { toast.push({ tone: "error", title: "取消失败", description: err instanceof Error ? err.message : "" }); }
    finally { setBusy(false); }
  }

  if (loadState === "missing") return <div className="max-w-[1000px] mx-auto py-20"><EmptyState title="未找到任务" description={`任务 ${taskId} 不存在。`} action={<Button variant="accent" onClick={() => navigate({ name: "tasks" })}>返回任务中心</Button>} /></div>;
  if (loadState === "loading" && !detail) return <div className="max-w-[1000px] mx-auto py-20 text-center text-gray-500 font-mono text-xs">加载中…</div>;
  if (loadState === "error" && !detail) return <div className="max-w-[1000px] mx-auto py-20"><EmptyState title="加载失败" /></div>;
  if (!detail) return <div />;

  const isActive = ACTIVE_STATUSES.has(detail.status);

  return (
    <div className="max-w-[1300px] mx-auto space-y-6">
      <ConfirmDialog open={confirmCancel} title="取消任务" message={`确定取消 ${detail.task_id}？`} confirmLabel="取消任务" cancelLabel="返回" variant="danger" onConfirm={() => { setConfirmCancel(false); void handleCancel(); }} onCancel={() => setConfirmCancel(false)} />

      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[11px] text-gray-500 font-mono mb-1">{detail.task_id}</div>
          <h1 className="text-xl font-bold text-white font-mono">{detail.type}</h1>
          <div className="flex items-center gap-3 mt-2">
            <StatusPill tone={taskStatusTone[detail.status] ?? "muted"} label={taskStatusLabel[detail.status] ?? detail.status} pulse={isActive} />
            <button type="button" onClick={() => navigate({ name: "node-detail", nodeId: detail.node_id })} className="text-xs text-cyan-400 hover:text-white font-mono transition-colors">{detail.node_id}</button>
          </div>
        </div>
        {isActive ? <button type="button" onClick={() => setConfirmCancel(true)} disabled={busy} className="px-3.5 py-1.5 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 text-[11px] font-bold rounded-lg transition-all font-mono disabled:opacity-40">请求取消</button> : null}
      </div>

      {/* Timeline */}
      <div className={cardCls}>
        <div className="text-[12px] font-bold font-mono text-gray-500 uppercase mb-4">时间线</div>
        <div className="grid grid-cols-4 gap-4">
          <div><span className="text-[10px] text-gray-500 font-mono block">创建</span><span className="text-xs text-white font-mono">{formatTime(detail.created_at)}</span><span className="text-[10px] text-gray-600 block">{formatRelative(detail.created_at)}</span></div>
          <div><span className="text-[10px] text-gray-500 font-mono block">领取</span><span className="text-xs text-white font-mono">{detail.claimed_at ? formatTime(detail.claimed_at) : "—"}</span></div>
          <div><span className="text-[10px] text-gray-500 font-mono block">开始</span><span className="text-xs text-white font-mono">{detail.started_at ? formatTime(detail.started_at) : "—"}</span></div>
          <div><span className="text-[10px] text-gray-500 font-mono block">结束</span><span className="text-xs text-white font-mono">{detail.finished_at ? formatTime(detail.finished_at) : "—"}</span></div>
        </div>
        <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-white/5">
          <div><span className="text-[10px] text-gray-500 font-mono block">工作目录</span><span className="text-xs text-white font-mono">{detail.workdir ?? "默认"}</span></div>
          <div><span className="text-[10px] text-gray-500 font-mono block">超时</span><span className="text-xs text-white font-mono">{detail.timeout_sec}s</span></div>
          <div><span className="text-[10px] text-gray-500 font-mono block">kill_grace</span><span className="text-xs text-white font-mono">{detail.kill_grace_sec}s</span></div>
          <div><span className="text-[10px] text-gray-500 font-mono block">幂等键</span><span className="text-xs text-white font-mono truncate">{detail.idempotency_key}</span></div>
        </div>
      </div>

      {/* Payload + Env */}
      <div className="grid grid-cols-2 gap-6">
        <div className={cardCls}><div className="text-[12px] font-bold font-mono text-gray-500 uppercase mb-3">payload</div><CodeBlock value={prettyJson(detail.payload)} maxHeight={280} /></div>
        <div className={cardCls}><div className="text-[12px] font-bold font-mono text-gray-500 uppercase mb-3">环境变量</div><CodeBlock value={prettyJson(detail.env)} maxHeight={280} /></div>
      </div>

      {/* Result */}
      <div className={cardCls}>
        <div className="text-[12px] font-bold font-mono text-gray-500 uppercase mb-4">执行结果</div>
        {detail.result ? (
          <>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div><span className="text-[10px] text-gray-500 font-mono block">退出码</span><span className="text-sm font-bold text-white font-mono">{String(detail.result.exit_code ?? "—")}</span></div>
              <div><span className="text-[10px] text-gray-500 font-mono block">完成时间</span><span className="text-xs text-white font-mono">{detail.result.finished_at ? formatTime(detail.result.finished_at) : "—"}</span></div>
              <div><span className="text-[10px] text-gray-500 font-mono block">后端</span><span className="text-xs text-white font-mono">{typeof (detail.result.summary as any)?.execution?.backend === "string" ? (detail.result.summary as any).execution.backend : "default"}</span></div>
            </div>
            <CodeBlock label="result.summary" value={prettyJson(detail.result.summary)} maxHeight={240} />
          </>
        ) : <div className="text-xs text-gray-600 font-mono text-center py-8">尚无结果</div>}
      </div>

      {/* Logs */}
      <div className={cardCls}>
        <div className="text-[12px] font-bold font-mono text-gray-500 uppercase mb-4">日志预览</div>
        {detail.logs.length === 0 ? <div className="text-xs text-gray-600 font-mono text-center py-8">尚无日志</div> : (
          <div className="space-y-3">{detail.logs.map((log) => <CodeBlock key={log.stream} label={`${log.stream} · ${log.last_offset} bytes`} value={log.preview_text || "(empty)"} maxHeight={280} />)}</div>
        )}
      </div>

      {/* Artifacts */}
      {detail.artifacts.length > 0 ? (
        <div className={`${cardCls} p-0`}>
          <div className="px-5 py-4 border-b border-white/5 text-[12px] font-bold font-mono text-gray-500 uppercase">产物</div>
          {detail.artifacts.map((a) => (
            <div key={a.storage_path} className="px-5 py-3 border-b border-white/[0.03] last:border-0 flex justify-between items-center">
              <div><div className="text-xs text-white font-medium">{a.artifact_name}</div><div className="text-[11px] text-gray-500 font-mono">{a.storage_path}</div></div>
              <div className="text-[11px] text-gray-500 font-mono text-right"><span>{a.artifact_type}</span> · <span>{bytesToReadable(a.size_bytes)}</span></div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
