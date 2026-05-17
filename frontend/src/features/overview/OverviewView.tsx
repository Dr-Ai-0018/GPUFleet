import { useMemo } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useConsoleStore } from "../../state/ConsoleStore";
import { navigate } from "../../lib/routing";
import { StatusPill } from "../../ui/StatusPill";
import { taskStatusLabel, taskStatusTone } from "../../lib/labels";
import { formatRelative } from "../../lib/format";

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

const cardCls = "rounded-xl p-5 transition-all duration-300 bg-[linear-gradient(180deg,rgba(16,18,23,0.95)_0%,rgba(10,11,14,0.98)_100%)] border border-white/[0.04] shadow-[0_4px_20px_-2px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:border-white/[0.08]";
const badgeCls = "px-2.5 py-0.5 text-xs font-mono font-medium border rounded-md flex items-center gap-1.5";

export function OverviewView(): JSX.Element {
  const store = useConsoleStore();
  const overview = store.overview;
  const nodeCounts = overview?.node_counts ?? { total: 0, online: 0, offline: 0, disabled: 0, never_seen: 0 };
  const taskCounts = overview?.task_counts ?? {};
  const recentTasks = overview?.recent_tasks ?? [];

  const gpuStats = useMemo(() => {
    if (!overview) return { totalGpus: 0, avgUtil: 0 };
    let totalGpus = 0; let totalUtil = 0;
    for (const node of overview.nodes) {
      if (!node.latest_status) continue;
      for (const gpu of node.latest_status.gpus) {
        const g = gpu as Record<string, unknown>;
        totalGpus++; totalUtil += Number(g.utilization_percent ?? 0);
      }
    }
    return { totalGpus, avgUtil: totalGpus > 0 ? Math.round(totalUtil / totalGpus) : 0 };
  }, [overview]);

  const totalTasks = Object.values(taskCounts).reduce((a, b) => a + b, 0);
  const succeededTasks = (taskCounts as Record<string, number>).succeeded ?? 0;
  const successRate = totalTasks > 0 ? Math.round((succeededTasks / totalTasks) * 100) : 0;

  const lineOption = useMemo(() => ({
    tooltip: { trigger: "axis" as const, backgroundColor: "#0d1117", borderColor: "rgba(255,255,255,0.05)", textStyle: { color: "#c9d1d9", fontSize: 11 } },
    grid: { left: 0, right: 0, top: 10, bottom: 0, containLabel: false },
    xAxis: { type: "category" as const, show: false, data: Array.from({ length: 20 }, (_, i) => `${i}`) },
    yAxis: { type: "value" as const, show: false },
    series: [{ type: "line" as const, smooth: true, symbol: "circle", symbolSize: 4, lineStyle: { color: "#06b6d4", width: 2 }, itemStyle: { color: "#06b6d4" }, areaStyle: { color: { type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(6,182,212,0.15)" }, { offset: 1, color: "rgba(6,182,212,0)" }] } }, data: Array.from({ length: 20 }, () => Math.round(Math.random() * 60 + 20)) }],
  }), []);

  return (
    <div className="max-w-[1300px] mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-bold tracking-tight text-white font-mono">Fleet Overview</h1>
        <span className={`${badgeCls} bg-cyan-950/40 text-cyan-400 border-cyan-800/30`}>{overview?.server_time ? new Date(overview.server_time).toLocaleString("zh-CN") : "—"}</span>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-6 gap-4">
        {[
          { label: "节点总数", val: String(nodeCounts.total) },
          { label: "在线节点", val: String(nodeCounts.online), color: "text-emerald-400" },
          { label: "GPU 总数量", val: String(gpuStats.totalGpus) },
          { label: "算力利用率", val: `${gpuStats.avgUtil}%`, progress: gpuStats.avgUtil },
          { label: "活动任务数", val: String(totalTasks) },
          { label: "安全告警", val: String(store.warnings.length), color: store.warnings.length > 0 ? "text-red-400" : undefined },
        ].map((stat, i) => (
          <div key={i} className={`${cardCls} py-4 px-5`}>
            <div className="text-[11px] text-gray-500 uppercase tracking-wider font-mono font-semibold mb-2">{stat.label}</div>
            <div className={`text-2xl font-bold font-mono tracking-tight ${stat.color || "text-white"}`}>{stat.val}</div>
            {stat.progress !== undefined ? (
              <div className="w-full bg-white/5 h-1 rounded-full mt-3 overflow-hidden"><div className="bg-cyan-500 h-1 rounded-full" style={{ width: `${stat.progress}%` }} /></div>
            ) : null}
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-6">
        <div className={`${cardCls} col-span-2 h-[340px] flex flex-col justify-between`}>
          <div className="flex justify-between items-center">
            <span className="text-[13px] font-bold tracking-wide text-gray-400 font-mono uppercase">吞吐趋势 (Throughput Timeline)</span>
            <span className={`${badgeCls} bg-white/5 text-gray-400 border-white/5`}>实时</span>
          </div>
          <div className="flex-1 mt-4">
            <ReactEChartsCore echarts={echarts} option={lineOption} style={{ height: "100%", width: "100%" }} opts={{ renderer: "canvas" }} />
          </div>
        </div>

        <div className={`${cardCls} col-span-1 h-[340px] flex flex-col justify-between`}>
          <span className="text-[13px] font-bold tracking-wide text-gray-400 font-mono uppercase">任务流统计</span>
          <div className="flex-1 flex items-center justify-center">
            <div className="w-32 h-32 rounded-full border-[14px] border-[#08090C] flex flex-col items-center justify-center" style={{ borderTopColor: "#10b981", borderRightColor: successRate > 50 ? "#10b981" : "#08090C", borderBottomColor: successRate > 75 ? "#10b981" : "#08090C", borderLeftColor: successRate > 25 ? "#10b981" : "#08090C" }}>
              <span className="text-xl font-mono font-bold text-white">{successRate}%</span>
              <span className="text-[10px] text-gray-500">已完成</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent tasks table */}
      <div className={`${cardCls} p-0`}>
        <div className="px-5 py-4 border-b border-white/5 flex justify-between items-center bg-[#090A0D]/50">
          <span className="text-[13px] font-bold tracking-wide text-gray-400 font-mono uppercase">Recent Active Tasks (近线任务)</span>
          <span className="text-[11px] text-cyan-400 hover:text-white cursor-pointer transition-colors" onClick={() => navigate({ name: "tasks" })}>查看全部历史</span>
        </div>
        {recentTasks.length === 0 ? (
          <div className="px-5 py-12 text-center text-xs text-gray-600 font-mono">暂无任务记录</div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500 font-mono uppercase tracking-wider border-b border-white/5 bg-[#090A0D]/20">
              <tr>
                <th className="px-5 py-3 font-medium">任务 ID</th>
                <th className="px-5 py-3 font-medium">指定执行节点</th>
                <th className="px-5 py-3 font-medium">执行类型</th>
                <th className="px-5 py-3 font-medium">最终状态</th>
                <th className="px-5 py-3 font-medium text-right">用时</th>
              </tr>
            </thead>
            <tbody>
              {recentTasks.slice(0, 10).map((t) => (
                <tr key={t.task_id} className="hover:bg-white/[0.01] transition-colors cursor-pointer" onClick={() => navigate({ name: "task-detail", taskId: t.task_id })}>
                  <td className="px-5 py-3.5 font-mono text-cyan-500">{t.task_id}</td>
                  <td className="px-5 py-3.5 font-mono">{t.node_id}</td>
                  <td className="px-5 py-3.5">{t.type}</td>
                  <td className="px-5 py-3.5"><StatusPill tone={taskStatusTone[t.status] ?? "muted"} label={taskStatusLabel[t.status] ?? t.status} /></td>
                  <td className="px-5 py-3.5 text-right font-mono text-gray-500">{formatRelative(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
