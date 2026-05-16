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
import type { DashboardNodeCard } from "../../types";
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
        <Card>
          <EmptyState
            title="未找到节点"
            description={`节点 ${nodeId} 不在当前列表里，可能已被删除或正在同步。`}
            action={
              <Button variant="accent" onClick={() => navigate({ name: "fleet" })}>
                返回舰队
              </Button>
            }
          />
        </Card>
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

  const guardCopy = guardMessage(node.connection_status, node.onboarding_status, node.is_enabled);

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
            {node.os_type ? <span className={fleet.metaChip}>{osLabel[node.os_type] ?? node.os_type}</span> : null}
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

      <section className={styles.layout}>
        <Card title="接入与连接" subtitle="区分‘已登记’与‘已连接’，避免误派任务。">
          <FieldGrid>
            <Field label="接入状态" value={onboardingLabel[node.onboarding_status]} />
            <Field label="连接状态" value={connectionLabel[node.connection_status]} />
            <Field label="是否启用" value={node.is_enabled ? "启用" : "已停用"} />
            <Field label="心跳间隔" value={`${node.heartbeat_interval_sec} s`} />
            <Field
              label="首次心跳"
              value={
                node.first_seen_at
                  ? `${formatTime(node.first_seen_at)} · ${formatRelative(node.first_seen_at)}`
                  : "尚未"
              }
            />
            <Field
              label="最近心跳"
              value={
                node.last_seen_at
                  ? `${formatTime(node.last_seen_at)} · ${formatRelative(node.last_seen_at)}`
                  : "—"
              }
            />
            <Field label="主机名" value={node.hostname ?? "—"} mono />
            <Field label="创建时间" value={formatTime(node.created_at)} />
          </FieldGrid>
          {!node.is_enabled ? (
            <Callout tone="danger" iconKind="ban">
              节点已停用，agent 无法获取任务，控制面也将拒绝其心跳。
            </Callout>
          ) : node.onboarding_status === "awaiting_first_heartbeat" ? (
            <Callout tone="info" iconKind="clock">
              控制面尚未收到来自该节点的首个有效心跳。请确保子节点已写入接入包并启动 agent。
            </Callout>
          ) : node.connection_status === "offline" ? (
            <Callout tone="warn" iconKind="bolt">
              节点上线过，但近 3× 心跳间隔内没有再签到。可能掉线或网络异常。
            </Callout>
          ) : null}
        </Card>

        <Card title="允许的工作目录" subtitle="任务的 workdir 必须落在白名单内。">
          {node.allowed_workdirs.length === 0 ? (
            <EmptyState
              title="尚未配置工作目录"
              description="任务下发会被拒绝。请在节点配置中添加允许的工作目录。"
            />
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
            <span className="muted">暂未配置标签。</span>
          ) : (
            <div className={styles.tagRow}>
              {node.tags.map((tag) => (
                <span key={tag} className={styles.tag}>{tag}</span>
              ))}
            </div>
          )}
        </Card>
      </section>

      <Card
        title="任务下发"
        subtitle={
          canDispatch
            ? "节点处于在线且已接入状态，可立即下发任务。"
            : "节点尚未具备接收任务的条件，下方表单已禁用。"
        }
      >
        {!canDispatch ? (
          <EmptyState title="任务下发暂不可用" description={guardCopy} />
        ) : (
          <TaskComposer node={node} />
        )}
      </Card>

      <Card
        title="该节点最近任务"
        bodyFlush={recentTasks.length > 0}
        actions={
          <Button size="sm" variant="quiet" onClick={() => navigate({ name: "tasks" })}>
            查看全部 →
          </Button>
        }
      >
        {recentTasks.length === 0 ? (
          <EmptyState title="该节点尚无任务" description="完成接入后，从上方表单创建第一条任务。" />
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

function guardMessage(connection: string, onboarding: string, enabled: boolean): string {
  if (!enabled) return "节点已停用，先启用再下发任务。";
  if (onboarding === "awaiting_first_heartbeat") return "节点尚未完成首次接入，等待首个签名心跳后再尝试。";
  if (connection === "offline") return "节点上线过但当前离线，agent 不会拉到任务。";
  if (connection === "never_seen") return "节点从未上线过，请先把 agent 启动起来。";
  return "节点状态暂不可用。";
}

function Callout({
  tone,
  iconKind,
  children,
}: {
  tone: "info" | "warn" | "danger";
  iconKind: "clock" | "bolt" | "ban";
  children: React.ReactNode;
}): JSX.Element {
  const cls =
    tone === "warn" ? styles.calloutWarn : tone === "danger" ? styles.calloutDanger : "";
  return (
    <div className={`${styles.callout} ${cls}`}>
      <CalloutIcon kind={iconKind} />
      <span>{children}</span>
    </div>
  );
}

function CalloutIcon({ kind }: { kind: "clock" | "bolt" | "ban" }): JSX.Element {
  const props = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: styles.calloutIcon,
  };
  switch (kind) {
    case "clock":
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3l2 1" />
        </svg>
      );
    case "bolt":
      return (
        <svg {...props}>
          <path d="M9 1L3 9h4l-1 6 6-8H8l1-6z" />
        </svg>
      );
    case "ban":
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="6" />
          <path d="M3.7 3.7l8.6 8.6" />
        </svg>
      );
  }
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
    <Card
      title="运行时快照"
      subtitle={`报告于 ${formatTime(status.reported_at)} · ${formatRelative(status.reported_at)}`}
    >
      <div className={styles.snapshotBar}>
        <div className={styles.gauges}>
          <Gauge value={cpuUse} label="CPU" size={72} thickness={4} />
          <Gauge value={memUse} label="MEM" size={72} thickness={4} tone="indigo" />
        </div>
        <div className={styles.snapshotInfo}>
          <div className={styles.snapshotName}>{cpu.model ?? "—"}</div>
          <div className={styles.snapshotMeta}>
            {cpu.logical_cores ?? "—"} cores · {bytesToReadable(memory.used_bytes)} / {bytesToReadable(memory.total_bytes)}
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
