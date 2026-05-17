import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../../api";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import { Card, Field, FieldGrid } from "../../ui/Card";
import { CodeBlock } from "../../ui/CodeBlock";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
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
import type { DashboardNodeCard, NodeResponse, NodeStatusPreview, OsType } from "../../types";
import page from "../../ui/page.module.css";
import forms from "../../ui/forms.module.css";
import styles from "./NodeDetailView.module.css";

type Props = { nodeId: string };

export function NodeDetailView({ nodeId }: Props): JSX.Element {
  const store = useConsoleStore();
  const toast = useToast();
  const storeNode = store.nodes.find((n) => n.node_id === nodeId) ?? null;
  const overviewNode = store.overview?.nodes.find((n) => n.node_id === nodeId) ?? null;
  const [node, setNode] = useState<NodeResponse | null>(storeNode);
  const [latestStatus, setLatestStatus] = useState<NodeStatusPreview | null>(overviewNode?.latest_status ?? null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditDirty, setIsEditDirty] = useState(false);
  const [editHydratedNodeId, setEditHydratedNodeId] = useState<string | null>(null);
  const [confirmToggleOpen, setConfirmToggleOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    display_name: "",
    hostname: "",
    os_type: "windows" as OsType,
    heartbeat_interval_sec: 5,
    allowed_workdirs: "",
    tags: "",
  });

  useEffect(() => {
    setNode(storeNode);
  }, [storeNode]);

  useEffect(() => {
    setLatestStatus(overviewNode?.latest_status ?? null);
  }, [overviewNode]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [freshNode, status] = await Promise.allSettled([
          store.callApi((token) => api.getNode(token, nodeId)),
          store.callApi((token) => api.getLatestNodeStatus(token, nodeId)),
        ]);
        if (cancelled) return;
        if (freshNode.status === "fulfilled") {
          setNode(freshNode.value);
        }
        if (status.status === "fulfilled") {
          setLatestStatus(status.value);
        } else if (status.reason instanceof ApiError && status.reason.status === 404) {
          setLatestStatus(null);
        }
      } catch {
        /* keep store fallback */
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [nodeId, store.callApi]);

  useEffect(() => {
    if (!node) return;
    if (isEditDirty && editHydratedNodeId === node.node_id) return;
    const nextOsType: OsType = node.os_type === "linux" ? "linux" : "windows";
    setEditForm({
      display_name: node.display_name,
      hostname: node.hostname ?? "",
      os_type: nextOsType,
      heartbeat_interval_sec: node.heartbeat_interval_sec,
      allowed_workdirs: node.allowed_workdirs.join("\n"),
      tags: node.tags.join(", "),
    });
    setEditError(null);
    setIsEditDirty(false);
    setEditHydratedNodeId(node.node_id);
  }, [node, isEditDirty, editHydratedNodeId]);

  function updateEditForm(
    updater: (prev: typeof editForm) => typeof editForm,
  ) {
    setIsEditDirty(true);
    setEditForm((prev) => updater(prev));
  }

  const recentTasks = useMemo(
    () => store.tasks.filter((task) => task.node_id === nodeId).slice(0, 8),
    [store.tasks, nodeId],
  );

  const runtimeCard = useMemo<DashboardNodeCard | null>(() => {
    if (!node) return null;
    return {
      node_id: node.node_id,
      display_name: node.display_name,
      node_type: node.node_type,
      os_type: node.os_type,
      hostname: node.hostname,
      tags: node.tags,
      is_enabled: node.is_enabled,
      heartbeat_interval_sec: node.heartbeat_interval_sec,
      first_seen_at: node.first_seen_at,
      last_seen_at: node.last_seen_at,
      online_status: overviewNode?.online_status ?? (node.connection_status as DashboardNodeCard["online_status"]),
      onboarding_status: node.onboarding_status,
      latest_status: latestStatus,
      active_task: overviewNode?.active_task ?? null,
    };
  }, [node, overviewNode, latestStatus]);

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
        const updated = await store.callApi((token) => api.disableNode(token, node.node_id));
        setNode(updated);
        toast.push({ tone: "warning", title: "节点已停用", description: node.display_name });
      } else {
        const updated = await store.callApi((token) => api.enableNode(token, node.node_id));
        setNode(updated);
        toast.push({ tone: "success", title: "节点已启用", description: node.display_name });
      }
      await store.refresh({ silent: true });
    } catch (err) {
      toast.push({
        tone: "error",
        title: "操作失败",
        description: err instanceof Error ? err.message : "未知错误",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveConfig() {
    if (!node) return;
    setSaving(true);
    setEditError(null);
    try {
      const updated = await store.callApi((token) =>
        api.updateNode(token, node.node_id, {
          display_name: editForm.display_name.trim(),
          hostname: editForm.hostname.trim() || null,
          os_type: editForm.os_type,
          heartbeat_interval_sec: Number(editForm.heartbeat_interval_sec),
          allowed_workdirs: editForm.allowed_workdirs
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean),
          tags: editForm.tags
            .split(/[,，]/)
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      );
      setNode(updated);
      setIsEditDirty(false);
      setEditHydratedNodeId(updated.node_id);
      toast.push({ tone: "success", title: "节点配置已更新", description: updated.display_name });
      await store.refresh({ silent: true });
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
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
          <span className={page.eyebrow}>{node.node_id}</span>
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
          </div>
        </div>
        <div className={page.actions}>
          <Button
            variant={node.is_enabled ? "ghost" : "accent"}
            onClick={() => setConfirmToggleOpen(true)}
            disabled={busy}
          >
            {busy ? "处理中…" : node.is_enabled ? "停用节点" : "启用节点"}
          </Button>
        </div>
      </header>

      <ConfirmDialog
        open={confirmToggleOpen}
        title={node.is_enabled ? "确认停用节点" : "确认启用节点"}
        message={
          node.is_enabled
            ? `停用节点 "${node.display_name}" 后，该节点将不再接收新任务，且心跳会被拒绝。`
            : `确定要重新启用节点 "${node.display_name}" 吗？`
        }
        confirmLabel={node.is_enabled ? "停用" : "启用"}
        cancelLabel="取消"
        variant={node.is_enabled ? "danger" : "accent"}
        onConfirm={() => {
          setConfirmToggleOpen(false);
          void handleToggleEnable();
        }}
        onCancel={() => setConfirmToggleOpen(false)}
      />

      {/* Connection slab — primary panel, dominates the page */}
      <ConnectionSlab node={node} />

      <section className={styles.layout}>
        <Card title="节点配置">
          <form className={forms.stack} onSubmit={(event) => { event.preventDefault(); void handleSaveConfig(); }}>
            <div className={forms.row}>
              <label className={forms.field}>
                <span className={forms.label}>显示名</span>
                <input
                  className={forms.input}
                  value={editForm.display_name}
                  onChange={(event) => updateEditForm((prev) => ({ ...prev, display_name: event.target.value }))}
                />
              </label>
              <label className={forms.field}>
                <span className={forms.label}>主机名</span>
                <input
                  className={`${forms.input} ${forms.mono}`}
                  value={editForm.hostname}
                  onChange={(event) => updateEditForm((prev) => ({ ...prev, hostname: event.target.value }))}
                  placeholder="可留空"
                />
              </label>
            </div>

            <div className={forms.row}>
              <label className={forms.field}>
                <span className={forms.label}>OS</span>
                <select
                  className={forms.select}
                  value={editForm.os_type}
                  onChange={(event) => updateEditForm((prev) => ({ ...prev, os_type: event.target.value as OsType }))}
                >
                  <option value="windows">windows</option>
                  <option value="linux">linux</option>
                </select>
              </label>
              <label className={forms.field}>
                <span className={forms.label}>心跳间隔（秒）</span>
                <input
                  className={forms.input}
                  type="number"
                  min={3}
                  max={3600}
                  value={editForm.heartbeat_interval_sec}
                  onChange={(event) =>
                    updateEditForm((prev) => ({ ...prev, heartbeat_interval_sec: Number(event.target.value || 5) }))
                  }
                />
              </label>
            </div>

            <label className={forms.field}>
              <span className={forms.label}>允许的工作目录</span>
              <textarea
                className={forms.textarea}
                rows={4}
                value={editForm.allowed_workdirs}
                onChange={(event) => updateEditForm((prev) => ({ ...prev, allowed_workdirs: event.target.value }))}
              />
            </label>

            <label className={forms.field}>
              <span className={forms.label}>标签</span>
              <input
                className={forms.input}
                value={editForm.tags}
                onChange={(event) => updateEditForm((prev) => ({ ...prev, tags: event.target.value }))}
                placeholder="用逗号分隔"
              />
            </label>

            {editError ? <div className={forms.error}>{editError}</div> : null}

            <div className={forms.actions}>
              <Button type="submit" variant="accent" disabled={saving}>
                {saving ? "保存中…" : "保存配置"}
              </Button>
            </div>
          </form>
        </Card>

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

      <NodeRuntimeBlock card={runtimeCard} />
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
  const pythonEnv = status.python_env as {
    python_version?: string;
    python_executable?: string;
    active_environment_kind?: string;
    active_environment_name?: string;
    supported_backends?: string[];
  };
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
          {pythonEnv.active_environment_kind ? (
            <div className={styles.snapshotPython}>
              active {pythonEnv.active_environment_kind}
              {pythonEnv.active_environment_name ? ` · ${pythonEnv.active_environment_name}` : ""}
            </div>
          ) : null}
          {Array.isArray(pythonEnv.supported_backends) && pythonEnv.supported_backends.length > 0 ? (
            <div className={styles.snapshotPython}>
              backends {pythonEnv.supported_backends.join(", ")}
            </div>
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
