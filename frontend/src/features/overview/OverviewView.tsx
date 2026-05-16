import { useMemo } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { PieChart, BarChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useConsoleStore } from "../../state/ConsoleStore";
import { navigate } from "../../lib/routing";
import { StatusPill } from "../../ui/StatusPill";
import { Button } from "../../ui/Button";
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from "../../ui/Motion";
import { taskStatusLabel, taskStatusTone } from "../../lib/labels";
import { formatRelative } from "../../lib/format";
import styles from "./OverviewView.module.css";

echarts.use([PieChart, BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer]);

export function OverviewView(): JSX.Element {
  const store = useConsoleStore();
  const overview = store.overview;
  const nodeCounts = overview?.node_counts ?? { total: 0, online: 0, offline: 0, disabled: 0, never_seen: 0 };
  const taskCounts = overview?.task_counts ?? {};
  const recentTasks = overview?.recent_tasks ?? [];

  // GPU stats from node snapshots
  const gpuStats = useMemo(() => {
    if (!overview) return { totalGpus: 0, avgUtil: 0, totalVram: 0, usedVram: 0 };
    let totalGpus = 0;
    let totalUtil = 0;
    let totalVram = 0;
    let usedVram = 0;
    for (const node of overview.nodes) {
      if (!node.latest_status) continue;
      for (const gpu of node.latest_status.gpus) {
        const g = gpu as Record<string, unknown>;
        totalGpus++;
        totalUtil += Number(g.utilization_percent ?? 0);
        totalVram += Number(g.total_vram_mb ?? 0);
        usedVram += Number(g.used_vram_mb ?? 0);
      }
    }
    return { totalGpus, avgUtil: totalGpus > 0 ? Math.round(totalUtil / totalGpus) : 0, totalVram, usedVram };
  }, [overview]);

  const nodeChartOption = useMemo(() => ({
    tooltip: { trigger: "item" as const, backgroundColor: "#1a1d24", borderColor: "rgba(255,255,255,0.06)", textStyle: { color: "#edf0f7" } },
    series: [{
      type: "pie" as const,
      radius: ["55%", "80%"],
      center: ["50%", "50%"],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 4, borderColor: "#08090d", borderWidth: 2 },
      label: { show: false },
      data: [
        { value: nodeCounts.online, name: "在线", itemStyle: { color: "#34c88a" } },
        { value: nodeCounts.offline, name: "离线", itemStyle: { color: "#6b7080" } },
        { value: nodeCounts.never_seen, name: "未上线", itemStyle: { color: "#e8a832" } },
        { value: nodeCounts.disabled, name: "停用", itemStyle: { color: "#4a4f59" } },
      ].filter(d => d.value > 0),
    }],
  }), [nodeCounts]);

  const taskChartOption = useMemo(() => {
    const entries = Object.entries(taskCounts);
    const colors: Record<string, string> = {
      pending: "#6b7080", claimed: "#5b8def", running: "#5b8def",
      succeeded: "#34c88a", failed: "#ef5f5f", timeout: "#ef5f5f",
      cancelled: "#4a4f59", lost: "#ef5f5f", cancel_requested: "#e8a832",
    };
    return {
      tooltip: { trigger: "axis" as const, backgroundColor: "#1a1d24", borderColor: "rgba(255,255,255,0.06)", textStyle: { color: "#edf0f7" } },
      grid: { left: 8, right: 8, top: 8, bottom: 24, containLabel: true },
      xAxis: { type: "category" as const, data: entries.map(([k]) => taskStatusLabel[k] ?? k), axisLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } }, axisLabel: { color: "#737882", fontSize: 11 } },
      yAxis: { type: "value" as const, splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)" } }, axisLabel: { color: "#737882", fontSize: 11 } },
      series: [{
        type: "bar" as const,
        data: entries.map(([k, v]) => ({ value: v, itemStyle: { color: colors[k] ?? "#5b8def", borderRadius: [3, 3, 0, 0] } })),
        barWidth: "60%",
      }],
    };
  }, [taskCounts]);

  return (
    <div className={styles.page}>
      <FadeIn>
        <header className={styles.header}>
          <h1 className={styles.title}>总览</h1>
          <span className={styles.serverTime}>{overview?.server_time ? new Date(overview.server_time).toLocaleString("zh-CN") : "—"}</span>
        </header>
      </FadeIn>

      {/* KPI cards */}
      <StaggerList className={styles.kpiGrid}>
        <StaggerItem>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>节点总数</span>
            <span className={styles.kpiValue}><AnimatedNumber value={nodeCounts.total} /></span>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className={`${styles.kpiCard} ${styles.kpiOnline}`}>
            <span className={styles.kpiLabel}>在线</span>
            <span className={styles.kpiValue}><AnimatedNumber value={nodeCounts.online} /></span>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>GPU 总数</span>
            <span className={styles.kpiValue}><AnimatedNumber value={gpuStats.totalGpus} /></span>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>平均 GPU 利用率</span>
            <span className={styles.kpiValue}>{gpuStats.avgUtil}%</span>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>任务总数</span>
            <span className={styles.kpiValue}><AnimatedNumber value={Object.values(taskCounts).reduce((a, b) => a + b, 0)} /></span>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className={`${styles.kpiCard} ${styles.kpiDanger}`}>
            <span className={styles.kpiLabel}>安全告警</span>
            <span className={styles.kpiValue}><AnimatedNumber value={store.warnings.length} /></span>
          </div>
        </StaggerItem>
      </StaggerList>

      {/* Charts row */}
      <FadeIn delay={0.2}>
        <div className={styles.chartsRow}>
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>节点状态分布</h3>
            {nodeCounts.total > 0 ? (
              <ReactEChartsCore echarts={echarts} option={nodeChartOption} style={{ height: 200 }} opts={{ renderer: "canvas" }} />
            ) : (
              <div className={styles.chartEmpty}>暂无节点数据</div>
            )}
          </div>
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>任务状态统计</h3>
            {Object.keys(taskCounts).length > 0 ? (
              <ReactEChartsCore echarts={echarts} option={taskChartOption} style={{ height: 200 }} opts={{ renderer: "canvas" }} />
            ) : (
              <div className={styles.chartEmpty}>暂无任务数据</div>
            )}
          </div>
        </div>
      </FadeIn>

      {/* Recent tasks */}
      <FadeIn delay={0.3}>
        <div className={styles.recentSection}>
          <div className={styles.recentHead}>
            <h3 className={styles.recentTitle}>最近任务</h3>
            <Button size="sm" variant="quiet" onClick={() => navigate({ name: "tasks" })}>查看全部</Button>
          </div>
          {recentTasks.length === 0 ? (
            <div className={styles.recentEmpty}>暂无任务记录</div>
          ) : (
            <div className={styles.recentTable}>
              <table>
                <thead>
                  <tr>
                    <th>任务 ID</th>
                    <th>节点</th>
                    <th>类型</th>
                    <th>状态</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTasks.slice(0, 10).map((t) => (
                    <tr key={t.task_id} onClick={() => navigate({ name: "task-detail", taskId: t.task_id })}>
                      <td className={styles.cellMono}>{t.task_id}</td>
                      <td className={styles.cellMono}>{t.node_id}</td>
                      <td>{t.type}</td>
                      <td><StatusPill tone={taskStatusTone[t.status] ?? "muted"} label={taskStatusLabel[t.status] ?? t.status} /></td>
                      <td className={styles.cellTime}>{formatRelative(t.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </FadeIn>
    </div>
  );
}
