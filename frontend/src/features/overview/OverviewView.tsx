import { useId, useMemo } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart, BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useConsoleStore } from "../../state/ConsoleStore";
import { navigate } from "../../lib/routing";
import { StatusPill } from "../../ui/StatusPill";
import { MiniSparkline } from "../../ui/MiniSparkline";
import { GpuHeatCells } from "../../ui/GpuHeatCells";
import { DeltaBadge } from "../../ui/DeltaBadge";
import { taskStatusLabel, taskStatusTone } from "../../lib/labels";
import { formatRelative, bytesToReadable } from "../../lib/format";
import type { components } from "../../types.generated";

type GpuSnapshot = components["schemas"]["HeartbeatGpu"];

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

const beijingDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai",
});

const TASK_STATUS_COLOR: Record<string, string> = {
  pending: "#6b7280",
  claimed: "#06b6d4",
  running: "#06b6d4",
  succeeded: "#10b981",
  failed: "#ef4444",
  timeout: "#ef4444",
  cancel_requested: "#f0b040",
  cancelled: "#6b7280",
  lost: "#ef4444",
};

const NODE_STATUS_ITEMS: Array<{ key: "online" | "offline" | "disabled" | "never_seen"; label: string; color: string }> = [
  { key: "online", label: "在线", color: "#10b981" },
  { key: "offline", label: "离线", color: "#f0b040" },
  { key: "disabled", label: "停用", color: "#6b7280" },
  { key: "never_seen", label: "未上线", color: "#7c3aed" },
];

export function OverviewView(): JSX.Element {
  const store = useConsoleStore();
  const overview = store.overview;
  const prevOverview = store.prevOverview;
  const nodeCounts = overview?.node_counts ?? { total: 0, online: 0, offline: 0, disabled: 0, never_seen: 0 };
  const taskCounts = useMemo<Record<string, number>>(() => overview?.task_counts ?? {}, [overview?.task_counts]);
  const recentTasks = overview?.recent_tasks ?? [];
  const prevNodeCounts = prevOverview?.node_counts ?? null;
  const prevTaskCounts = prevOverview?.task_counts ?? null;

  const gpuStats = useMemo(() => {
    if (!overview) return { totalGpus: 0, avgUtil: 0, totalVram: 0, usedVram: 0 };
    let totalGpus = 0, totalUtil = 0, totalVram = 0, usedVram = 0;
    for (const node of overview.nodes) {
      if (!node.latest_status) continue;
      for (const gpu of node.latest_status.gpus) {
        const g = gpu as GpuSnapshot;
        totalGpus++;
        totalUtil += Number(g.utilization_percent ?? 0);
        totalVram += Number(g.total_vram_mb ?? 0);
        usedVram += Number(g.used_vram_mb ?? 0);
      }
    }
    return { totalGpus, avgUtil: totalGpus > 0 ? Math.round(totalUtil / totalGpus) : 0, totalVram, usedVram };
  }, [overview]);

  const prevGpuStats = useMemo(() => {
    if (!prevOverview) return null;
    let totalGpus = 0, totalUtil = 0;
    for (const node of prevOverview.nodes) {
      if (!node.latest_status) continue;
      for (const gpu of node.latest_status.gpus) {
        const g = gpu as GpuSnapshot;
        totalGpus++;
        totalUtil += Number(g.utilization_percent ?? 0);
      }
    }
    return { avgUtil: totalGpus > 0 ? Math.round(totalUtil / totalGpus) : 0 };
  }, [prevOverview]);

  const totalTasks = Object.values(taskCounts).reduce((a, b) => a + b, 0);
  const succeededTasks = taskCounts.succeeded ?? 0;
  const failedTasks = (taskCounts.failed ?? 0) + (taskCounts.timeout ?? 0);
  const runningTasks = (taskCounts.running ?? 0) + (taskCounts.claimed ?? 0);
  const onlineRate = nodeCounts.total > 0 ? Math.round((nodeCounts.online / nodeCounts.total) * 100) : 0;
  const vramPct = gpuStats.totalVram > 0 ? Math.round((gpuStats.usedVram / gpuStats.totalVram) * 100) : 0;
  const throughputSeries = overview?.task_throughput_24h ?? Array(24).fill(0);
  const serverTime = overview?.server_time
    ? beijingDateTimeFormatter.format(new Date(overview.server_time))
    : "—";

  // ECharts: throughput line
  const lineOption = useMemo(() => ({
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: "#0c0f14",
      borderColor: "rgba(255,255,255,0.06)",
      textStyle: { color: "#c9d1d9", fontSize: 11 },
    },
    grid: { left: 40, right: 16, top: 16, bottom: 28 },
    xAxis: {
      type: "category" as const,
      data: Array.from({ length: 24 }, (_, i) => `${i}:00`),
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } },
      axisTick: { show: false },
      axisLabel: { color: "#4a5568", fontSize: 10 },
    },
    yAxis: {
      type: "value" as const,
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)" } },
      axisLabel: { color: "#4a5568", fontSize: 10 },
    },
    series: [{
      type: "line" as const,
      smooth: true,
      symbol: "circle",
      symbolSize: 3,
      lineStyle: { color: "#06b6d4", width: 2 },
      itemStyle: { color: "#06b6d4" },
      areaStyle: {
        color: {
          type: "linear" as const,
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: "rgba(6,182,212,0.14)" },
            { offset: 1, color: "rgba(6,182,212,0)" },
          ],
        },
      },
      data: throughputSeries,
    }],
  }), [throughputSeries]);

  // ECharts: per-node GPU utilization bars
  const gpuBarOption = useMemo(() => {
    if (!overview) return null;
    const nodes = overview.nodes.filter((n) => n.latest_status && n.latest_status.gpus.length > 0);
    if (nodes.length === 0) return null;
    return {
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: "#0c0f14",
        borderColor: "rgba(255,255,255,0.06)",
        textStyle: { color: "#c9d1d9", fontSize: 11 },
      },
      grid: { left: 110, right: 24, top: 8, bottom: 24 },
      xAxis: {
        type: "value" as const,
        max: 100,
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)" } },
        axisLabel: { color: "#4a5568", fontSize: 10, formatter: "{value}%" },
      },
      yAxis: {
        type: "category" as const,
        data: nodes.map((n) => n.display_name),
        axisTick: { show: false },
        axisLabel: { color: "#9ca3af", fontSize: 11 },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } },
      },
      series: [{
        type: "bar" as const,
        data: nodes.map((n) => {
          const g = n.latest_status!.gpus[0] as GpuSnapshot;
          const v = Number(g.utilization_percent ?? 0);
          const color = v >= 90 ? "#f85149" : v >= 70 ? "#f0b040" : v >= 40 ? "#06b6d4" : "#10b981";
          return { value: v, itemStyle: { color, borderRadius: [0, 3, 3, 0] } };
        }),
        barWidth: 14,
      }],
    };
  }, [overview]);

  return (
    <div className="py-2">
      {/* ───── Page header ───── */}
      <header className="mb-8 flex items-baseline justify-between gap-6 border-b border-white/[0.045] pb-6">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-white">舰队总览</h2>
          <p className="mt-1.5 text-[13px] leading-6 text-gray-500">
            节点 / GPU / 任务的实时聚合视图,反映 Fleet 当前态势。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {store.warnings.length > 0 ? (
            <span className="rounded-md border border-amber-400/30 bg-amber-400/[0.08] px-2.5 py-1 text-[11.5px] text-amber-300">
              {store.warnings.length} 条告警
            </span>
          ) : (
            <span className="rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] px-2.5 py-1 text-[11.5px] text-emerald-300">
              运行正常
            </span>
          )}
          <span className="font-mono text-[12px] text-gray-500">{serverTime}</span>
        </div>
      </header>

      {/* ───── KPI strip (flat, 5 columns) ───── */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 border-b border-white/[0.045] pb-7 md:grid-cols-3 lg:grid-cols-5">
        <KpiItem
          label="节点总数"
          value={String(nodeCounts.total)}
          sublabel="Fleet nodes"
          delta={<DeltaBadge current={nodeCounts.total} previous={prevNodeCounts ? Number(prevNodeCounts.total) : null} suffix="" precision={0} />}
        />
        <KpiItem
          label="在线节点"
          value={`${nodeCounts.online}/${nodeCounts.total}`}
          sublabel={`${onlineRate}% 可用率`}
          accent={onlineRate >= 90 ? "emerald" : onlineRate >= 60 ? "cyan" : "amber"}
          delta={<DeltaBadge current={nodeCounts.online} previous={prevNodeCounts ? Number(prevNodeCounts.online) : null} suffix="" precision={0} />}
        />
        <KpiItem
          label="GPU 数量"
          value={String(gpuStats.totalGpus)}
          sublabel={`平均利用 ${gpuStats.avgUtil}%`}
          delta={<DeltaBadge current={gpuStats.avgUtil} previous={prevGpuStats?.avgUtil ?? null} suffix="%" />}
        />
        <KpiItem
          label="显存利用"
          value={`${vramPct}%`}
          sublabel={`${bytesToReadable(gpuStats.usedVram * 1024 * 1024)} / ${bytesToReadable(gpuStats.totalVram * 1024 * 1024)}`}
          accent={vramPct >= 90 ? "red" : vramPct >= 70 ? "amber" : "cyan"}
        />
        <KpiItem
          label="运行任务"
          value={String(runningTasks)}
          sublabel={`成功 ${succeededTasks} · 失败 ${failedTasks}`}
          accent="cyan"
          delta={<DeltaBadge
            current={runningTasks}
            previous={prevTaskCounts ? Number(prevTaskCounts.running ?? 0) + Number(prevTaskCounts.claimed ?? 0) : null}
            suffix=""
            precision={0}
          />}
        />
      </div>

      {/* ───── Main + sidebar ───── */}
      <div className="mt-10 grid grid-cols-1 gap-x-14 gap-y-12 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* ===== Main column ===== */}
        <div className="space-y-14">
          {/* Throughput */}
          <section>
            <SectionHeading title="吞吐趋势" sub="过去 24 小时的任务完成数(按小时分桶,北京时间)" />
            <div className="mt-5">
              <ReactEChartsCore
                echarts={echarts}
                option={lineOption}
                style={{ height: 240 }}
                opts={{ renderer: "canvas" }}
              />
            </div>
          </section>

          {/* GPU cluster */}
          <section className="border-t border-white/[0.045] pt-10">
            <SectionHeading title="GPU 集群" sub="全局平均利用率与各节点首卡利用率" />
            <div className="mt-6 grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div className="flex flex-col items-center justify-center gap-5">
                <GpuUtilGauge value={gpuStats.avgUtil} />
                <div className="w-full max-w-[240px]">
                  <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
                    <span className="text-gray-500">显存占用</span>
                    <span className="font-mono text-gray-300">{vramPct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${vramPct}%`,
                        background: vramPct >= 90 ? "#f85149" : vramPct >= 70 ? "#f0b040" : "#06b6d4",
                      }}
                    />
                  </div>
                  <div className="mt-1.5 text-[10.5px] text-gray-600">
                    {bytesToReadable(gpuStats.usedVram * 1024 * 1024)} / {bytesToReadable(gpuStats.totalVram * 1024 * 1024)}
                  </div>
                </div>
              </div>
              <div>
                {gpuBarOption ? (
                  <ReactEChartsCore
                    echarts={echarts}
                    option={gpuBarOption}
                    style={{ height: Math.max(180, (overview?.nodes.filter((n) => n.latest_status && n.latest_status.gpus.length > 0).length ?? 0) * 32 + 60) }}
                    opts={{ renderer: "canvas" }}
                  />
                ) : (
                  <div className="flex h-[180px] items-center justify-center rounded-md border border-dashed border-white/[0.06] text-[12px] text-gray-600">
                    无 GPU 数据
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Node health */}
          {overview && overview.nodes.length > 0 ? (
            <section className="border-t border-white/[0.045] pt-10">
              <SectionHeading title="节点健康度" sub="CPU / 内存 / GPU 实时利用率,按节点排列" />
              <ul className="mt-5 divide-y divide-white/[0.04]">
                {overview.nodes.map((node) => {
                  const cpu = node.latest_status?.cpu as { usage_percent?: number } | undefined;
                  const mem = node.latest_status?.memory as { usage_percent?: number } | undefined;
                  const gpus = (node.latest_status?.gpus ?? []) as GpuSnapshot[];
                  const cpuPct = Number(cpu?.usage_percent ?? 0);
                  const memPct = Number(mem?.usage_percent ?? 0);
                  const gpuAvg = gpus.length > 0
                    ? gpus.reduce((s, g) => s + Number(g.utilization_percent ?? 0), 0) / gpus.length
                    : 0;
                  const isOnline = node.online_status === "online";
                  const statusTone = isOnline
                    ? { dot: "bg-emerald-400", glow: "shadow-[0_0_8px_rgba(16,185,129,0.55)]" }
                    : node.online_status === "offline"
                      ? { dot: "bg-amber-400", glow: "" }
                      : node.online_status === "disabled"
                        ? { dot: "bg-gray-500", glow: "" }
                        : { dot: "bg-violet-400", glow: "" };
                  const hasMetrics = node.latest_status != null;

                  return (
                    <li key={node.node_id}>
                      <button
                        type="button"
                        onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}
                        className="group flex w-full items-center gap-5 px-2 py-3 text-left transition-colors hover:bg-white/[0.02]"
                      >
                        {/* 状态 + 节点身份 */}
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${statusTone.dot} ${statusTone.glow}`} />
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium text-gray-200 transition-colors group-hover:text-white">
                              {node.display_name}
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[10.5px] text-gray-600">
                              {node.node_id}
                            </div>
                          </div>
                        </div>

                        {/* 三个统一规格的 metric tile */}
                        <div className="grid shrink-0 grid-cols-3 gap-2" style={{ width: 360 }}>
                          <MetricTile label="CPU" pct={cpuPct} muted={!hasMetrics} />
                          <MetricTile label="MEM" pct={memPct} muted={!hasMetrics} />
                          <MetricTile
                            label="GPU"
                            pct={gpuAvg}
                            muted={!hasMetrics || gpus.length === 0}
                            badge={gpus.length > 1 ? `×${gpus.length}` : undefined}
                            tooltipContent={gpus.length > 0 ? <GpuHeatCells gpus={gpus} size={12} /> : undefined}
                          />
                        </div>

                        {/* 翻页指示 */}
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="shrink-0 text-gray-700 transition-colors group-hover:text-gray-400"
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>

        {/* ===== Right sidebar ===== */}
        <aside className="space-y-5 xl:sticky xl:top-2 xl:self-start">
          {/* Task pulse */}
          <div className="rounded-md border border-white/[0.05] bg-[#0b0e13] px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11.5px] text-gray-500">任务节拍</span>
              <span className="text-[10.5px] text-gray-600">running now</span>
            </div>
            <div className="mt-1.5 text-[26px] font-semibold tracking-tight text-cyan-300">{runningTasks}</div>
            <div className="mt-1 text-[11px] text-gray-500">总数 {totalTasks} · 成功率 {totalTasks > 0 ? Math.round((succeededTasks / totalTasks) * 100) : 0}%</div>
            <div className="mt-3">
              <MiniSparkline
                data={throughputSeries}
                width={300}
                height={42}
                color="#06b6d4"
                fillOpacity={0.12}
                className="w-full"
              />
            </div>
          </div>

          {/* Task status distribution */}
          <div>
            <div className="mb-2.5 flex items-baseline justify-between border-b border-white/[0.045] pb-2">
              <h3 className="text-[12.5px] font-semibold text-white">任务状态分布</h3>
              <span className="text-[10.5px] text-gray-600">total {totalTasks}</span>
            </div>
            {Object.keys(taskCounts).length === 0 ? (
              <div className="py-6 text-center text-[12px] text-gray-600">暂无数据</div>
            ) : (
              <ul className="space-y-1.5">
                {Object.entries(taskCounts)
                  .filter(([, v]) => v > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, count]) => {
                    const color = TASK_STATUS_COLOR[key] ?? "#06b6d4";
                    const label = taskStatusLabel[key] ?? key;
                    const pct = totalTasks > 0 ? (count / totalTasks) * 100 : 0;
                    return (
                      <li key={key} className="px-1 py-1">
                        <div className="flex items-center justify-between gap-3 text-[12px]">
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                            <span className="text-gray-300">{label}</span>
                          </span>
                          <span className="font-mono text-gray-200">{count}</span>
                        </div>
                        <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[0.04]">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.7 }} />
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>

          {/* Node status distribution */}
          <div>
            <div className="mb-2.5 flex items-baseline justify-between border-b border-white/[0.045] pb-2">
              <h3 className="text-[12.5px] font-semibold text-white">节点状态</h3>
              <span className="text-[10.5px] text-gray-600">total {nodeCounts.total}</span>
            </div>
            <ul className="space-y-1.5">
              {NODE_STATUS_ITEMS.map((item) => {
                const count = nodeCounts[item.key] ?? 0;
                const pct = nodeCounts.total > 0 ? (count / nodeCounts.total) * 100 : 0;
                return (
                  <li key={item.key} className="px-1 py-1">
                    <div className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-gray-300">{item.label}</span>
                      </span>
                      <span className="font-mono text-gray-200">{count}</span>
                    </div>
                    <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[0.04]">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: item.color, opacity: 0.7 }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>

      {/* ───── Bottom: recent tasks (full width) ───── */}
      <section className="mt-12 border-t border-white/[0.045] pt-10">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <div>
            <h3 className="text-[14px] font-semibold text-white">近线任务</h3>
            <p className="mt-1 text-[12px] text-gray-500">最近 10 条任务记录,点击查看详情。</p>
          </div>
          <button
            type="button"
            onClick={() => navigate({ name: "tasks" })}
            className="text-[12px] text-cyan-300 transition-colors hover:text-cyan-200"
          >
            查看全部 →
          </button>
        </div>
        {recentTasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/[0.06] bg-[#0a0d12] px-4 py-12 text-center text-[12.5px] text-gray-600">
            暂无任务记录
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-white/[0.05]">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-white/[0.05] bg-white/[0.015] text-[11px] text-gray-500">
                  <th className="px-4 py-2.5 font-normal">任务 ID</th>
                  <th className="px-4 py-2.5 font-normal">执行节点</th>
                  <th className="px-4 py-2.5 font-normal">类型</th>
                  <th className="px-4 py-2.5 font-normal">状态</th>
                  <th className="px-4 py-2.5 text-right font-normal">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {recentTasks.slice(0, 10).map((t) => (
                  <tr
                    key={t.task_id}
                    onClick={() => navigate({ name: "task-detail", taskId: t.task_id })}
                    className="cursor-pointer border-b border-white/[0.03] transition-colors last:border-0 hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-3 font-mono text-[12px] text-cyan-300">{t.task_id}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-gray-400">{t.node_id}</td>
                    <td className="px-4 py-3 text-gray-300">{t.type}</td>
                    <td className="px-4 py-3">
                      <StatusPill
                        tone={taskStatusTone[t.status] ?? "muted"}
                        label={taskStatusLabel[t.status] ?? t.status}
                      />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[11.5px] text-gray-500">
                      {formatRelative(t.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────── 内部子组件 ───────────────────────

function SectionHeading({ title, sub }: { title: string; sub?: string }): JSX.Element {
  return (
    <div>
      <h3 className="text-[14px] font-semibold text-white">{title}</h3>
      {sub ? <p className="mt-1 text-[12px] leading-5 text-gray-500">{sub}</p> : null}
    </div>
  );
}

type KpiAccent = "default" | "cyan" | "emerald" | "amber" | "red";
const KPI_ACCENT: Record<KpiAccent, string> = {
  default: "text-white",
  cyan: "text-cyan-300",
  emerald: "text-emerald-300",
  amber: "text-amber-300",
  red: "text-red-300",
};

function KpiItem({
  label,
  value,
  sublabel,
  delta,
  accent = "default",
}: {
  label: string;
  value: string;
  sublabel?: string;
  delta?: JSX.Element;
  accent?: KpiAccent;
}): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] tracking-[0.04em] text-gray-500">{label}</div>
      <div className={`mt-1.5 truncate text-[26px] font-semibold tracking-[-0.01em] tabular-nums ${KPI_ACCENT[accent]}`}>
        {value}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {delta}
        {sublabel ? <span className="truncate text-[11px] text-gray-600">{sublabel}</span> : null}
      </div>
    </div>
  );
}

/** 节点健康度行的统一 metric tile — 同尺寸 / 同布局 / 同色阶,Grafana stat panel 同款语言 */
function MetricTile({
  label,
  pct,
  muted = false,
  badge,
  tooltipContent,
}: {
  label: string;
  pct: number;
  muted?: boolean;
  badge?: string;
  tooltipContent?: JSX.Element;
}): JSX.Element {
  const clamped = Math.max(0, Math.min(100, pct));
  // 统一 load-level 色阶: < 40 emerald / 40-70 cyan / 70-90 amber / >= 90 red
  const color = muted
    ? "#3a3f4a"
    : clamped >= 90
      ? "#f85149"
      : clamped >= 70
        ? "#f0b040"
        : clamped >= 40
          ? "#06b6d4"
          : "#10b981";
  const valueColorCls = muted
    ? "text-gray-600"
    : clamped >= 90
      ? "text-red-300"
      : clamped >= 70
        ? "text-amber-300"
        : clamped >= 40
          ? "text-cyan-300"
          : "text-emerald-300";

  return (
    <div className="group/tile relative min-w-0 rounded-md border border-white/[0.05] bg-white/[0.015] px-2.5 py-1.5 transition-colors hover:border-white/[0.1] hover:bg-white/[0.03]">
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="text-[9.5px] font-medium uppercase tracking-[0.08em] text-gray-600">
          {label}
        </span>
        {badge ? (
          <span className="font-mono text-[9.5px] text-gray-600">{badge}</span>
        ) : null}
      </div>
      <div className={`mt-0.5 text-[15px] font-semibold leading-none tabular-nums ${valueColorCls}`}>
        {muted ? "—" : `${Math.round(clamped)}%`}
      </div>
      <div className="mt-1.5 h-[2.5px] overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: muted ? 0 : `${clamped}%`, backgroundColor: color }}
        />
      </div>
      {/* hover tooltip — 仅 GPU tile 用,展示多卡热力 */}
      {tooltipContent ? (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100">
          <div className="rounded-md border border-white/[0.08] bg-[#0c0f14] px-2.5 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.5)] whitespace-nowrap">
            {tooltipContent}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** GPU 算力利用率半圆仪表盘 — 与 MonitorPanel 同源,5 个顶级页面收齐后再统一抽到 ui/ */
function GpuUtilGauge({ value }: { value: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, value));
  const radius = 78;
  const cx = 100;
  const cy = 100;
  const arcLength = Math.PI * radius;
  const dashOffset = arcLength * (1 - pct / 100);
  const id = useId().replace(/:/g, "");
  const gradId = `gpu-gauge-${id}`;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" width="200" height="120" className="block">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="38%" stopColor="#06b6d4" />
            <stop offset="72%" stopColor="#f0b040" />
            <stop offset="100%" stopColor="#f85149" />
          </linearGradient>
        </defs>
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          stroke={`url(#${gradId})`}
          strokeOpacity="0.18"
          strokeWidth="11"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          stroke={`url(#${gradId})`}
          strokeWidth="11"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={arcLength}
          strokeDashoffset={dashOffset}
          style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
        />
        <text
          x={cx}
          y={cy - 14}
          textAnchor="middle"
          fill="white"
          fontSize="34"
          fontWeight="600"
          fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace"
          style={{ letterSpacing: "-1px" }}
        >
          {Math.round(pct)}
          <tspan fontSize="16" fill="#6b7280" dx="2">%</tspan>
        </text>
        <text
          x={cx}
          y={cy + 6}
          textAnchor="middle"
          fill="#6b7280"
          fontSize="10"
          fontFamily="ui-monospace, monospace"
          style={{ letterSpacing: "1.5px" }}
        >
          AVG UTIL
        </text>
      </svg>
      <span className="-mt-1 text-[11.5px] text-gray-500">集群平均算力</span>
    </div>
  );
}
