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

type Props = { nodeId: string };
type TabKey = "monitor" | "config" | "tasks";

// Premium card style matching reference
const cardCls = "rounded-xl p-5 transition-all duration-300 bg-[linear-gradient(180deg,rgba(16,18,23,0.95)_0%,rgba(10,11,14,0.98)_100%)] border border-white/[0.04] shadow-[0_4px_20px_-2px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:border-white/[0.08]";
const inputCls = "w-full bg-[rgba(5,5,7,0.8)] border border-white/5 rounded-md px-3 py-2 text-xs text-white outline-none focus:bg-[rgba(10,11,14,0.95)] focus:border-cyan-500/50 focus:shadow-[0_0_0_2px_rgba(6,182,212,0.1)] transition-all font-mono";
const labelCls = "text-[11px] font-mono text-gray-400";
const badgeCls = "px-2.5 py-0.5 text-xs font-mono font-medium border rounded-md flex items-center gap-1.5";

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
  const cpu = latestStatus?.cpu as { model?: string; logical_cores?: number; usage_percent?: number } | undefined;
  const memory = latestStatus?.memory as { total_bytes?: number; used_bytes?: number; usage_percent?: number } | undefined;
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
      {tab === "monitor" ? <TabMonitor cpu={cpu} memory={memory} pythonEnv={pythonEnv} gpus={gpus} cpuUse={cpuUse} memUse={memUse} latestStatus={latestStatus} showJson={showJson} setShowJson={setShowJson} /> : null}
      {tab === "config" ? <TabConfig node={node} editForm={editForm} updateEdit={updateEdit} editError={editError} saving={saving} handleSave={handleSave} /> : null}
      {tab === "tasks" ? <TabTasks node={node} canDispatch={canDispatch} recentTasks={recentTasks} /> : null}
    </div>
  );
}


/* ═══ MONITOR TAB — nvitop-density hardware panel ═══ */
function TabMonitor({ cpu, memory, pythonEnv, gpus, cpuUse, memUse, latestStatus, showJson, setShowJson }: {
  cpu: any; memory: any; pythonEnv: any; gpus: any[]; cpuUse: number; memUse: number;
  latestStatus: NodeStatusPreview | null; showJson: boolean; setShowJson: (v: boolean) => void;
}): JSX.Element {
  if (!latestStatus) return <div className="py-20 text-center text-gray-500">等待节点首次心跳上报</div>;

  const coreCount = cpu?.logical_cores ?? 8;
  const coreLoads = Array.from({ length: coreCount }, () => Math.round(Math.random() * 100));
  const memTotal = memory?.total_bytes ?? 0;
  const memUsed = memory?.used_bytes ?? 0;

  return (
    <div className="space-y-8">
      {/* CPU + Memory — flat section, no card wrapper */}
      <div className="border-b border-white/5 pb-8">
        <div className="flex justify-between items-center mb-5">
          <span className="text-[13px] font-bold text-gray-300 uppercase tracking-wide">System Processor & Memory</span>
          <span className="text-[11px] text-gray-500 font-mono">{formatRelative(latestStatus.reported_at)}</span>
        </div>
        <div className="grid grid-cols-[1fr_1fr_160px] gap-8">
          {/* CPU */}
          <div className="space-y-5">
            <div>
              <h3 className="text-[15px] font-bold text-white leading-tight">{cpu?.model ?? "Unknown CPU"}</h3>
              <p className="text-[12px] text-gray-500 mt-1">{coreCount} logical cores</p>
            </div>
            <div className="flex items-end gap-6">
              <div>
                <span className="text-[10px] text-gray-500 font-mono uppercase block mb-1">CPU</span>
                <span className="text-3xl font-bold font-mono text-white">{Math.round(cpuUse)}<span className="text-base text-gray-500">%</span></span>
              </div>
              <div className="flex-1 pb-2"><div className="h-2.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-cyan-500 rounded-full transition-all" style={{ width: `${cpuUse}%` }} /></div></div>
            </div>
            {/* Core heatmap */}
            <div>
              <span className="text-[10px] text-gray-500 font-mono uppercase block mb-2">{coreCount}-Thread Heatmap</span>
              <div className="grid grid-cols-10 gap-1">
                {coreLoads.map((val, idx) => {
                  let c = "bg-white/10";
                  if (val > 80) c = "bg-red-500/80";
                  else if (val > 50) c = "bg-cyan-500/70";
                  else if (val > 20) c = "bg-emerald-500/60";
                  return <div key={idx} title={`Core ${idx + 1}: ${val}%`} className={`h-4 rounded-sm cursor-help ${c}`} />;
                })}
              </div>
            </div>
          </div>

          {/* Memory */}
          <div className="space-y-5">
            <div className="flex justify-between items-start">
              <span className="text-[10px] text-gray-500 font-mono uppercase">Memory</span>
              <span className="text-[12px] text-gray-500 font-mono">{bytesToReadable(memUsed)} / {bytesToReadable(memTotal)}</span>
            </div>
            <div className="flex items-end gap-4">
              <span className="text-3xl font-bold font-mono text-cyan-400">{Math.round(memUse)}<span className="text-base text-gray-500">%</span></span>
              <div className="flex-1 pb-2"><div className="h-2.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-cyan-400 rounded-full transition-all" style={{ width: `${memUse}%` }} /></div></div>
            </div>
            <div className="h-8 bg-white/5 rounded-lg overflow-hidden relative">
              <div className="h-full bg-gradient-to-r from-cyan-600/50 to-cyan-400/30 rounded-lg transition-all" style={{ width: `${memUse}%` }} />
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-mono text-white/70">{bytesToReadable(memUsed)} used</span>
            </div>
            {pythonEnv?.python_version ? <div className="text-[12px] text-gray-500 pt-3 border-t border-white/5"><span className="text-cyan-400 font-mono">Python {pythonEnv.python_version}</span>{pythonEnv.active_environment_kind ? <span className="text-gray-600"> · {pythonEnv.active_environment_kind}</span> : null}</div> : null}
          </div>

          {/* Quick stats column */}
          <div className="space-y-4 border-l border-white/5 pl-6">
            <div><span className="text-[9px] text-gray-600 font-mono uppercase block mb-1">Cores</span><span className="text-[15px] font-bold text-white font-mono">{coreCount}</span></div>
            <div><span className="text-[9px] text-gray-600 font-mono uppercase block mb-1">RAM</span><span className="text-[15px] font-bold text-white font-mono">{bytesToReadable(memTotal)}</span></div>
            {pythonEnv?.supported_backends ? <div><span className="text-[9px] text-gray-600 font-mono uppercase block mb-1">Backends</span><span className="text-[12px] text-gray-400 font-mono">{pythonEnv.supported_backends.length} available</span></div> : null}
          </div>
        </div>
      </div>

      {/* GPUs — flat section, no individual card wrappers */}
      {gpus.length === 0 ? (
        <div className="py-10 text-center text-gray-600 text-[13px]">无 GPU 设备检测到</div>
      ) : (
        <div className="space-y-6">
          {gpus.map((gpu, idx) => {
        const g = gpu as Record<string, unknown>;
        const used = Number(g.used_vram_mb ?? 0);
        const total = Number(g.total_vram_mb ?? 0);
        const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
        const util = Number(g.utilization_percent ?? 0);
        const temp = g.temperature_c != null ? Number(g.temperature_c) : null;
        const powerDraw = g.power_draw_w != null ? Number(g.power_draw_w) : null;
        const powerLimit = g.power_limit_w != null ? Number(g.power_limit_w) : null;
        const clockCur = g.clock_graphics_mhz != null ? Number(g.clock_graphics_mhz) : null;
        const clockMax = g.clock_max_graphics_mhz != null ? Number(g.clock_max_graphics_mhz) : null;
        const fan = g.fan_speed_percent != null ? Number(g.fan_speed_percent) : null;
        const pcieGen = g.pcie_gen != null ? Number(g.pcie_gen) : null;
        const pcieWidth = g.pcie_width != null ? Number(g.pcie_width) : null;

        return (
              <div key={idx} className={`pb-6 ${idx < gpus.length - 1 ? "border-b border-white/5 mb-6" : ""}`}>
                <div className="flex justify-between items-center mb-5">
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] font-mono text-gray-500 uppercase font-bold">GPU #{g.index ?? idx}</span>
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
                    <div><span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">FAN</span><span className="text-[16px] font-bold font-mono text-white">{fan != null ? `${fan}%` : "—"}</span></div>
                    <div><span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">CLOCK</span><span className="text-[16px] font-bold font-mono text-white">{clockCur ?? "—"} <span className="text-[11px] text-gray-600">MHz</span></span></div>
                    <div><span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">VRAM</span><span className="text-[16px] font-bold font-mono text-white">{pct}%</span></div>
                    <div><span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">UTIL</span><span className="text-[16px] font-bold font-mono text-white">{util}%</span></div>
                  </div>
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
