import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../../api";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import { CodeBlock } from "../../ui/CodeBlock";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { EmptyState } from "../../ui/EmptyState";
import { StatusPill } from "../../ui/StatusPill";
import { Button } from "../../ui/Button";
import { Gauge } from "../../ui/Gauge";
import { useToast } from "../../ui/Toast";
import { connectionLabel, connectionTone, onboardingLabel, onboardingTone } from "../../lib/labels";
import { bytesToReadable, formatRelative, formatTime, prettyJson } from "../../lib/format";
import { TaskComposer } from "../tasks/TaskComposer";
import type { NodeResetSecretResponse, NodeResponse, NodeStatusPreview, OsType } from "../../types";
import forms from "../../ui/forms.module.css";
import styles from "./NodeDetailView.module.css";

type Props = { nodeId: string };
type TabKey = "monitor" | "config" | "tasks";

export function NodeDetailView({ nodeId }: Props): JSX.Element {
  const store = useConsoleStore();
  const toast = useToast();
  const storeNode = store.nodes.find((n) => n.node_id === nodeId) ?? null;
  const overviewNode = store.overview?.nodes.find((n) => n.node_id === nodeId) ?? null;
  const [node, setNode] = useState<NodeResponse | null>(storeNode);
  const [latestStatus, setLatestStatus] = useState<NodeStatusPreview | null>(overviewNode?.latest_status ?? null);
  const [tab, setTab] = useState<TabKey>("monitor");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditDirty, setIsEditDirty] = useState(false);
  const [editHydratedNodeId, setEditHydratedNodeId] = useState<string | null>(null);
  const [confirmToggleOpen, setConfirmToggleOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmResetSecretOpen, setConfirmResetSecretOpen] = useState(false);
  const [resetSecretResult, setResetSecretResult] = useState<NodeResetSecretResponse | null>(null);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [editForm, setEditForm] = useState({ display_name: "", hostname: "", os_type: "windows" as OsType, heartbeat_interval_sec: 5, allowed_workdirs: "", tags: "" });

  useEffect(() => { setNode(storeNode); }, [storeNode]);
  useEffect(() => { setLatestStatus(overviewNode?.latest_status ?? null); }, [overviewNode]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [freshNode, status] = await Promise.allSettled([
          store.callApi((t) => api.getNode(t, nodeId)),
          store.callApi((t) => api.getLatestNodeStatus(t, nodeId)),
        ]);
        if (cancelled) return;
        if (freshNode.status === "fulfilled") setNode(freshNode.value);
        if (status.status === "fulfilled") setLatestStatus(status.value);
        else if (status.reason instanceof ApiError && status.reason.status === 404) setLatestStatus(null);
      } catch { /* fallback */ }
    }
    void load();
    return () => { cancelled = true; };
  }, [nodeId, store.callApi]);

  useEffect(() => {
    if (!node) return;
    if (isEditDirty && editHydratedNodeId === node.node_id) return;
    setEditForm({ display_name: node.display_name, hostname: node.hostname ?? "", os_type: node.os_type === "linux" ? "linux" : "windows", heartbeat_interval_sec: node.heartbeat_interval_sec, allowed_workdirs: node.allowed_workdirs.join("\n"), tags: node.tags.join(", ") });
    setEditError(null); setIsEditDirty(false); setEditHydratedNodeId(node.node_id);
  }, [node, isEditDirty, editHydratedNodeId]);

  function updateEdit(fn: (p: typeof editForm) => typeof editForm) { setIsEditDirty(true); setEditForm((p) => fn(p)); }

  const recentTasks = useMemo(() => store.tasks.filter((t) => t.node_id === nodeId).slice(0, 12), [store.tasks, nodeId]);

  if (!node) return <div className={styles.page}><EmptyState title="未找到节点" action={<Button variant="accent" onClick={() => navigate({ name: "fleet" })}>返回</Button>} /></div>;

  async function handleToggle() { if (!node) return; setBusy(true); try { const u = node.is_enabled ? await store.callApi((t) => api.disableNode(t, node.node_id)) : await store.callApi((t) => api.enableNode(t, node.node_id)); setNode(u); toast.push({ tone: node.is_enabled ? "warning" : "success", title: node.is_enabled ? "已停用" : "已启用" }); await store.refresh({ silent: true }); } catch (e) { toast.push({ tone: "error", title: "失败", description: e instanceof Error ? e.message : "" }); } finally { setBusy(false); } }
  async function handleDelete() { if (!node) return; setBusy(true); try { await store.callApi((t) => api.deleteNode(t, node.node_id)); toast.push({ tone: "success", title: "已删除" }); await store.refresh({ silent: true }); navigate({ name: "fleet" }); } catch (e) { toast.push({ tone: "error", title: "失败", description: e instanceof Error ? e.message : "" }); } finally { setBusy(false); } }
  async function handleResetSecret() { if (!node) return; setBusy(true); try { const r = await store.callApi((t) => api.resetNodeSecret(t, node.node_id)); setResetSecretResult(r); toast.push({ tone: "success", title: "密钥已重置" }); } catch (e) { toast.push({ tone: "error", title: "失败", description: e instanceof Error ? e.message : "" }); } finally { setBusy(false); } }
  async function handleSave() { if (!node) return; setSaving(true); setEditError(null); try { const u = await store.callApi((t) => api.updateNode(t, node.node_id, { display_name: editForm.display_name.trim(), hostname: editForm.hostname.trim() || null, os_type: editForm.os_type, heartbeat_interval_sec: Number(editForm.heartbeat_interval_sec), allowed_workdirs: editForm.allowed_workdirs.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), tags: editForm.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })); setNode(u); setIsEditDirty(false); setEditHydratedNodeId(u.node_id); toast.push({ tone: "success", title: "已保存" }); await store.refresh({ silent: true }); } catch (e) { setEditError(e instanceof Error ? e.message : "失败"); } finally { setSaving(false); } }

  const canDispatch = node.is_enabled && node.connection_status === "online" && node.onboarding_status === "connected";
  const cpu = latestStatus?.cpu as { model?: string; logical_cores?: number; usage_percent?: number } | undefined;
  const memory = latestStatus?.memory as { total_bytes?: number; used_bytes?: number; usage_percent?: number } | undefined;
  const pythonEnv = latestStatus?.python_env as { python_version?: string; active_environment_kind?: string; active_environment_name?: string; supported_backends?: string[] } | undefined;
  const gpus = latestStatus?.gpus ?? [];
  const cpuUse = Number(cpu?.usage_percent ?? 0);
  const memUse = Number(memory?.usage_percent ?? (memory?.total_bytes ? ((memory?.used_bytes ?? 0) / memory.total_bytes) * 100 : 0));

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIdent}>
            <h1 className={styles.headerName}>{node.display_name}</h1>
            <span className={styles.headerId}>{node.node_id}</span>
          </div>
          <div className={styles.headerPills}>
            <StatusPill tone={connectionTone[node.connection_status]} label={connectionLabel[node.connection_status]} pulse={node.connection_status === "online"} />
            <StatusPill tone={onboardingTone[node.onboarding_status]} label={onboardingLabel[node.onboarding_status]} />
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button variant="ghost" size="sm" onClick={() => setConfirmResetSecretOpen(true)} disabled={busy}>重置密钥</Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteOpen(true)} disabled={busy}>删除</Button>
          <Button variant={node.is_enabled ? "danger" : "accent"} size="sm" onClick={() => setConfirmToggleOpen(true)} disabled={busy}>{node.is_enabled ? "停用" : "启用"}</Button>
        </div>
      </header>

      {/* Dialogs */}
      <ConfirmDialog open={confirmToggleOpen} title={node.is_enabled ? "停用节点" : "启用节点"} message={node.is_enabled ? "停用后不再接收任务。" : "确认启用？"} confirmLabel="确认" cancelLabel="取消" variant={node.is_enabled ? "danger" : "accent"} onConfirm={() => { setConfirmToggleOpen(false); void handleToggle(); }} onCancel={() => setConfirmToggleOpen(false)} />
      <ConfirmDialog open={confirmDeleteOpen} title="删除节点" message="不可撤销。" confirmLabel="删除" cancelLabel="取消" variant="danger" onConfirm={() => { setConfirmDeleteOpen(false); void handleDelete(); }} onCancel={() => setConfirmDeleteOpen(false)} />
      <ConfirmDialog open={confirmResetSecretOpen} title="重置密钥" message="当前 Agent 将失效。" confirmLabel="重置" cancelLabel="取消" variant="danger" onConfirm={() => { setConfirmResetSecretOpen(false); void handleResetSecret(); }} onCancel={() => setConfirmResetSecretOpen(false)} />

      {resetSecretResult ? (
        <div className={styles.secretPanel}>
          <div className={styles.secretPanelHead}><span className={styles.secretPanelTitle}>新密钥 — 立即复制</span><button type="button" className={styles.secretPanelClose} onClick={() => setResetSecretResult(null)}>✕</button></div>
          <CodeBlock label=".env" value={resetSecretResult.onboarding.env_template} maxHeight={200} />
          <div className={styles.secretPanelHint}>启动：<code>{resetSecretResult.onboarding.startup_command}</code></div>
        </div>
      ) : null}

      {/* Tab bar */}
      <div className={styles.tabBar}>
        <button type="button" className={`${styles.tab}${tab === "monitor" ? ` ${styles.tabActive}` : ""}`} onClick={() => setTab("monitor")}>监控</button>
        <button type="button" className={`${styles.tab}${tab === "config" ? ` ${styles.tabActive}` : ""}`} onClick={() => setTab("config")}>配置</button>
        <button type="button" className={`${styles.tab}${tab === "tasks" ? ` ${styles.tabActive}` : ""}`} onClick={() => setTab("tasks")}>任务</button>
      </div>

      {/* Tab content */}
      {tab === "monitor" ? <MonitorTab cpu={cpu} memory={memory} pythonEnv={pythonEnv} gpus={gpus} cpuUse={cpuUse} memUse={memUse} latestStatus={latestStatus} showSnapshot={showSnapshot} setShowSnapshot={setShowSnapshot} /> : null}
      {tab === "config" ? <ConfigTab node={node} editForm={editForm} updateEdit={updateEdit} editError={editError} saving={saving} handleSave={handleSave} /> : null}
      {tab === "tasks" ? <TasksTab node={node} canDispatch={canDispatch} recentTasks={recentTasks} /> : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
 * MONITOR TAB
 * ═══════════════════════════════════════════════════════════════ */

function MonitorTab({ cpu, memory, pythonEnv, gpus, cpuUse, memUse, latestStatus, showSnapshot, setShowSnapshot }: {
  cpu: { model?: string; logical_cores?: number; usage_percent?: number } | undefined;
  memory: { total_bytes?: number; used_bytes?: number; usage_percent?: number } | undefined;
  pythonEnv: { python_version?: string; active_environment_kind?: string; active_environment_name?: string; supported_backends?: string[] } | undefined;
  gpus: Array<Record<string, unknown>>;
  cpuUse: number; memUse: number;
  latestStatus: NodeStatusPreview | null;
  showSnapshot: boolean; setShowSnapshot: (v: boolean) => void;
}): JSX.Element {
  if (!latestStatus) return <div className={styles.noData}>等待节点首次心跳上报运行时数据</div>;

  return (
    <>
      <div className={styles.monitorGrid}>
        {/* Left: CPU + Memory */}
        <div className={styles.cpuPanel}>
          <div className={styles.gaugeRow}>
            <Gauge value={cpuUse} label="CPU" size={100} thickness={6} />
            <Gauge value={memUse} label="MEM" size={100} thickness={6} tone="indigo" />
          </div>
          <div className={styles.cpuDetail}>
            <div className={styles.cpuModel}>{cpu?.model ?? "—"}</div>
            <div className={styles.cpuMeta}>{cpu?.logical_cores ?? "—"} cores · {bytesToReadable(memory?.used_bytes)} / {bytesToReadable(memory?.total_bytes)}</div>
            {pythonEnv?.python_version ? <div className={styles.cpuSub}>Python {pythonEnv.python_version}</div> : null}
            {pythonEnv?.active_environment_kind ? <div className={styles.cpuSub}>{pythonEnv.active_environment_kind}{pythonEnv.active_environment_name ? ` · ${pythonEnv.active_environment_name}` : ""}</div> : null}
            {Array.isArray(pythonEnv?.supported_backends) && pythonEnv.supported_backends.length > 0 ? <div className={styles.cpuSub}>backends: {pythonEnv.supported_backends.join(", ")}</div> : null}
          </div>
          <div className={styles.reportedAt}>上报于 {formatRelative(latestStatus.reported_at)}</div>
        </div>

        {/* Right: GPUs */}
        <div className={styles.gpuPanel}>
          <div className={styles.gpuPanelTitle}>GPU ({gpus.length})</div>
          {gpus.length === 0 ? <div className={styles.noData}>无 GPU</div> : gpus.map((gpu, idx) => {
            const g = gpu as Record<string, unknown>;
            const used = Number(g.used_vram_mb ?? 0);
            const total = Number(g.total_vram_mb ?? 0);
            const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
            const util = Number(g.utilization_percent ?? 0);
            const fillCls = pct >= 90 ? `${styles.gpuBarFill} ${styles.gpuBarFillAlert}` : pct >= 75 ? `${styles.gpuBarFill} ${styles.gpuBarFillWarm}` : styles.gpuBarFill;
            return (
              <div key={idx} className={styles.gpuCard}>
                <div className={styles.gpuCardHeader}>
                  <span className={styles.gpuCardName}>{String(g.model ?? `GPU ${idx}`)}</span>
                  <span className={styles.gpuCardIndex}>#{String(g.index ?? idx)}</span>
                </div>
                <div className={styles.gpuCardStats}>
                  <div className={styles.gpuStat}>
                    <span className={styles.gpuStatLabel}>利用率</span>
                    <span className={styles.gpuStatValue}>{util}%</span>
                  </div>
                  <div className={styles.gpuStat}>
                    <span className={styles.gpuStatLabel}>显存</span>
                    <span className={styles.gpuStatValue}>{pct}%</span>
                    <span className={styles.gpuStatSub}>{used} / {total} MB</span>
                  </div>
                </div>
                <div className={styles.gpuBar}><div className={fillCls} style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.snapshotArea}>
        <button type="button" className={styles.snapshotToggle} onClick={() => setShowSnapshot(!showSnapshot)}>
          {showSnapshot ? "▾ 收起原始数据" : "▸ 查看原始 JSON"}
        </button>
        {showSnapshot ? <CodeBlock label="snapshot.json" value={prettyJson(latestStatus)} maxHeight={400} /> : null}
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
 * CONFIG TAB
 * ═══════════════════════════════════════════════════════════════ */

function ConfigTab({ node, editForm, updateEdit, editError, saving, handleSave }: {
  node: NodeResponse;
  editForm: { display_name: string; hostname: string; os_type: OsType; heartbeat_interval_sec: number; allowed_workdirs: string; tags: string };
  updateEdit: (fn: (p: typeof editForm) => typeof editForm) => void;
  editError: string | null; saving: boolean; handleSave: () => void;
}): JSX.Element {
  const firstContact = !!node.first_seen_at;
  const live = node.connection_status === "online";
  const guardLabel = !node.is_enabled ? "DISABLED" : node.connection_status === "offline" ? "OFFLINE" : node.onboarding_status === "awaiting_first_heartbeat" ? "AWAITING HEARTBEAT" : null;
  const guardTone = !node.is_enabled ? "danger" : "warn";

  return (
    <div className={styles.configLayout}>
      {/* Left: status info */}
      <div className={styles.configSection}>
        <h3 className={styles.configSectionTitle}>连接状态</h3>

        <div className={styles.connSteps}>
          <ConnStep label="PROVISIONED" value={node.node_id} state="done" />
          <ConnStep label="FIRST CONTACT" value={node.first_seen_at ? formatRelative(node.first_seen_at) : "—"} state={firstContact ? "done" : "active"} mute={!firstContact} />
          <ConnStep label="HEARTBEAT" value={node.last_seen_at ? formatRelative(node.last_seen_at) : "—"} state={live ? "active" : node.connection_status === "offline" ? "fail" : "idle"} mute={!node.last_seen_at} />
        </div>

        <div className={styles.infoTable}>
          <InfoCell label="心跳间隔" value={`${node.heartbeat_interval_sec}s`} />
          <InfoCell label="启用" value={node.is_enabled ? "是" : "否"} />
          <InfoCell label="主机名" value={node.hostname ?? "—"} mono />
          <InfoCell label="首次心跳" value={node.first_seen_at ? formatTime(node.first_seen_at) : "—"} />
          <InfoCell label="最近心跳" value={node.last_seen_at ? formatTime(node.last_seen_at) : "—"} />
          <InfoCell label="登记时间" value={formatTime(node.created_at)} />
        </div>

        {guardLabel ? <div className={`${styles.guard} ${guardTone === "danger" ? styles.guardDanger : styles.guardWarn}`}><span>{guardLabel}</span></div> : null}

        {node.tags.length > 0 ? <div className={styles.metaRow}>{node.tags.map((t) => <span key={t} className={styles.metaTag}>{t}</span>)}</div> : null}
        {node.allowed_workdirs.length > 0 ? <div className={styles.metaRow}>{node.allowed_workdirs.map((d) => <span key={d} className={styles.metaPath}>{d}</span>)}</div> : null}
      </div>

      {/* Right: edit form */}
      <div className={styles.configSection}>
        <h3 className={styles.configSectionTitle}>编辑配置</h3>
        <form className={forms.stack} onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
          <div className={forms.row}>
            <label className={forms.field}><span className={forms.label}>显示名</span><input className={forms.input} value={editForm.display_name} onChange={(e) => updateEdit((p) => ({ ...p, display_name: e.target.value }))} /></label>
            <label className={forms.field}><span className={forms.label}>主机名</span><input className={`${forms.input} ${forms.mono}`} value={editForm.hostname} onChange={(e) => updateEdit((p) => ({ ...p, hostname: e.target.value }))} /></label>
          </div>
          <div className={forms.row}>
            <label className={forms.field}><span className={forms.label}>OS</span><select className={forms.select} value={editForm.os_type} onChange={(e) => updateEdit((p) => ({ ...p, os_type: e.target.value as OsType }))}><option value="windows">windows</option><option value="linux">linux</option></select></label>
            <label className={forms.field}><span className={forms.label}>心跳（秒）</span><input className={forms.input} type="number" min={3} max={3600} value={editForm.heartbeat_interval_sec} onChange={(e) => updateEdit((p) => ({ ...p, heartbeat_interval_sec: Number(e.target.value || 5) }))} /></label>
          </div>
          <label className={forms.field}><span className={forms.label}>工作目录</span><textarea className={forms.textarea} rows={3} value={editForm.allowed_workdirs} onChange={(e) => updateEdit((p) => ({ ...p, allowed_workdirs: e.target.value }))} /></label>
          <label className={forms.field}><span className={forms.label}>标签</span><input className={forms.input} value={editForm.tags} onChange={(e) => updateEdit((p) => ({ ...p, tags: e.target.value }))} placeholder="逗号分隔" /></label>
          {editError ? <div className={forms.error}>{editError}</div> : null}
          <div className={forms.actions}><Button type="submit" variant="accent" size="sm" disabled={saving}>{saving ? "保存中…" : "保存"}</Button></div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
 * TASKS TAB
 * ═══════════════════════════════════════════════════════════════ */

function TasksTab({ node, canDispatch, recentTasks }: {
  node: NodeResponse; canDispatch: boolean;
  recentTasks: ReturnType<typeof useConsoleStore>["tasks"];
}): JSX.Element {
  return (
    <div className={styles.tasksLayout}>
      <div className={styles.tasksSection}>
        <h3 className={styles.tasksSectionTitle}>下发任务</h3>
        {!canDispatch ? <div className={styles.tasksEmpty}>{dispatchGuard(node)}</div> : <TaskComposer node={node} />}
      </div>
      <div className={styles.tasksSection}>
        <h3 className={styles.tasksSectionTitle}>
          <span>最近任务</span>
          <Button size="sm" variant="quiet" onClick={() => navigate({ name: "tasks" })}>全部</Button>
        </h3>
        {recentTasks.length === 0 ? <div className={styles.tasksEmpty}>暂无任务</div> : (
          <ul className={styles.tasksList}>
            {recentTasks.map((task) => (
              <li key={task.task_id}>
                <button type="button" className={styles.taskRow} onClick={() => navigate({ name: "task-detail", taskId: task.task_id })}>
                  <span className={styles.taskRowId}>{task.task_id}</span>
                  <span className={styles.taskRowType}>{task.type}</span>
                  <StatusPill tone="muted" label={task.status} subtle />
                  <span className={styles.taskRowTime}>{formatRelative(task.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ─── Shared sub-components ─── */

function ConnStep({ label, value, state, mute }: { label: string; value: string; state: "idle" | "active" | "done" | "fail"; mute?: boolean }): JSX.Element {
  const cls = [styles.connStep, state === "done" ? styles.connStepDone : "", state === "active" ? styles.connStepActive : "", state === "fail" ? styles.connStepFail : ""].filter(Boolean).join(" ");
  return <div className={cls}><span className={styles.connDot} /><div className={styles.connText}><span className={styles.connLabel}>{label}</span><span className={`${styles.connValue}${mute ? ` ${styles.connValueMute}` : ""}`}>{value}</span></div></div>;
}

function InfoCell({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return <div className={styles.infoCell}><div className={styles.infoCellLabel}>{label}</div><div className={`${styles.infoCellValue}${mono ? ` ${styles.infoCellMono}` : ""}`}>{value}</div></div>;
}

function dispatchGuard(node: NodeResponse): string {
  if (!node.is_enabled) return "节点已停用";
  if (node.onboarding_status === "awaiting_first_heartbeat") return "尚未接入";
  if (node.connection_status === "offline") return "节点离线";
  return "不可用";
}
