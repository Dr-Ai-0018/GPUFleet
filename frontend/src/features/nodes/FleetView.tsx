import { useMemo, useState } from "react";
import { navigate } from "../../lib/routing";
import { useConsoleStore } from "../../state/ConsoleStore";
import type { OnlineStatus } from "../../types";
import { nodeTypeLabel, osLabel } from "../../lib/labels";
import { formatRelative } from "../../lib/format";
import { GpuHeatCells } from "../../ui/GpuHeatCells";
import { MetricTile } from "../../ui/MetricTile";
import type { components } from "../../types.generated";

type GpuSnapshot = components["schemas"]["HeartbeatGpu"];
type ConnectionFilter = "all" | OnlineStatus;

const STATUS_TONE: Record<OnlineStatus, { dot: string; glow: string; text: string; accent: string }> = {
  online: { dot: "bg-emerald-400", glow: "shadow-[0_0_8px_rgba(16,185,129,0.55)]", text: "text-emerald-300", accent: "border-emerald-400/40" },
  offline: { dot: "bg-amber-400", glow: "", text: "text-amber-300", accent: "border-amber-400/40" },
  disabled: { dot: "bg-gray-500", glow: "", text: "text-gray-400", accent: "border-gray-500/40" },
  never_seen: { dot: "bg-violet-400", glow: "", text: "text-violet-300", accent: "border-violet-400/40" },
};

const ALL_FILTER_ACCENT = "border-cyan-400/40 text-cyan-300";

export function FleetView(): JSX.Element {
  const store = useConsoleStore();
  const [query, setQuery] = useState("");
  const [connFilter, setConnFilter] = useState<ConnectionFilter>("all");

  const nodeCounts = store.overview?.node_counts ?? {
    total: store.nodes.length, online: 0, offline: 0, disabled: 0, never_seen: 0,
  };
  const overviewByNodeId = useMemo(
    () => new Map((store.overview?.nodes ?? []).map((node) => [node.node_id, node])),
    [store.overview?.nodes],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.nodes.filter((node) => {
      if (connFilter !== "all" && node.connection_status !== connFilter) return false;
      if (!q) return true;
      return [node.node_id, node.display_name, node.hostname ?? "", ...node.tags]
        .join(" ").toLowerCase().includes(q);
    });
  }, [store.nodes, connFilter, query]);

  const filterTiles: Array<{ value: ConnectionFilter; label: string; count: number; tone: OnlineStatus | null }> = [
    { value: "all", label: "全部", count: nodeCounts.total, tone: null },
    { value: "online", label: "在线", count: nodeCounts.online, tone: "online" },
    { value: "offline", label: "离线", count: nodeCounts.offline, tone: "offline" },
    { value: "never_seen", label: "未上线", count: nodeCounts.never_seen, tone: "never_seen" },
    { value: "disabled", label: "停用", count: nodeCounts.disabled, tone: "disabled" },
  ];

  return (
    <div className="py-2">
      {/* ───── Page header ───── */}
      <header className="mb-8 flex items-baseline justify-between gap-6 border-b border-white/[0.045] pb-6">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-white">节点舰队</h2>
          <p className="mt-1.5 text-[13px] leading-6 text-gray-500">
            Fleet 全部节点的注册信息、连接状态与实时负载。
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate({ name: "onboarding" })}
          className="shrink-0 rounded-md border border-cyan-400/40 bg-cyan-500/[0.14] px-4 py-1.5 text-[12.5px] font-semibold text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-all hover:border-cyan-400/60 hover:bg-cyan-500/[0.22] hover:text-cyan-100"
        >
          + 登记新节点
        </button>
      </header>

      {/* ───── KPI strip = 筛选器 (数据显示即控件) ───── */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {filterTiles.map((t) => {
          const isActive = connFilter === t.value;
          const toneTextCls = t.tone ? STATUS_TONE[t.tone].text : "text-white";
          const activeBorder = t.value === "all" ? ALL_FILTER_ACCENT : isActive ? STATUS_TONE[t.tone!].text + " " + STATUS_TONE[t.tone!].accent : "";
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setConnFilter(t.value)}
              className={`group relative overflow-hidden rounded-md border px-3.5 py-3 text-left transition-all ${
                isActive
                  ? `${activeBorder} bg-white/[0.04]`
                  : "border-white/[0.05] bg-[#0b0e13] hover:border-white/[0.12] hover:bg-[#0d1119]"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {t.tone ? (
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_TONE[t.tone].dot} ${isActive ? STATUS_TONE[t.tone].glow : ""}`} />
                  ) : (
                    <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.55)]" : "bg-gray-600"}`} />
                  )}
                  <span className={`text-[11.5px] font-medium ${isActive ? "text-white" : "text-gray-400"}`}>{t.label}</span>
                </div>
                {isActive ? (
                  <span className="text-[9.5px] font-mono uppercase tracking-wider text-gray-600">active</span>
                ) : null}
              </div>
              <div className={`mt-2 text-[24px] font-semibold tracking-tight tabular-nums ${isActive ? toneTextCls : "text-gray-200"}`}>
                {t.count}
              </div>
            </button>
          );
        })}
      </div>

      {/* ───── Search + roster meta ───── */}
      <div className="mb-4 flex items-center gap-3 border-b border-white/[0.045] pb-3">
        <div className="relative flex-1 max-w-md">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="搜索名称、ID、主机名、标签…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-white/[0.07] bg-[#0a0d12] py-1.5 pl-9 pr-3 text-[12.5px] text-white outline-none transition-colors placeholder:text-gray-600 focus:border-cyan-400/40 focus:bg-[#0c1017]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-600 hover:bg-white/[0.05] hover:text-gray-300"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>
        <span className="ml-auto font-mono text-[11.5px] text-gray-500">
          {filtered.length === store.nodes.length
            ? `${store.nodes.length} 个节点`
            : `${filtered.length} / ${store.nodes.length}`}
        </span>
      </div>

      {/* ───── Roster table ───── */}
      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-white/[0.06] bg-[#0a0d12] px-6 py-16 text-center">
          <div className="text-[13px] font-medium text-gray-300">
            {store.nodes.length === 0 ? "舰队为空" : "无匹配结果"}
          </div>
          <div className="mt-1.5 text-[12px] text-gray-500">
            {store.nodes.length === 0
              ? "还没有任何节点登记到 Fleet"
              : "尝试清空搜索或切换筛选条件"}
          </div>
          {store.nodes.length === 0 ? (
            <button
              type="button"
              onClick={() => navigate({ name: "onboarding" })}
              className="mt-5 rounded-md border border-cyan-400/40 bg-cyan-500/[0.14] px-4 py-2 text-[12.5px] font-semibold text-cyan-200 hover:bg-cyan-500/[0.22]"
            >
              去登记节点
            </button>
          ) : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-white/[0.05]">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-white/[0.05] bg-white/[0.015] text-[11px] text-gray-500">
                <th className="px-4 py-2.5 font-normal">节点</th>
                <th className="px-4 py-2.5 font-normal">类型</th>
                <th className="px-4 py-2.5 font-normal">实时负载</th>
                <th className="px-4 py-2.5 font-normal">网络</th>
                <th className="px-4 py-2.5 font-normal">最近</th>
                <th className="px-4 py-2.5 font-normal">标签</th>
                <th className="w-8 px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((node) => {
                const liveNode = overviewByNodeId.get(node.node_id);
                const cpuPct = Number(liveNode?.latest_status?.cpu?.usage_percent ?? 0);
                const memPct = Number(liveNode?.latest_status?.memory?.usage_percent ?? 0);
                const gpus = (liveNode?.latest_status?.gpus ?? []) as GpuSnapshot[];
                const gpuAvg = gpus.length > 0
                  ? gpus.reduce((s, g) => s + Number(g.utilization_percent ?? 0), 0) / gpus.length
                  : 0;
                const hasMetrics = liveNode?.latest_status != null;
                const tone = STATUS_TONE[node.connection_status];

                return (
                  <tr
                    key={node.node_id}
                    onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}
                    className="group cursor-pointer border-b border-white/[0.03] transition-colors last:border-0 hover:bg-white/[0.02]"
                  >
                    {/* 节点 = 状态点 + 名称 + ID */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot} ${node.connection_status === "online" ? tone.glow : ""}`} />
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-gray-200 transition-colors group-hover:text-white">
                            {node.display_name}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[10.5px] text-gray-600">{node.node_id}</div>
                        </div>
                      </div>
                    </td>

                    {/* 类型 + OS */}
                    <td className="px-4 py-3">
                      <div className="text-[12.5px] text-gray-300">
                        {nodeTypeLabel[node.node_type] ?? node.node_type}
                      </div>
                      {node.os_type ? (
                        <div className="mt-0.5 text-[11px] text-gray-600">
                          {osLabel[node.os_type] ?? node.os_type}
                        </div>
                      ) : null}
                    </td>

                    {/* 实时负载 = 3 个统一 metric tile (与 Overview 同款) */}
                    <td className="min-w-[300px] px-4 py-3">
                      <div className="grid grid-cols-3 gap-1.5" style={{ width: 300 }}>
                        <MetricTile label="CPU" pct={cpuPct} muted={!hasMetrics} size="sm" />
                        <MetricTile label="MEM" pct={memPct} muted={!hasMetrics} size="sm" />
                        <MetricTile
                          label="GPU"
                          pct={gpuAvg}
                          muted={!hasMetrics || gpus.length === 0}
                          badge={gpus.length > 1 ? `×${gpus.length}` : undefined}
                          tooltipContent={gpus.length > 0 ? <GpuHeatCells gpus={gpus} size={12} /> : undefined}
                          size="sm"
                        />
                      </div>
                    </td>

                    {/* 网络 = hostname + heartbeat 间隔 */}
                    <td className="px-4 py-3">
                      <div className="font-mono text-[11.5px] text-gray-300">
                        {node.hostname ?? "—"}
                      </div>
                      <div className="mt-0.5 font-mono text-[10.5px] text-gray-600">
                        ↻ {node.heartbeat_interval_sec}s
                      </div>
                    </td>

                    {/* 最近 */}
                    <td className="px-4 py-3 text-[11.5px] text-gray-500">
                      {node.last_seen_at ? formatRelative(node.last_seen_at) : (
                        <span className="text-gray-600">尚未</span>
                      )}
                    </td>

                    {/* 标签 (最多 3 个,溢出展示 +N) */}
                    <td className="px-4 py-3">
                      {node.tags.length === 0 ? (
                        <span className="text-[11px] text-gray-600">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {node.tags.slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className="rounded border border-white/[0.06] bg-white/[0.025] px-1.5 py-0.5 font-mono text-[10px] text-gray-400"
                            >
                              {t}
                            </span>
                          ))}
                          {node.tags.length > 3 ? (
                            <span className="rounded border border-white/[0.05] bg-white/[0.015] px-1.5 py-0.5 font-mono text-[10px] text-gray-600">
                              +{node.tags.length - 3}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </td>

                    {/* Chevron */}
                    <td className="w-8 px-2 py-3 text-right">
                      <svg
                        width="14" height="14" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor" strokeWidth="2"
                        className="text-gray-700 transition-colors group-hover:text-gray-400"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

