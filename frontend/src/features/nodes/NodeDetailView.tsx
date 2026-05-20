import { useEffect, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
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
import type { NodeResetSecretResponse, NodeResponse, NodeStatusHistoryItem, NodeStatusPreview, OsType } from "../../types";
import forms from "../../ui/forms.module.css";

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

type Props = { nodeId: string };
type TabKey = "monitor" | "config" | "tasks";
type CpuSnapshot = {
  model?: string;
  logical_cores?: number;
  physical_cores?: number;
  usage_percent?: number;
  current_clock_mhz?: number;
  max_clock_mhz?: number;
  per_core_percent?: number[];
};
type MemorySnapshot = {
  total_bytes?: number;
  used_bytes?: number;
  usage_percent?: number;
  available_bytes?: number;
  cached_bytes?: number;
  commit_used_bytes?: number;
  commit_limit_bytes?: number;
  paged_pool_bytes?: number;
  nonpaged_pool_bytes?: number;
  speed_mtps?: number;
  slots_used?: number;
  slots_total?: number;
  form_factor?: string;
  memory_type?: string;
  installed_bytes?: number;
  hardware_reserved_bytes?: number;
};
type GpuSnapshot = {
  index?: number;
  model?: string;
  total_vram_mb?: number;
  used_vram_mb?: number;
  utilization_percent?: number;
  encoder_utilization_percent?: number;
  decoder_utilization_percent?: number;
  temperature_c?: number;
  power_draw_w?: number;
  power_limit_w?: number;
  clock_graphics_mhz?: number;
  clock_max_graphics_mhz?: number;
  clock_video_mhz?: number;
  fan_speed_percent?: number;
  pcie_gen?: number;
  pcie_width?: number;
  encoder_sessions?: number;
  decoder_sessions?: number;
};
type NvidiaSnapshot = {
  driver_version?: string;
  cuda_version?: string;
  nvcc_version?: string;
  nvidia_smi_path?: string;
};
type NetworkSnapshot = {
  adapter_name?: string;
  interface_description?: string;
  link_speed?: string;
  mac_address?: string;
  ipv4_address?: string;
  ipv6_address?: string;
  ssid?: string;
  signal?: string;
  radio_type?: string;
  tx_bytes_per_sec?: number;
  rx_bytes_per_sec?: number;
};

function availabilityText(value: string | number | null | undefined, fallback = "N/A"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function bytesPerSecondToReadable(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB/s`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`;
  return `${value.toFixed(0)} B/s`;
}

// Premium card style matching reference
const cardCls = "rounded-xl p-5 transition-all duration-300 bg-[linear-gradient(180deg,rgba(16,18,23,0.95)_0%,rgba(10,11,14,0.98)_100%)] border border-white/[0.04] shadow-[0_4px_20px_-2px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:border-white/[0.08]";
const inputCls = "w-full bg-[rgba(5,5,7,0.8)] border border-white/5 rounded-md px-3 py-2 text-xs text-white outline-none focus:bg-[rgba(10,11,14,0.95)] focus:border-cyan-500/50 focus:shadow-[0_0_0_2px_rgba(6,182,212,0.1)] transition-all font-mono";
const labelCls = "text-[11px] font-mono text-gray-400";
const badgeCls = "px-2.5 py-0.5 text-xs font-mono font-medium border rounded-md flex items-center gap-1.5";

const beijingTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai",
});

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
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [resetResult, setResetResult] = useState<NodeResetSecretResponse | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [editForm, setEditForm] = useState({ display_name: "", hostname: "", os_type: "windows" as OsType, heartbeat_interval_sec: 5, allowed_workdirs: "", tags: "" });

  useEffect(() => { setNode(storeNode); }, [storeNode]);
  useEffect(() => { setLatestStatus(overviewNode?.latest_status ?? null); }, [overviewNode]);
  useEffect(() => { let c = false; (async () => { try { const [n, s] = await Promise.allSettled([store.callApi((t) => api.getNode(t, nodeId)), store.callApi((t) => api.getLatestNodeStatus(t, nodeId))]); if (c) return; if (n.status === "fulfilled") setNode(n.value); if (s.status === "fulfilled") setLatestStatus(s.value); else if (s.reason instanceof ApiError && s.reason.status === 404) setLatestStatus(null); } catch {} })(); return () => { c = true; }; }, [nodeId, store.callApi]);
  useEffect(() => { if (!node) return; if (isEditDirty && editHydratedNodeId === node.node_id) return; setEditForm({ display_name: node.display_name, hostname: node.hostname ?? "", os_type: node.os_type === "linux" ? "linux" : "windows", heartbeat_interval_sec: node.heartbeat_interval_sec, allowed_workdirs: node.allowed_workdirs.join("\n"), tags: node.tags.join(", ") }); setEditError(null); setIsEditDirty(false); setEditHydratedNodeId(node.node_id); }, [node, isEditDirty, editHydratedNodeId]);

  function updateEdit(fn: (p: typeof editForm) => typeof editForm) { setIsEditDirty(true); setEditForm((p) => fn(p)); }
  const recentTasks = useMemo(() => store.tasks.filter((t) => t.node_id === nodeId).slice(0, 10), [store.tasks, nodeId]);

  if (!node) return <div className="py-20 text-center text-gray-500"><EmptyState title="未找到节点" action={<Button variant="accent" onClick={() => navigate({ name: "fleet" })}>返回</Button>} /></div>;

  async function handleToggle() { if (!node) return; setBusy(true); try { const u = node.is_enabled ? await store.callApi((t) => api.disableNode(t, node.node_id)) : await store.callApi((t) => api.enableNode(t, node.node_id)); setNode(u); toast.push({ tone: node.is_enabled ? "warning" : "success", title: node.is_enabled ? "已停用" : "已启用" }); await store.refresh({ silent: true }); } catch (e) { toast.push({ tone: "error", title: "失败", description: e instanceof Error ? e.message : "" }); } finally { setBusy(false); } }
  async function handleDelete() { if (!node) return; setBusy(true); try { await store.callApi((t) => api.deleteNode(t, node.node_id)); toast.push({ tone: "success", title: "已删除" }); await store.refresh({ silent: true }); navigate({ name: "fleet" }); } catch (e) { toast.push({ tone: "error", title: "失败" }); } finally { setBusy(false); } }
  async function handleReset() { if (!node) return; setBusy(true); try { const r = await store.callApi((t) => api.resetNodeSecret(t, node.node_id)); setResetResult(r); toast.push({ tone: "success", title: "密钥已重置" }); } catch (e) { toast.push({ tone: "error", title: "失败" }); } finally { setBusy(false); } }
  async function handleSave() { if (!node) return; setSaving(true); setEditError(null); try { const u = await store.callApi((t) => api.updateNode(t, node.node_id, { display_name: editForm.display_name.trim(), hostname: editForm.hostname.trim() || null, os_type: editForm.os_type, heartbeat_interval_sec: Number(editForm.heartbeat_interval_sec), allowed_workdirs: editForm.allowed_workdirs.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), tags: editForm.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })); setNode(u); setIsEditDirty(false); setEditHydratedNodeId(u.node_id); toast.push({ tone: "success", title: "已保存" }); await store.refresh({ silent: true }); } catch (e) { setEditError(e instanceof Error ? e.message : "失败"); } finally { setSaving(false); } }

  const canDispatch = node.is_enabled && node.connection_status === "online" && node.onboarding_status === "connected";
  const cpu = latestStatus?.cpu as CpuSnapshot | undefined;
  const memory = latestStatus?.memory as MemorySnapshot | undefined;
  const pythonEnv = latestStatus?.python_env as { python_version?: string; active_environment_kind?: string; active_environment_name?: string; supported_backends?: string[] } | undefined;
  const gpus = latestStatus?.gpus ?? [];
  const cpuUse = Number(cpu?.usage_percent ?? 0);
  const memUse = Number(memory?.usage_percent ?? (memory?.total_bytes ? ((memory?.used_bytes ?? 0) / memory.total_bytes) * 100 : 0));

  return (
    <div className="max-w-[1300px] mx-auto space-y-6">
      {/* Dialogs */}
      <ConfirmDialog open={confirmToggleOpen} title={node.is_enabled ? "停用节点" : "启用节点"} message={node.is_enabled ? "停用后不再接收任务。" : "确认启用？"} confirmLabel="确认" cancelLabel="取消" variant={node.is_enabled ? "danger" : "accent"} onConfirm={() => { setConfirmToggleOpen(false); void handleToggle(); }} onCancel={() => setConfirmToggleOpen(false)} />
      <ConfirmDialog open={confirmDeleteOpen} title="删除节点" message="不可撤销。" confirmLabel="删除" cancelLabel="取消" variant="danger" onConfirm={() => { setConfirmDeleteOpen(false); void handleDelete(); }} onCancel={() => setConfirmDeleteOpen(false)} />
      <ConfirmDialog open={confirmResetOpen} title="重置密钥" message="当前 Agent 将失效。" confirmLabel="重置" cancelLabel="取消" variant="danger" onConfirm={() => { setConfirmResetOpen(false); void handleReset(); }} onCancel={() => setConfirmResetOpen(false)} />

      {resetResult ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden">
          <div className="px-5 py-3 border-b border-red-500/20 flex justify-between items-center"><span className="text-xs font-bold text-red-400">新密钥 — 立即复制</span><button type="button" onClick={() => setResetResult(null)} className="text-red-400 hover:text-white">✕</button></div>
          <div className="p-4"><CodeBlock label=".env" value={resetResult.onboarding.env_template} maxHeight={200} /></div>
        </div>
      ) : null}

      {/* Node Meta Banner — TALL */}
      <div className={`${cardCls} overflow-hidden relative py-7 px-6`}>
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-[radial-gradient(ellipse_at_right,_var(--tw-gradient-stops))] from-cyan-950/20 to-transparent pointer-events-none" />
        <div className="flex justify-between items-center relative z-10">
          <div className="flex items-start gap-5">
            <div className="w-14 h-14 rounded-xl bg-[#0F1116] border border-white/5 flex items-center justify-center relative">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-400"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>
              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-[#07080A] rounded-full flex items-center justify-center"><div className="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_8px_#10b981]" /></div>
            </div>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold tracking-tight text-white">{node.display_name}</h1>
                <StatusPill tone={connectionTone[node.connection_status]} label={connectionLabel[node.connection_status]} pulse={node.connection_status === "online"} />
                <StatusPill tone={onboardingTone[node.onboarding_status]} label={onboardingLabel[node.onboarding_status]} />
              </div>
              <div className="flex items-center gap-5 text-[12px] text-gray-500">
                <span className="font-mono">{node.node_id}</span>
                <span>{node.hostname ?? "—"}</span>
                <span>心跳 {node.heartbeat_interval_sec}s</span>
                {node.last_seen_at ? <span>最近 {formatRelative(node.last_seen_at)}</span> : null}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmResetOpen(true)} disabled={busy} className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white text-[12px] font-medium rounded-lg transition-all disabled:opacity-40">重置密钥</button>
            <button type="button" onClick={() => setConfirmDeleteOpen(true)} disabled={busy} className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white text-[12px] font-medium rounded-lg transition-all disabled:opacity-40">删除</button>
            <button type="button" onClick={() => setConfirmToggleOpen(true)} disabled={busy} className="px-4 py-2 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 text-[12px] font-medium rounded-lg transition-all disabled:opacity-40">{node.is_enabled ? "停用节点" : "启用节点"}</button>
          </div>
        </div>
      </div>

      {/* Tab bar — full width */}
      <div className="flex gap-2 bg-[#090A0D] border border-white/5 p-1.5 rounded-lg">
        {([["monitor", "硬件监控 Monitor"], ["config", "环境配置 Env Config"], ["tasks", "任务调度 Dispatch"]] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`flex-1 text-center py-2.5 px-4 text-[13px] font-bold rounded-md transition-all ${tab === id ? "bg-white/10 text-white shadow-md" : "text-gray-400 hover:text-white"}`}>{label}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "monitor" ? <TabMonitor nodeId={nodeId} cpu={cpu} memory={memory} pythonEnv={pythonEnv} gpus={gpus} cpuUse={cpuUse} memUse={memUse} latestStatus={latestStatus} showJson={showJson} setShowJson={setShowJson} /> : null}
      {tab === "config" ? <TabConfig node={node} editForm={editForm} updateEdit={updateEdit} editError={editError} saving={saving} handleSave={handleSave} /> : null}
      {tab === "tasks" ? <TabTasks node={node} canDispatch={canDispatch} recentTasks={recentTasks} /> : null}
    </div>
  );
}


/* ═══ MONITOR TAB — nvitop-density hardware panel ═══ */
function TabMonitor({ nodeId, cpu, memory, pythonEnv, gpus, cpuUse, memUse, latestStatus, showJson, setShowJson }: {
  nodeId: string;
  cpu: CpuSnapshot | undefined; memory: MemorySnapshot | undefined; pythonEnv: any; gpus: GpuSnapshot[]; cpuUse: number; memUse: number;
  latestStatus: NodeStatusPreview | null; showJson: boolean; setShowJson: (v: boolean) => void;
}): JSX.Element {
  const { callApi } = useConsoleStore();
  const [historyItems, setHistoryItems] = useState<NodeStatusHistoryItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function fetchHistory() {
      try {
        const res = await callApi((token) => api.getNodeStatusHistory(token, nodeId, 60));
        if (!cancelled) setHistoryItems(res.items);
      } catch {
        // silently ignore — history is best-effort
      }
    }
    void fetchHistory();
    const id = window.setInterval(() => { void fetchHistory(); }, 5000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [callApi, nodeId]);

  const cpuHistoryOption = useMemo(() => ({
    tooltip: { trigger: "axis" as const, backgroundColor: "#0d1117", borderColor: "rgba(255,255,255,0.05)", textStyle: { color: "#c9d1d9", fontSize: 11 }, formatter: (params: any[]) => `CPU ${params[0]?.value ?? 0}%` },
    grid: { left: 36, right: 8, top: 8, bottom: 20 },
    xAxis: { type: "category" as const, data: historyItems.map((it) => beijingTimeFormatter.format(new Date(it.reported_at))), axisLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } }, axisLabel: { color: "#4a5568", fontSize: 9, interval: Math.max(0, Math.floor(historyItems.length / 6) - 1) } },
    yAxis: { type: "value" as const, min: 0, max: 100, splitLine: { lineStyle: { color: "rgba(255,255,255,0.03)" } }, axisLabel: { color: "#4a5568", fontSize: 9, formatter: "{value}%" } },
    series: [{ type: "line" as const, smooth: true, symbol: "none", connectNulls: false, lineStyle: { color: "#06b6d4", width: 1.5 }, areaStyle: { color: { type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(6,182,212,0.15)" }, { offset: 1, color: "rgba(6,182,212,0)" }] } }, data: historyItems.map((it) => it.cpu_usage_percent) }],
  }), [historyItems]);

  if (!latestStatus) return <div className="py-20 text-center text-gray-500">等待节点首次心跳上报</div>;

  const coreCount = cpu?.logical_cores ?? 8;
  const physicalCoreCount = cpu?.physical_cores ?? null;
  const currentClock = cpu?.current_clock_mhz ?? null;
  const maxClock = cpu?.max_clock_mhz ?? null;
  const perCore = Array.isArray(cpu?.per_core_percent) ? cpu.per_core_percent : [];
  const memTotal = memory?.total_bytes ?? 0;
  const memUsed = memory?.used_bytes ?? 0;
  const nvidia = (latestStatus.nvidia ?? {}) as NvidiaSnapshot;
  const network = ((latestStatus.extra ?? {}) as { network?: NetworkSnapshot }).network;
  const memAvailable = memory?.available_bytes ?? null;
  const memCached = memory?.cached_bytes ?? null;
  const memCommitUsed = memory?.commit_used_bytes ?? null;
  const memCommitLimit = memory?.commit_limit_bytes ?? null;
  const pagedPool = memory?.paged_pool_bytes ?? null;
  const nonpagedPool = memory?.nonpaged_pool_bytes ?? null;
  const memSpeed = memory?.speed_mtps ?? null;
  const slotsUsed = memory?.slots_used ?? null;
  const slotsTotal = memory?.slots_total ?? null;
  const formFactor = memory?.form_factor ?? null;
  const memoryType = memory?.memory_type ?? null;
  const hardwareReserved = memory?.hardware_reserved_bytes ?? null;

  return (
    <div className="space-y-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(420px,0.95fr)]">
        <section className={`${cardCls} space-y-6`}>
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-2">
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-500">System Processor</p>
              <h3 className="text-[24px] font-bold leading-tight text-white">{cpu?.model ?? "Unknown CPU"}</h3>
              <p className="text-[13px] text-gray-500">
                {physicalCoreCount ? `${physicalCoreCount} physical / ` : ""}
                {coreCount} logical cores
              </p>
            </div>
            <div className="min-w-[180px] rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.08] px-5 py-4">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-300/70">CPU Load</div>
              <div className="mt-2 flex items-end gap-3">
                <span className="text-5xl font-bold font-mono leading-none text-cyan-300">{Math.round(cpuUse)}</span>
                <span className="pb-1 text-lg font-mono text-cyan-300/70">%</span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-sky-400 transition-all" style={{ width: `${cpuUse}%` }} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-[11px] font-mono">
                <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                  <div className="text-gray-500">Current</div>
                  <div className="mt-1 text-white">{currentClock != null ? `${currentClock} MHz` : "—"}</div>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                  <div className="text-gray-500">Max</div>
                  <div className="mt-1 text-white">{maxClock != null ? `${maxClock} MHz` : "—"}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.04] bg-[#0b0d11] px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-gray-500">CPU History</span>
              <span className="text-[11px] font-mono text-gray-600">{formatRelative(latestStatus.reported_at)}</span>
            </div>
            {historyItems.length > 0 ? (
              <ReactEChartsCore echarts={echarts} option={cpuHistoryOption} style={{ height: 110 }} opts={{ renderer: "canvas" }} />
            ) : (
              <div className="flex h-[110px] items-center justify-center text-[11px] font-mono text-gray-600">等待历史数据…</div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCell label="Physical" value={physicalCoreCount != null ? String(physicalCoreCount) : "—"} />
            <MetricCell label="Logical" value={String(coreCount)} />
            <MetricCell label="RAM" value={bytesToReadable(memTotal)} />
            <MetricCell label="Backends" value={pythonEnv?.supported_backends ? String(pythonEnv.supported_backends.length) : "—"} />
          </div>

          {perCore.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-gray-500">Per-Core Usage</span>
                <span className="text-[11px] font-mono text-gray-600">{perCore.length} threads sampled</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
                {perCore.map((value: number, idx: number) => {
                  const pct = Math.max(0, Math.min(100, Math.round(value)));
                  return (
                    <div key={idx} className="rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2.5">
                      <div className="mb-2 flex items-center justify-between text-[10px] font-mono">
                        <span className="text-gray-500">C{idx}</span>
                        <span className="text-white/80">{pct}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                        <div
                          className={`h-full rounded-full ${pct >= 85 ? "bg-red-500" : pct >= 50 ? "bg-cyan-400" : "bg-emerald-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>

        <section className={`${cardCls} space-y-6`}>
          <div className="rounded-[28px] border border-cyan-500/12 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-500">Memory Fabric</p>
                <h3 className="mt-1 text-[18px] font-bold text-white">{bytesToReadable(memUsed)} / {bytesToReadable(memTotal)}</h3>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-500">Pressure</div>
                <div className="mt-1 text-4xl font-bold font-mono text-cyan-300">{Math.round(memUse)}<span className="ml-1 text-lg text-cyan-300/70">%</span></div>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              <div className="h-3 overflow-hidden rounded-full bg-black/30">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-400 to-emerald-400 transition-all" style={{ width: `${memUse}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-3 text-[11px] font-mono">
                <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-2">
                  <div className="text-gray-500">Available</div>
                  <div className="mt-1 text-white">{memAvailable != null ? bytesToReadable(memAvailable) : "—"}</div>
                </div>
                <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-2">
                  <div className="text-gray-500">Cached</div>
                  <div className="mt-1 text-white">{memCached != null ? bytesToReadable(memCached) : "—"}</div>
                </div>
                <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-2">
                  <div className="text-gray-500">Reserved</div>
                  <div className="mt-1 text-white">{hardwareReserved != null ? bytesToReadable(hardwareReserved) : "—"}</div>
                </div>
              </div>
            </div>
          </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCell label="Commit" value={memCommitUsed != null && memCommitLimit != null ? `${bytesToReadable(memCommitUsed)} / ${bytesToReadable(memCommitLimit)}` : "—"} />
              <MetricCell label="Paged Pool" value={pagedPool != null ? bytesToReadable(pagedPool) : "—"} />
              <MetricCell label="Nonpaged" value={nonpagedPool != null ? bytesToReadable(nonpagedPool) : "—"} />
              <MetricCell label="Speed" value={memSpeed != null ? `${memSpeed} MT/s` : "—"} />
              <MetricCell label="Slots" value={slotsUsed != null ? `${slotsUsed}/${slotsTotal ?? "?"}` : "—"} />
              <MetricCell label="Form" value={formFactor && memoryType ? `${formFactor} · ${memoryType}` : (formFactor ?? memoryType ?? "—")} />
            </div>

          <div className="rounded-2xl border border-white/[0.04] bg-[#0b0d11] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-gray-500">Network Link</p>
                <h4 className="mt-1 text-[15px] font-bold text-white">{network?.adapter_name ?? "Disconnected"}</h4>
              </div>
              <div className="text-right text-[11px] font-mono">
                <div className="text-cyan-400">{availabilityText(network?.ssid, "Wired / Hidden")}</div>
                <div className="mt-1 text-gray-500">{availabilityText(network?.link_speed)}</div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] px-4 py-3">
                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500">Upload</div>
                <div className="mt-2 text-2xl font-bold font-mono text-white">{bytesPerSecondToReadable(network?.tx_bytes_per_sec)}</div>
              </div>
              <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] px-4 py-3">
                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500">Download</div>
                <div className="mt-2 text-2xl font-bold font-mono text-white">{bytesPerSecondToReadable(network?.rx_bytes_per_sec)}</div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <MetricCell label="Radio" value={availabilityText(network?.radio_type)} />
              <MetricCell label="Signal" value={availabilityText(network?.signal)} />
              <MetricCell label="IPv4" value={availabilityText(network?.ipv4_address)} />
              <MetricCell label="IPv6" value={availabilityText(network?.ipv6_address)} />
            </div>
          </div>

          {pythonEnv?.python_version ? (
            <div className="flex items-center justify-between rounded-2xl border border-white/[0.04] bg-white/[0.02] px-4 py-3 text-[12px]">
              <span className="font-mono text-cyan-400">Python {pythonEnv.python_version}</span>
              <span className="text-gray-500">{pythonEnv.active_environment_kind ? `${pythonEnv.active_environment_kind}${pythonEnv.active_environment_name ? ` · ${pythonEnv.active_environment_name}` : ""}` : "runtime"}</span>
            </div>
          ) : null}
        </section>
      </div>

      {/* GPUs — flat section, no individual card wrappers */}
      {gpus.length === 0 ? (
        <div className="py-10 text-center text-gray-600 text-[13px]">无 GPU 设备检测到</div>
      ) : (
        <div className="space-y-6">
          {gpus.map((gpu, idx) => {
        const g = gpu as GpuSnapshot;
        const used = Number(g.used_vram_mb ?? 0);
        const total = Number(g.total_vram_mb ?? 0);
        const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
        const util = Number(g.utilization_percent ?? 0);
        const temp = g.temperature_c != null ? Number(g.temperature_c) : null;
        const powerDraw = g.power_draw_w != null ? Number(g.power_draw_w) : null;
        const powerLimit = g.power_limit_w != null ? Number(g.power_limit_w) : null;
        const clockCur = g.clock_graphics_mhz != null ? Number(g.clock_graphics_mhz) : null;
        const clockMax = g.clock_max_graphics_mhz != null ? Number(g.clock_max_graphics_mhz) : null;
        const clockVideo = g.clock_video_mhz != null ? Number(g.clock_video_mhz) : null;
        const fan = g.fan_speed_percent != null ? Number(g.fan_speed_percent) : null;
        const pcieGen = g.pcie_gen != null ? Number(g.pcie_gen) : null;
        const pcieWidth = g.pcie_width != null ? Number(g.pcie_width) : null;
        const encoderUtil = g.encoder_utilization_percent != null ? Number(g.encoder_utilization_percent) : null;
        const decoderUtil = g.decoder_utilization_percent != null ? Number(g.decoder_utilization_percent) : null;
        const gpuIndex = typeof g.index === "number" ? g.index : idx;

        return (
              <div key={idx} className={`pb-6 ${idx < gpus.length - 1 ? "border-b border-white/5 mb-6" : ""}`}>
                <div className="flex justify-between items-center mb-5">
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] font-mono text-gray-500 uppercase font-bold">GPU #{gpuIndex}</span>
                    <span className="text-[14px] font-bold text-white">{String(g.model ?? "Unknown GPU")}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {pcieGen != null ? <span className="text-[10px] text-gray-500 font-mono">PCIe Gen{pcieGen} x{pcieWidth ?? "?"}</span> : null}
                    <span className="text-[11px] font-mono text-gray-500">{total} MB</span>
                    <span className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded border ${util > 80 ? "bg-red-950/40 text-red-400 border-red-800/30" : util > 30 ? "bg-cyan-950/40 text-cyan-400 border-cyan-800/30" : "bg-emerald-950/40 text-emerald-400 border-emerald-800/30"}`}>{util > 0 ? "Active" : "Idle"}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div><div className="flex justify-between text-[12px] mb-2"><span className="text-gray-400">算力利用率</span><span className="text-white font-bold font-mono">{util}%</span></div><div className="h-2.5 w-full bg-white/5 rounded-full overflow-hidden"><div className={`h-full rounded-full ${util > 80 ? "bg-red-500" : "bg-cyan-500"}`} style={{ width: `${util}%` }} /></div></div>
                    <div><div className="flex justify-between text-[12px] mb-2"><span className="text-gray-400">显存占用</span><span className="text-white font-bold font-mono">{used}/{total} MB ({pct}%)</span></div><div className="h-2.5 w-full bg-white/5 rounded-full overflow-hidden"><div className={`h-full rounded-full ${pct > 90 ? "bg-red-500" : "bg-cyan-400"}`} style={{ width: `${pct}%` }} /></div></div>
                    {powerDraw != null && powerLimit != null ? <div><div className="flex justify-between text-[12px] mb-2"><span className="text-gray-400">功耗</span><span className="text-white font-bold font-mono">{powerDraw.toFixed(1)}W / {powerLimit}W</span></div><div className="h-2.5 w-full bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-amber-500/70 rounded-full" style={{ width: `${Math.min(100, (powerDraw / powerLimit) * 100)}%` }} /></div></div> : null}
                  </div>
                  <div className="grid grid-cols-3 gap-x-6 gap-y-5">
                    <div><span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">TEMP</span><span className="text-[16px] font-bold font-mono text-white">{temp != null ? `${temp}°C` : "—"}</span></div>
                    <div><span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">POWER</span><span className="text-[16px] font-bold font-mono text-white">{powerDraw != null ? `${powerDraw.toFixed(0)}W` : "—"}</span></div>
                    <div><span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">FAN</span><span className="text-[16px] font-bold font-mono text-white">{fan != null ? `${fan}%` : "N/A"}</span></div>
                    <div><span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">CLOCK</span><span className="text-[16px] font-bold font-mono text-white">{clockCur ?? "—"} <span className="text-[11px] text-gray-600">MHz</span></span></div>
                    <div><span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">BOOST</span><span className="text-[16px] font-bold font-mono text-white">{clockMax ?? "—"} <span className="text-[11px] text-gray-600">MHz</span></span></div>
                    <div><span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">UTIL</span><span className="text-[16px] font-bold font-mono text-white">{util}%</span></div>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-4 gap-3">
                  <MetricCell label="Driver" value={nvidia.driver_version ?? "—"} />
                  <MetricCell label="CUDA" value={nvidia.cuda_version ?? "—"} />
                  <MetricCell label="NVCC" value={nvidia.nvcc_version ?? "Not Installed"} />
                  <MetricCell label="PCIe" value={pcieGen != null ? `Gen${pcieGen} x${pcieWidth ?? "?"}` : "—"} />
                  <MetricCell label="Power Cap" value={powerLimit != null ? `${powerLimit} W` : "N/A"} />
                  <MetricCell label="Encoder" value={encoderUtil != null ? `${encoderUtil}%` : "N/A"} />
                  <MetricCell label="Decoder" value={decoderUtil != null ? `${decoderUtil}%` : "N/A"} />
                  <MetricCell label="Video Clock" value={clockVideo != null ? `${clockVideo} MHz` : "N/A"} />
                  <MetricCell label="SMI" value={nvidia.nvidia_smi_path ? "ready" : "—"} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* JSON toggle */}
      <div className={cardCls + " p-4"}>
        <div onClick={() => setShowJson(!showJson)} className="flex justify-between items-center cursor-pointer text-xs font-mono text-gray-400 hover:text-white select-none">
          <span>{showJson ? "▾ 折叠原始 JSON" : "▸ 查看原始 JSON 数据 (Raw Snapshot)"}</span>
        </div>
        {showJson ? <div className="mt-4"><CodeBlock label="snapshot.json" value={prettyJson(latestStatus)} maxHeight={300} /></div> : null}
      </div>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2">
      <span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">{label}</span>
      <span className="block break-all text-[13px] font-bold font-mono leading-snug text-white">{value}</span>
    </div>
  );
}

/* ═══ CONFIG TAB ═══ */
function TabConfig({ node, editForm, updateEdit, editError, saving, handleSave }: {
  node: NodeResponse; editForm: any; updateEdit: any; editError: string | null; saving: boolean; handleSave: () => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className={`${cardCls} lg:col-span-1 space-y-5`}>
        <div className="border-b border-white/5 pb-3"><span className="text-[12px] font-bold font-mono text-gray-500 uppercase">运行时后端 Backends</span></div>
        <div className="space-y-4">
          <div className="p-3.5 rounded-lg bg-[#050507] border border-white/5 space-y-1.5">
            <span className="text-xs font-bold text-white block">.venv (Default Workspace)</span>
            <span className="text-[11px] text-gray-500 font-mono block">{node.allowed_workdirs[0] ?? "—"}</span>
            {pythonEnvInfo(node)}
          </div>
        </div>
        <div className="space-y-3 pt-2">
          <span className="text-[11px] font-mono text-gray-500 block">标签</span>
          <div className="flex flex-wrap gap-2">
            {node.tags.map((t) => <span key={t} className="px-2.5 py-0.5 text-[11px] font-mono bg-white/5 border border-white/5 rounded-md text-gray-400">{t}</span>)}
            {node.tags.length === 0 ? <span className="text-[11px] text-gray-600">无标签</span> : null}
          </div>
        </div>
      </div>

      <div className={`${cardCls} lg:col-span-2 space-y-5`}>
        <div className="flex justify-between items-center border-b border-white/5 pb-3">
          <span className="text-[12px] font-bold font-mono text-gray-500 uppercase">节点配置 (Node Configuration)</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><label className={labelCls}>显示名 (Display Name)</label><input type="text" value={editForm.display_name} onChange={(e) => updateEdit((p: any) => ({ ...p, display_name: e.target.value }))} className={inputCls} /></div>
          <div className="space-y-1.5"><label className={labelCls}>主机名 (Hostname)</label><input type="text" value={editForm.hostname} onChange={(e) => updateEdit((p: any) => ({ ...p, hostname: e.target.value }))} className={inputCls} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><label className={labelCls}>OS</label><select value={editForm.os_type} onChange={(e) => updateEdit((p: any) => ({ ...p, os_type: e.target.value }))} className={inputCls}><option value="windows">windows</option><option value="linux">linux</option></select></div>
          <div className="space-y-1.5"><label className={labelCls}>心跳间隔 (秒)</label><input type="number" min={3} max={3600} value={editForm.heartbeat_interval_sec} onChange={(e) => updateEdit((p: any) => ({ ...p, heartbeat_interval_sec: Number(e.target.value || 5) }))} className={inputCls} /></div>
        </div>
        <div className="space-y-1.5"><label className={labelCls}>允许的工作目录</label><textarea value={editForm.allowed_workdirs} onChange={(e) => updateEdit((p: any) => ({ ...p, allowed_workdirs: e.target.value }))} className={`${inputCls} h-20 resize-none`} /></div>
        <div className="space-y-1.5"><label className={labelCls}>标签 (逗号分隔)</label><input type="text" value={editForm.tags} onChange={(e) => updateEdit((p: any) => ({ ...p, tags: e.target.value }))} className={inputCls} /></div>
        {editError ? <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">{editError}</div> : null}
        <button type="button" onClick={handleSave} disabled={saving} className="w-full bg-white text-[#07080A] py-2.5 rounded-lg text-xs font-bold tracking-wide hover:bg-gray-200 transition-colors shadow-lg disabled:opacity-40">{saving ? "保存中…" : "保存配置"}</button>
      </div>
    </div>
  );
}

function pythonEnvInfo(node: NodeResponse): JSX.Element | null {
  return <span className="text-[11px] text-cyan-400 block font-mono">Python env</span>;
}

/* ═══ TASKS TAB ═══ */
function TabTasks({ node, canDispatch, recentTasks }: { node: NodeResponse; canDispatch: boolean; recentTasks: any[] }): JSX.Element {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-6">
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-400"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>
          <span className="text-[13px] font-bold font-mono tracking-wide text-gray-400 uppercase">调度控制台 Dispatch Command</span>
        </div>
        {!canDispatch ? (
          <div className="py-12 text-center text-gray-600 font-mono text-xs border border-dashed border-white/5 rounded-lg">{!node.is_enabled ? "节点已停用" : node.connection_status === "offline" ? "节点离线" : "暂不可下发"}</div>
        ) : (
          <TaskComposer node={node} />
        )}
      </div>

      <div className="lg:col-span-1 space-y-4">
        <div className="border-b border-white/5 pb-3 flex justify-between items-center">
          <span className="text-[12px] font-bold font-mono text-gray-500 uppercase">Recent Executions</span>
          <span className="text-[10px] text-cyan-500 cursor-pointer hover:text-white transition-colors" onClick={() => navigate({ name: "tasks" })}>View Stream</span>
        </div>
        <div className="space-y-2.5">
          {recentTasks.length === 0 ? <div className="py-12 text-center text-[11px] text-gray-600 font-mono">暂无任务</div> : recentTasks.slice(0, 5).map((task) => (
            <div key={task.task_id} onClick={() => navigate({ name: "task-detail", taskId: task.task_id })} className="p-3.5 rounded-xl bg-white/[0.01] hover:bg-white/[0.03] border border-white/5 hover:border-white/10 transition-all cursor-pointer group">
              <div className="flex justify-between items-center mb-2">
                <span className="font-mono text-[11px] text-gray-200 group-hover:text-cyan-400 transition-colors">{task.task_id}</span>
                <span className={`${badgeCls} ${task.status === "succeeded" ? "bg-emerald-950/40 text-emerald-400 border-emerald-800/30" : "bg-white/5 text-gray-400 border-white/5"}`}>{task.status}</span>
              </div>
              <div className="flex justify-between items-center text-[11px] text-gray-500"><span>{task.type}</span><span>{formatRelative(task.created_at)}</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
