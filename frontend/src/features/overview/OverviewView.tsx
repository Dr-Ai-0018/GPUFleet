import { useMemo } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart, BarChart, PieChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useConsoleStore } from "../../state/ConsoleStore";
import { navigate } from "../../lib/routing";
import { StatusPill } from "../../ui/StatusPill";
import { RingGauge } from "../../ui/RingGauge";
import { ArcGauge } from "../../ui/ArcGauge";
import { BlockProgress } from "../../ui/BlockProgress";
import { MiniSparkline } from "../../ui/MiniSparkline";
import { taskStatusLabel, taskStatusTone } from "../../lib/labels";
import { formatRelative, bytesToReadable } from "../../lib/format";

echarts.use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const sectionCls = "rounded-xl bg-[linear-gradient(180deg,rgba(16,18,23,0.95)_0%,rgba(10,11,14,0.98)_100%)] border border-white/[0.04] shadow-[0_4px_20px_-2px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.03)]";
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

export function OverviewView(): JSX.Element {
  const store = useConsoleStore();
  const overview = store.overview;
  const nodeCounts = overview?.node_counts ?? { total: 0, online: 0, offline: 0, disabled: 0, never_seen: 0 };
  const taskCounts = overview?.task_counts ?? {} as Record<string, number>;
  const recentTasks = overview?.recent_tasks ?? [];

  const gpuStats = useMemo(() => {
    if (!overview) return { totalGpus: 0, avgUtil: 0, totalVram: 0, usedVram: 0 };
    let totalGpus = 0, totalUtil = 0, totalVram = 0, usedVram = 0;
    for (const node of overview.nodes) {
      if (!node.latest_status) continue;
      for (const gpu of node.latest_status.gpus) {
        const g = gpu as Record<string, unknown>;
        totalGpus++; totalUtil += Number(g.utilization_percent ?? 0);
        totalVram += Number(g.total_vram_mb ?? 0); usedVram += Number(g.used_vram_mb ?? 0);
      }
    }
    return { totalGpus, avgUtil: totalGpus > 0 ? Math.round(totalUtil / totalGpus) : 0, totalVram, usedVram };
  }, [overview]);

  const totalTasks = Object.values(taskCounts).reduce((a: number, b: number) => a + (b as number), 0);
  const succeededTasks = (taskCounts as Record<string, number>).succeeded ?? 0;
  const failedTasks = ((taskCounts as Record<string, number>).failed ?? 0) + ((taskCounts as Record<string, number>).timeout ?? 0);
  const runningTasks = ((taskCounts as Record<string, number>).running ?? 0) + ((taskCounts as Record<string, number>).claimed ?? 0);
  const onlineRate = nodeCounts.total > 0 ? Math.round((nodeCounts.online / nodeCounts.total) * 100) : 0;
  const throughputSeries = overview?.task_throughput_24h ?? Array(24).fill(0);
  const nodeDist = [
    { label: "在线", value: nodeCounts.online, color: "#0ff0b3" },
    { label: "离线", value: nodeCounts.offline, color: "#f0b040" },
    { label: "停用", value: nodeCounts.disabled, color: "#8b949e" },
    { label: "未上线", value: nodeCounts.never_seen, color: "#7c3aed" },
  ];

  // Chart: throughput timeline
  const lineOption = useMemo(() => ({
    tooltip: { trigger: "axis" as const, backgroundColor: "#0d1117", borderColor: "rgba(255,255,255,0.05)", textStyle: { color: "#c9d1d9", fontSize: 11 } },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: { type: "category" as const, data: Array.from({ length: 24 }, (_, i) => `${i}:00`), axisLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } }, axisLabel: { color: "#4a5568", fontSize: 10 } },
    yAxis: { type: "value" as const, splitLine: { lineStyle: { color: "rgba(255,255,255,0.03)" } }, axisLabel: { color: "#4a5568", fontSize: 10 } },
    series: [{ type: "line" as const, smooth: true, symbol: "circle", symbolSize: 3, lineStyle: { color: "#06b6d4", width: 2 }, itemStyle: { color: "#06b6d4" }, areaStyle: { color: { type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(6,182,212,0.12)" }, { offset: 1, color: "rgba(6,182,212,0)" }] } }, data: overview?.task_throughput_24h ?? Array(24).fill(0) }],
  }), [overview?.task_throughput_24h]);

  // Chart: task status distribution (horizontal bar)
  const taskBarOption = useMemo(() => {
    const entries = Object.entries(taskCounts);
    const colors: Record<string, string> = { pending: "#4a5568", claimed: "#06b6d4", running: "#06b6d4", succeeded: "#10b981", failed: "#ef4444", timeout: "#ef4444", cancelled: "#6b7280", lost: "#ef4444" };
    return {
      tooltip: { trigger: "axis" as const, backgroundColor: "#0d1117", borderColor: "rgba(255,255,255,0.05)", textStyle: { color: "#c9d1d9", fontSize: 11 } },
      grid: { left: 80, right: 20, top: 10, bottom: 20 },
      xAxis: { type: "value" as const, splitLine: { lineStyle: { color: "rgba(255,255,255,0.03)" } }, axisLabel: { color: "#4a5568", fontSize: 10 } },
      yAxis: { type: "category" as const, data: entries.map(([k]) => taskStatusLabel[k] ?? k), axisLabel: { color: "#8b949e", fontSize: 11 }, axisLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
      series: [{ type: "bar" as const, data: entries.map(([k, v]) => ({ value: v, itemStyle: { color: colors[k] ?? "#06b6d4", borderRadius: [0, 3, 3, 0] } })), barWidth: 14 }],
    };
  }, [taskCounts]);

  // Chart: GPU utilization per node
  const gpuBarOption = useMemo(() => {
    if (!overview) return null;
    const nodes = overview.nodes.filter((n) => n.latest_status && n.latest_status.gpus.length > 0);
    if (nodes.length === 0) return null;
    return {
      tooltip: { trigger: "axis" as const, backgroundColor: "#0d1117", borderColor: "rgba(255,255,255,0.05)", textStyle: { color: "#c9d1d9", fontSize: 11 } },
      grid: { left: 100, right: 20, top: 10, bottom: 20 },
      xAxis: { type: "value" as const, max: 100, splitLine: { lineStyle: { color: "rgba(255,255,255,0.03)" } }, axisLabel: { color: "#4a5568", fontSize: 10, formatter: "{value}%" } },
      yAxis: { type: "category" as const, data: nodes.map((n) => n.display_name), axisLabel: { color: "#8b949e", fontSize: 11 }, axisLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
      series: [{ type: "bar" as const, data: nodes.map((n) => { const g = n.latest_status!.gpus[0] as Record<string, unknown>; return { value: Number(g.utilization_percent ?? 0), itemStyle: { color: "#06b6d4", borderRadius: [0, 3, 3, 0] } }; }), barWidth: 16 }],
    };
  }, [overview]);

  return (
    <div className="max-w-[1300px] mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight text-white">Fleet Overview</h1>
        <span className="text-[12px] font-mono text-cyan-400">{overview?.server_time ? beijingDateTimeFormatter.format(new Date(overview.server_time)) : "—"}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr_1fr]">
        <div className={`${sectionCls} overflow-hidden px-6 py-5`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-500">节点总览</p>
              <h2 className="mt-2 text-4xl font-bold tracking-tight text-white">{nodeCounts.total}</h2>
              <p className="mt-1 text-[12px] text-gray-500">Fleet nodes currently registered</p>
            </div>
            <RingGauge value={onlineRate} size={92} label={String(onlineRate)} sublabel="ONLINE" />
          </div>
          <div className="mt-5 space-y-3">
            {nodeDist.map((item) => {
              const width = nodeCounts.total > 0 ? (item.value / nodeCounts.total) * 100 : 0;
              return (
                <div key={item.label}>
                  <div className="mb-1 flex items-center justify-between text-[11px] font-mono">
                    <span className="text-gray-400">{item.label}</span>
                    <span className="text-white">{item.value}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/5">
                    <div className="h-full rounded-full" style={{ width: `${width}%`, background: item.color, boxShadow: `0 0 12px ${item.color}55` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className={`${sectionCls} px-5 py-5`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-500">GPU Cluster</div>
              <div className="mt-2 text-3xl font-bold font-mono text-white">{gpuStats.totalGpus}</div>
              <div className="mt-1 text-[12px] text-gray-500">active accelerators</div>
            </div>
            <ArcGauge value={gpuStats.avgUtil} size={112} color="auto" label={String(gpuStats.avgUtil)} sublabel="AVG UTIL" />
          </div>
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-[11px] font-mono">
              <span className="text-gray-500">VRAM footprint</span>
              <span className="text-white">{gpuStats.usedVram}/{gpuStats.totalVram} MB</span>
            </div>
            <BlockProgress value={gpuStats.totalVram > 0 ? (gpuStats.usedVram / gpuStats.totalVram) * 100 : 0} blocks={18} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2">
              <div className="text-[10px] font-mono uppercase text-gray-500">Total</div>
              <div className="mt-1 text-[15px] font-bold font-mono text-white">{bytesToReadable(gpuStats.totalVram * 1024 * 1024)}</div>
            </div>
            <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2">
              <div className="text-[10px] font-mono uppercase text-gray-500">Used</div>
              <div className="mt-1 text-[15px] font-bold font-mono text-cyan-300">{bytesToReadable(gpuStats.usedVram * 1024 * 1024)}</div>
            </div>
          </div>
        </div>

        <div className={`${sectionCls} px-5 py-5`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-500">Task Pulse</div>
              <div className="mt-2 text-3xl font-bold font-mono text-white">{runningTasks}</div>
              <div className="mt-1 text-[12px] text-gray-500">running now</div>
            </div>
            <div className="rounded-full border border-cyan-400/20 bg-cyan-400/8 px-3 py-1 text-[11px] font-mono text-cyan-300 shadow-[0_0_24px_rgba(15,240,179,0.08)]">
              {store.warnings.length > 0 ? `${store.warnings.length} warnings` : "secure"}
            </div>
          </div>
          <div className="mt-5">
            <MiniSparkline data={throughputSeries} width={260} height={56} className="w-full" />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2">
              <div className="text-[10px] font-mono uppercase text-gray-500">Succeeded</div>
              <div className="mt-1 text-[15px] font-bold font-mono text-emerald-300">{succeededTasks}</div>
            </div>
            <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2">
              <div className="text-[10px] font-mono uppercase text-gray-500">Failed</div>
              <div className="mt-1 text-[15px] font-bold font-mono text-red-300">{failedTasks}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Row: Throughput + Task Status */}
      <div className="grid grid-cols-[2fr_1fr] gap-6">
        <div className={`${sectionCls} p-5`}>
          <div className="flex justify-between items-center mb-4">
            <span className="text-[13px] font-bold text-gray-300 uppercase tracking-wide">吞吐趋势 <span className="text-gray-500 font-normal">(Throughput Timeline)</span></span>
            <span className="text-[10px] font-mono text-gray-500 px-2 py-1 bg-white/5 rounded">北京时间</span>
          </div>
          <ReactEChartsCore echarts={echarts} option={lineOption} style={{ height: 220 }} opts={{ renderer: "canvas" }} />
        </div>

        <div className={`${sectionCls} p-5`}>
          <span className="text-[13px] font-bold text-gray-300 uppercase tracking-wide block mb-4">任务状态分布</span>
          {Object.keys(taskCounts).length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={taskBarOption} style={{ height: 220 }} opts={{ renderer: "canvas" }} />
          ) : (
            <div className="h-[220px] flex items-center justify-center text-gray-600 text-[12px]">暂无数据</div>
          )}
        </div>
      </div>

      {/* Row: GPU utilization per node + VRAM summary + Task summary */}
      <div className="grid grid-cols-3 gap-6">
        <div className={`${sectionCls} p-5 col-span-1`}>
          <span className="text-[13px] font-bold text-gray-300 uppercase tracking-wide block mb-4">GPU 集群利用率</span>
          {gpuBarOption ? (
            <ReactEChartsCore echarts={echarts} option={gpuBarOption} style={{ height: 160 }} opts={{ renderer: "canvas" }} />
          ) : (
            <div className="h-[160px] flex items-center justify-center text-gray-600 text-[12px]">无 GPU 数据</div>
          )}
        </div>

        <div className={`${sectionCls} p-5 col-span-1`}>
          <span className="text-[13px] font-bold text-gray-300 uppercase tracking-wide block mb-4">显存使用</span>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-[12px] mb-1.5"><span className="text-gray-400">已用 / 总量</span><span className="text-white font-mono font-bold">{gpuStats.usedVram} / {gpuStats.totalVram} MB</span></div>
              <div className="h-3 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-cyan-500 rounded-full" style={{ width: `${gpuStats.totalVram > 0 ? (gpuStats.usedVram / gpuStats.totalVram) * 100 : 0}%` }} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-white/5">
              <div><span className="text-[10px] text-gray-500 font-mono uppercase block mb-1">Total VRAM</span><span className="text-lg font-bold font-mono text-white">{bytesToReadable(gpuStats.totalVram * 1024 * 1024)}</span></div>
              <div><span className="text-[10px] text-gray-500 font-mono uppercase block mb-1">Used</span><span className="text-lg font-bold font-mono text-cyan-400">{bytesToReadable(gpuStats.usedVram * 1024 * 1024)}</span></div>
            </div>
          </div>
        </div>

        <div className={`${sectionCls} p-5 col-span-1`}>
          <span className="text-[13px] font-bold text-gray-300 uppercase tracking-wide block mb-4">任务统计</span>
          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-[10px] text-gray-500 font-mono uppercase block mb-1">Total</span><span className="text-2xl font-bold font-mono text-white">{totalTasks}</span></div>
            <div><span className="text-[10px] text-gray-500 font-mono uppercase block mb-1">Succeeded</span><span className="text-2xl font-bold font-mono text-emerald-400">{succeededTasks}</span></div>
            <div><span className="text-[10px] text-gray-500 font-mono uppercase block mb-1">Failed</span><span className="text-2xl font-bold font-mono text-red-400">{failedTasks}</span></div>
            <div><span className="text-[10px] text-gray-500 font-mono uppercase block mb-1">Running</span><span className="text-2xl font-bold font-mono text-cyan-400">{runningTasks}</span></div>
          </div>
        </div>
      </div>

      {/* Node health bars */}
      {overview && overview.nodes.length > 0 ? (
        <div className={`${sectionCls} p-5`}>
          <span className="text-[13px] font-bold text-gray-300 uppercase tracking-wide block mb-4">节点健康度</span>
          <div className="space-y-3">
            {overview.nodes.map((node) => {
              const cpu = node.latest_status?.cpu as { usage_percent?: number } | undefined;
              const mem = node.latest_status?.memory as { usage_percent?: number } | undefined;
              const gpu = node.latest_status?.gpus?.[0] as { utilization_percent?: number } | undefined;
              const cpuPct = Number(cpu?.usage_percent ?? 0);
              const memPct = Number(mem?.usage_percent ?? 0);
              const gpuPct = Number(gpu?.utilization_percent ?? 0);
              return (
                <div key={node.node_id} className="flex items-center gap-4 py-2 border-b border-white/[0.03] last:border-0 cursor-pointer hover:bg-white/[0.02] -mx-2 px-2 rounded" onClick={() => navigate({ name: "node-detail", nodeId: node.node_id })}>
                  <div className="w-[140px] shrink-0"><span className="text-[13px] text-white font-medium">{node.display_name}</span></div>
                  <div className="flex-1 grid grid-cols-3 gap-4">
                    <div className="flex items-center gap-2"><span className="text-[10px] text-gray-500 font-mono w-8">CPU</span><div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-cyan-500 rounded-full" style={{ width: `${cpuPct}%` }} /></div><span className="text-[11px] font-mono text-gray-400 w-10 text-right">{Math.round(cpuPct)}%</span></div>
                    <div className="space-y-1"><span className="text-[10px] text-gray-500 font-mono">MEM</span><BlockProgress value={memPct} blocks={10} height={7} color="auto" /><div className="text-right text-[11px] font-mono text-gray-400">{Math.round(memPct)}%</div></div>
                    <div className="flex items-center justify-between gap-3"><div><span className="text-[10px] text-gray-500 font-mono block">GPU</span><span className="text-[11px] font-mono text-gray-400">{Math.round(gpuPct)}%</span></div><ArcGauge value={gpuPct} size={74} color="auto" label={String(Math.round(gpuPct))} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Recent tasks */}
      <div className={`${sectionCls} p-0 overflow-hidden`}>
        <div className="px-5 py-4 border-b border-white/5 flex justify-between items-center">
          <span className="text-[13px] font-bold text-gray-300 uppercase tracking-wide">Recent Active Tasks <span className="text-gray-500 font-normal">(近线任务)</span></span>
          <span className="text-[11px] text-cyan-400 hover:text-white cursor-pointer transition-colors" onClick={() => navigate({ name: "tasks" })}>查看全部历史</span>
        </div>
        {recentTasks.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-gray-600">暂无任务记录</div>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="text-gray-500 text-[11px] font-mono uppercase tracking-wider border-b border-white/5">
              <tr><th className="px-5 py-3">任务 ID</th><th className="px-5 py-3">执行节点</th><th className="px-5 py-3">类型</th><th className="px-5 py-3">状态</th><th className="px-5 py-3 text-right">时间</th></tr>
            </thead>
            <tbody>
              {recentTasks.slice(0, 10).map((t) => (
                <tr key={t.task_id} className="hover:bg-white/[0.02] transition-colors cursor-pointer border-b border-white/[0.03] last:border-0" onClick={() => navigate({ name: "task-detail", taskId: t.task_id })}>
                  <td className="px-5 py-3.5 font-mono text-cyan-500 text-[12px]">{t.task_id}</td>
                  <td className="px-5 py-3.5 font-mono text-gray-400 text-[12px]">{t.node_id}</td>
                  <td className="px-5 py-3.5 text-gray-300">{t.type}</td>
                  <td className="px-5 py-3.5"><StatusPill tone={taskStatusTone[t.status] ?? "muted"} label={taskStatusLabel[t.status] ?? t.status} /></td>
                  <td className="px-5 py-3.5 text-right font-mono text-gray-500 text-[12px]">{formatRelative(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
