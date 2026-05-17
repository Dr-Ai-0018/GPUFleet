import { useEffect, useState } from "react";
import { ApiError, api } from "../../api";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import type { AdminTaskDetail } from "../../types";
import { Card, Field, FieldGrid } from "../../ui/Card";
import { CodeBlock } from "../../ui/CodeBlock";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { EmptyState } from "../../ui/EmptyState";
import { StatusPill } from "../../ui/StatusPill";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { taskStatusLabel, taskStatusTone } from "../../lib/labels";
import { bytesToReadable, formatRelative, formatTime, prettyJson } from "../../lib/format";
import page from "../../ui/page.module.css";
import styles from "./TaskDetailView.module.css";

const ACTIVE_STATUSES = new Set(["pending", "claimed", "running"]);

type Props = { taskId: string };

export function TaskDetailView({ taskId }: Props): JSX.Element {
  const store = useConsoleStore();
  const toast = useToast();
  const [detail, setDetail] = useState<AdminTaskDetail | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(silent = false) {
      if (!store.token) return;
      if (!silent) setLoadState("loading");
      try {
        const next = await store.callApi((token) => api.getTaskDetail(token, taskId));
        if (!cancelled) {
          setDetail(next);
          setLoadState("ready");
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setLoadState("missing");
          return;
        }
        setLoadState("error");
        setError(err instanceof Error ? err.message : "加载任务失败");
      }
    }
    void load();
    const id = window.setInterval(() => void load(true), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [store.token, taskId, store.callApi]);

  async function handleCancel() {
    if (!detail) return;
    setBusy(true);
    try {
      const updated = await store.callApi((token) => api.cancelTask(token, detail.task_id));
      setDetail(updated);
      toast.push({ tone: "warning", title: "已请求取消", description: detail.task_id });
      void store.refresh({ silent: true });
    } catch (err) {
      toast.push({
        tone: "error",
        title: "取消失败",
        description: err instanceof Error ? err.message : "未知错误",
      });
    } finally {
      setBusy(false);
    }
  }

  if (loadState === "missing") {
    return (
      <div className={page.page}>
        <Card>
          <EmptyState
            title="未找到任务"
            description={`任务 ${taskId} 不存在或已被清理。`}
            action={
              <Button variant="accent" onClick={() => navigate({ name: "tasks" })}>
                返回任务中心
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  if (loadState === "loading" && !detail) {
    return (
      <div className={page.page}>
        <Card>
          <div className="muted">正在加载任务详情…</div>
        </Card>
      </div>
    );
  }

  if (loadState === "error" && !detail) {
    return (
      <div className={page.page}>
        <Card>
          <EmptyState title="任务加载失败" description={error ?? "未知错误"} />
        </Card>
      </div>
    );
  }

  if (!detail) return <div className={page.page} />;

  const isActive = ACTIVE_STATUSES.has(detail.status) || detail.status === "cancel_requested";
  const executionSummary =
    detail.result && typeof detail.result.summary.execution === "object" && detail.result.summary.execution !== null
      ? (detail.result.summary.execution as Record<string, unknown>)
      : null;

  return (
    <div className={page.page}>
      <header className={page.head}>
        <div className={page.titleBlock}>
          <span className={page.eyebrow}>{detail.task_id}</span>
          <h1 className={page.title}>{detail.type}</h1>
          <div className={page.statusRow}>
            <StatusPill
              tone={taskStatusTone[detail.status] ?? "muted"}
              label={taskStatusLabel[detail.status] ?? detail.status}
              pulse={isActive}
            />
            <Button
              size="sm"
              variant="quiet"
              onClick={() => navigate({ name: "node-detail", nodeId: detail.node_id })}
            >
              {detail.node_id}
            </Button>
          </div>
        </div>
        <div className={page.actions}>
          {isActive ? (
            <Button variant="danger" onClick={() => setConfirmCancelOpen(true)} disabled={busy}>
              {busy ? "处理中…" : "请求取消"}
            </Button>
          ) : null}
        </div>
      </header>

      <ConfirmDialog
        open={confirmCancelOpen}
        title="确认取消任务"
        message={`确定要请求取消任务 ${detail.task_id} 吗？节点将收到终止信号，但进程可能不会立即停止。`}
        confirmLabel="确认取消"
        cancelLabel="返回"
        variant="danger"
        onConfirm={() => {
          setConfirmCancelOpen(false);
          void handleCancel();
        }}
        onCancel={() => setConfirmCancelOpen(false)}
      />

      <Card title="时间线">
        <FieldGrid>
          <Field label="创建" value={`${formatTime(detail.created_at)} · ${formatRelative(detail.created_at)}`} />
          <Field
            label="领取"
            value={detail.claimed_at ? `${formatTime(detail.claimed_at)} · ${formatRelative(detail.claimed_at)}` : "—"}
          />
          <Field
            label="开始"
            value={detail.started_at ? `${formatTime(detail.started_at)} · ${formatRelative(detail.started_at)}` : "—"}
          />
          <Field
            label="结束"
            value={detail.finished_at ? `${formatTime(detail.finished_at)} · ${formatRelative(detail.finished_at)}` : "—"}
          />
          <Field label="工作目录" value={detail.workdir ?? "agent 默认 run_dir"} mono />
          <Field label="超时" value={`${detail.timeout_sec} s`} />
          <Field label="终止宽限" value={`${detail.kill_grace_sec} s`} />
          <Field label="幂等键" value={detail.idempotency_key} mono />
        </FieldGrid>
      </Card>

      <section className={styles.split}>
        <Card title="payload">
          <CodeBlock value={prettyJson(detail.payload)} maxHeight={320} />
        </Card>
        <Card title="环境变量">
          <CodeBlock value={prettyJson(detail.env)} maxHeight={320} />
        </Card>
      </section>

      <Card title="执行结果">
        {detail.result ? (
          <>
            <FieldGrid>
              <Field label="退出码" value={String(detail.result.exit_code ?? "—")} />
              <Field
                label="完成时间"
                value={
                  detail.result.finished_at
                    ? `${formatTime(detail.result.finished_at)} · ${formatRelative(detail.result.finished_at)}`
                    : "—"
                }
              />
              <Field
                label="执行后端"
                value={typeof executionSummary?.backend === "string" ? executionSummary.backend : "—"}
              />
            </FieldGrid>
            <div style={{ marginTop: 12 }}>
              <CodeBlock label="result.summary" value={prettyJson(detail.result.summary)} maxHeight={280} />
            </div>
          </>
        ) : (
          <EmptyState title="尚无结果" />
        )}
      </Card>

      <Card title="日志预览">
        {detail.logs.length === 0 ? (
          <EmptyState title="尚无日志" />
        ) : (
          <div className={styles.logStack}>
            {detail.logs.map((log) => (
              <CodeBlock
                key={log.stream}
                label={`${log.stream} · ${log.last_offset} bytes · ${formatRelative(log.updated_at)}`}
                value={log.preview_text || "(empty)"}
                maxHeight={320}
              />
            ))}
          </div>
        )}
      </Card>

      <Card title="产物" bodyFlush={detail.artifacts.length > 0}>
        {detail.artifacts.length === 0 ? (
          <EmptyState title="尚无产物" />
        ) : (
          <ul className={styles.artifactList}>
            {detail.artifacts.map((artifact) => (
              <li key={artifact.storage_path} className={styles.artifactItem}>
                <div>
                  <div className={styles.artifactName}>{artifact.artifact_name}</div>
                  <div className={styles.artifactPath}>{artifact.storage_path}</div>
                </div>
                <div className={styles.artifactMeta}>
                  <span>{artifact.artifact_type}</span>
                  <span>{bytesToReadable(artifact.size_bytes)}</span>
                  <span>{formatRelative(artifact.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
