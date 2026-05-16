import { useMemo, useState } from "react";
import { ApiError, api } from "../../api";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import { Card, Field, FieldGrid } from "../../ui/Card";
import { CodeBlock } from "../../ui/CodeBlock";
import { EmptyState } from "../../ui/EmptyState";
import { StatusPill } from "../../ui/StatusPill";
import { Button } from "../../ui/Button";
import { Gauge } from "../../ui/Gauge";
import { useToast } from "../../ui/Toast";
import {
  connectionLabel,
  connectionTone,
  nodeTypeLabel,
  onboardingLabel,
  onboardingTone,
  osLabel,
} from "../../lib/labels";
import { bytesToReadable, formatRelative, formatTime, prettyJson } from "../../lib/format";
import { TaskComposer } from "../tasks/TaskComposer";
import type { DashboardNodeCard, NodeResponse } from "../../types";
import page from "../../ui/page.module.css";
import styles from "./NodeDetailView.module.css";
import fleet from "./FleetView.module.css";

type Props = { nodeId: string };

export function NodeDetailView({ nodeId }: Props): JSX.Element {
  const store = useConsoleStore();
  const toast = useToast();
  const node = store.nodes.find((n) => n.node_id === nodeId) ?? null;
  const overviewNode = store.overview?.nodes.find((n) => n.node_id === nodeId) ?? null;
  const [busy, setBusy] = useState(false);

  const recentTasks = useMemo(
    () => store.tasks.filter((task) => task.node_id === nodeId).slice(0, 8),
    [store.tasks, nodeId],
  );

  if (!node) {
    return (
      <div className={page.page}>
        <EmptyState
          title="未找到节点"
          description={`节点 ${nodeId} 不在当前列表里。`}
          action={
            <Button variant="accent" onClick={() => navigate({ name: "fleet" })}>
              返回舰队
            </Button>
          }
        />
      </div>
    );
  }

  async function handleToggleEnable() {
    if (!node) return;
    setBusy(true);
    try {
      if (node.is_enabled) {
        await api.disableNode(store.token, node.node_id);
        toast.push({ tone: "warning", title: "节点已停用", description: node.display_name });
      } else {
        await api.enableNode(store.token, node.node_id);
        toast.push({ tone: "success", title: "节点已启用", description: node.display_name });
      }
      await store.refresh({ silent: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        store.signalAuthFailure();
        return;
      }
      toast.push({
        tone: "error",
        title: "操作失败",
        description: err instanceof Error ? err.message : "未知错误",
      });
    } finally {
      setBusy(false);
    }
  }

  const canDispatch =
    node.is_enabled &&
    node.connection_status === "online" &&
    node.onboarding_status === "connected";

  return (
    <div className={page.page}>
      <header className={page.head}>
        <div className={page.titleBlock}>
          <div className={page.eyebrow}>NODE · {node.node_id}</div>
          <h1 className={page.title}>{node.display_name}</h1>
          <div className={page.statusRow}>
            <StatusPill
              tone={connectionTone[node.connection_status]}
              label={connectionLabel[node.connection_status]}
              pulse={node.connection_status === "online"}
            />
            <StatusPill
              tone={onboardingTone[node.onboarding_status]}
              label={onboardingLabel[node.onboarding_status]}
              pulse={node.onboarding_status === "awaiting_first_heartbeat"}
            />
            <span className={fleet.metaChip}>{nodeTypeLabel[node.node_type] ?? node.node_type}</span>
            {node.os_type ? (
              <span className={fleet.metaChip}>{osLabel[node.os_type] ?? node.os_type}</span>
            ) : null}
          </div>
        </div>
        <div className={page.actions}>
          <Button
            variant={node.is_enabled ? "ghost" : "accent"}
            onClick={() => void handleToggleEnable()}
            disabled={busy}
          >
            {busy ? "处理中…" : node.is_enabled ? "停用节点" : "启用节点"}
          </Button>
        </div>
      </header>

      {/* Connection slab — primary panel, dominates the page */}
      <ConnectionSlab node={node} />

      <section className={styles.layout}>
        <Card title="允许的工作目录">
          {node.allowed_workdirs.length === 0 ? (
            <EmptyState title="尚未配置" description="任务下发会被拒绝。" />
          ) : (
            <ul className={styles.pathList}>
              {node.allowed_workdirs.map((dir) => (
                <li key={dir}>{dir}</li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="标签">
          {node.tags.length === 0 ? (
            <span className="muted">—</span>
          ) : (
            <div className={styles.tagRow}>
              {node.tags.map((tag) => (
                <span key={tag} className={styles.tag}>{tag}</span>
              ))}
            </div>
          )}
        </Card>
      </section>

      <Card title="任务下发">
        {!canDispatch ? (
          <EmptyState title="暂不可下发" description={dispatchGuard(node)} />
        ) : (
          <TaskComposer node={node} />
        )}
      </Card>

      <Card
        title="最近任务"
        bodyFlush={recentTasks.length > 0}
        actions={
          <Button size="sm" variant="quiet" onClick={() => navigate({ name: "tasks" })}>
            全部 →
          </Button>
        }
      >
        {recentTasks.length === 0 ? (
          <EmptyState title="尚无任务" />
        ) : (
          <ul className={styles.tasksList}>
            {recentTasks.map((task) => (
              <li key={task.task_id}>
                <button
                  type="button"
                  className={styles.taskRow}
                  onClick={() => navigate({ name: "task-detail", taskId: task.task_id })}
                >
                  <span className={styles.taskRowId}>{task.task_id}</span>
                  <span className={styles.taskRowType}>{task.type}</span>
                  <StatusPill tone="muted" label={task.status} subtle />
                  <span className={styles.taskRowTime}>{formatRelative(task.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <NodeRuntimeBlock card={overviewNode} />
    </div>
  );
}

function ConnectionSlab({ node }: { node: NodeResponse }): JSX.Element {
  // Three-step connection rail: PROVISIONED → FIRST CONTACT → LIVE
  const provisioned = true; // node exists, by definition
  const firstContact = !!node.first_seen_at;
  const live = node.connection_status === "online";
  const guardTone = !node.is_enabled
    ? "danger"
    : node.connection_status === "offline"
      ? "warn"
      : node.onboarding_status === "awaiting_first_heartbeat"
        ? "warn"
        : null;
  const guardLabel = !node.is_enabled
    ? "DISABLED · agent will be rejected"
    : node.onboarding_status === "awaiting_first_heartbeat"
      ? "AWAITING FIRST HEARTBEAT"
      : node.connection_status === "offline"
        ? "OFFLINE · last seen exceeded 3× heartbeat"
        : node.connection_status === "never_seen"
          ? "NEVER SEEN"
          : null;
  return (
    <div className={styles.slab}>
      <header className={styles.slabHead}>
        <span className={styles.slabTitle}>接入与连接</span>
        <span className={styles.slabPills}>
          <StatusPill
            tone={onboardingTone[node.onboarding_status]}
            label={onboardingLabel[node.onboarding_status]}
            pulse={node.onboarding_status === "awaiting_first_heartbeat"}
          />
          <StatusPill
            tone={connectionTone[node.connection_status]}
            label={connectionLabel[node.connection_status]}
            pulse={node.connection_status === "online"}
          />
        </span>
      </header>

      <div className={styles.connRail}>
        <ConnStep
          label="PROVISIONED"
          value={`#${node.node_id}`}
          state={provisioned ? "done" : "idle"}
        />
        <ConnStep
          label="FIRST CONTACT"
          value={node.first_seen_at ? formatRelative(node.first_seen_at) : "尚未"}
          state={firstContact ? "done" : guardTone === "warn" ? "active" : "idle"}
          mute={!firstContact}
        />
        <ConnStep
          label="LAST HEARTBEAT"
          value={node.last_seen_at ? formatRelative(node.last_seen_at) : "—"}
          state={live ? "active" : node.connection_status === "offline" ? "fail" : "idle"}
          mute={!node.last_seen_at}
        />
      </div>

      <div className={styles.slabBody}>
        <FieldGrid>
          <Field label="心跳间隔" value={`${node.heartbeat_interval_sec} s`} />
          <Field label="是否启用" value={node.is_enabled ? "启用" : "已停用"} />
          <Field label="主机名" value={node.hostname ?? "—"} mono />
          <Field
            label="首次心跳"
            value={node.first_seen_at ? formatTime(node.first_seen_at) : "—"}
          />
          <Field
            label="最近心跳"
            value={node.last_seen_at ? formatTime(node.last_seen_at) : "—"}
          />
          <Field label="登记时间" value={formatTime(node.created_at)} />
        </FieldGrid>

        {guardLabel ? (
          <div
            className={`${styles.guard} ${
              guardTone === "danger" ? styles.guardDanger : guardTone === "warn" ? styles.guardWarn : ""
            }`}
          >
            <GuardIcon className={styles.guardIcon} />
            <span>{guardLabel}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConnStep({
  label,
  value,
  state,
  mute,
}: {
  label: string;
  value: string;
  state: "idle" | "active" | "done" | "fail";
  mute?: boolean;
}): JSX.Element {
  const cls = [
    styles.connStep,
    state === "active" ? styles.connStepActive : "",
    state === "done" ? styles.connStepDone : "",
    state === "fail" ? styles.connStepFail : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <span className={styles.connDot} aria-hidden />
      <div className={styles.connBody}>
        <span className={styles.connLabel}>{label}</span>
        <span className={`${styles.connValue}${mute ? ` ${styles.connValueMute}` : ""}`}>
          {value}
        </span>
      </div>
    </div>
  );
}

function GuardIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.5L13.5 4v3.5c0 3.2-2.4 5.8-5.5 6.5-3.1-.7-5.5-3.3-5.5-6.5V4L8 1.5z" />
      <path d="M8 6v3" />
      <circle cx="8" cy="11" r="0.5" fill="currentColor" />
    </svg>
  );
}

function dispatchGuard(node: NodeResponse): string {
  if (!node.is_enabled) return "节点已停用，启用后再下发。";
  if (node.onboarding_status === "awaiting_first_heartbeat") return "尚未完成首次接入。";
  if (node.connection_status === "offline") return "节点当前离线。";
  if (node.connection_status === "never_seen") return "节点从未上线过。";
  return "节点状态暂不可用。";
}

function NodeRuntimeBlock({ card }: { card: DashboardNodeCard | null }): JSX.Element | null {
  if (!card || !card.latest_status) return null;
  const status = card.latest_status;
  const cpu = status.cpu as { model?: string; logical_cores?: number; usage_percent?: number };
  const memory = status.memory as { total_bytes?: number; used_bytes?: number; usage_percent?: number };
  const pythonEnv = status.python_env as { python_version?: string; python_executable?: string };
  const gpus = status.gpus;
  const cpuUse = Number(cpu.usage_percent ?? 0);
  const memUse = Number(
    memory.usage_percent ??
      (memory.total_bytes ? ((memory.used_bytes ?? 0) / memory.total_bytes) * 100 : 0),
  );

  return (
    <Card title={`运行时快照 · ${formatRelative(status.reported_at)}`}>
      <div className={styles.snapshotBar}>
        <div className={styles.gauges}>
          <Gauge value={cpuUse} label="CPU" size={72} thickness={4} />
          <Gauge value={memUse} label="MEM" size={72} thickness={4} tone="indigo" />
        </div>
        <div className={styles.snapshotInfo}>
          <div className={styles.snapshotName}>{cpu.model ?? "—"}</div>
          <div className={styles.snapshotMeta}>
            {cpu.logical_cores ?? "—"} cores · {bytesToReadable(memory.used_bytes)} /{" "}
            {bytesToReadable(memory.total_bytes)}
          </div>
          {pythonEnv.python_version ? (
            <div className={styles.snapshotPython}>Python {pythonEnv.python_version}</div>
          ) : null}
        </div>
      </div>

      {gpus.length > 0 ? (
        <div className={styles.gpuGrid}>
          {gpus.map((gpu, idx) => {
            const g = gpu as Record<string, unknown>;
            const used = Number(g.used_vram_mb ?? 0);
            const total = Number(g.total_vram_mb ?? 0);
            const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
            const fillCls =
              pct >= 90
                ? `${styles.gpuBarFill} ${styles.gpuBarFillAlert}`
                : pct >= 75
                  ? `${styles.gpuBarFill} ${styles.gpuBarFillWarm}`
                  : styles.gpuBarFill;
            return (
              <div key={idx} className={styles.gpuCell}>
                <div className={styles.gpuHead}>
                  <span className={styles.gpuName}>{String(g.model ?? `GPU ${idx}`)}</span>
                  <span className={styles.gpuIndex}>#{String(g.index ?? idx)}</span>
                </div>
                <div className={styles.gpuBar}>
                  <div className={fillCls} style={{ width: `${pct}%` }} />
                </div>
                <div className={styles.gpuMeta}>
                  <span>
                    {used} / {total} MB
                  </span>
                  <span>util {String(g.utilization_percent ?? "—")}%</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <CodeBlock label="snapshot.json" value={prettyJson(status)} maxHeight={320} />
    </Card>
  );
}
