import { useCallback, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { api } from "../../../api";
import { bytesToReadable, formatRelative, prettyJson } from "../../../lib/format";
import { CodeBlock } from "../../../ui/CodeBlock";
import { MiniSparkline } from "../../../ui/MiniSparkline";
import { GpuUtilGauge } from "../../../ui/GpuUtilGauge";
import { TempColorBand } from "../../../ui/TempColorBand";
import { TimeRangePicker } from "../../../ui/TimeRangePicker";
import { useConsoleStore } from "../../../state/ConsoleStore";
import { getRangeSpec, formatTick, type RangeKey } from "../../../lib/timeRange";
import { useSmoothFeeder } from "../../../lib/useSmoothFeeder";
import type { NodeStatusHistoryItem } from "../../../types";
import { bytesPerSecondToReadable, availabilityText } from "./shared";
import type { GpuSnapshot, MonitorPanelProps, NetworkSnapshot, NvidiaSnapshot } from "./types";

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const CHART_OPTS = { renderer: "canvas" as const };

export function MonitorPanel({
  nodeId,
  cpu,
  memory,
  pythonEnv,
  gpus,
  cpuUse,
  memUse,
  latestStatus,
  showJson,
  setShowJson,
}: MonitorPanelProps): JSX.Element {
  const { callApi } = useConsoleStore();
  const [range, setRange] = useState<RangeKey>("30s");
  const rangeSpec = useMemo(() => getRangeSpec(range), [range]);

  // 用户选择的窗口 + 节点 id 决定的 fetcher: 拉 [now - window, now] 区间
  const fetcher = useCallback(async () => {
    const sinceIso = new Date(Date.now() - rangeSpec.windowMs).toISOString();
    const res = await callApi((token) =>
      api.getNodeStatusHistory(token, nodeId, { since: sinceIso, limit: rangeSpec.limit }),
    );
    return res.items;
  }, [callApi, nodeId, rangeSpec.windowMs, rangeSpec.limit]);

  // LTTB 降密"代表性"指标 — CPU% 是大多数节点画面的中心
  const getX = useCallback((r: NodeStatusHistoryItem) => new Date(r.reported_at).getTime(), []);
  const getYRep = useCallback((r: NodeStatusHistoryItem) => r.cpu_usage_percent ?? null, []);

  // ~800-1000px 宽图, 每 2px 一点 ≈ 400-500. 配合 RANGE_PRESETS 短窗口 limit ≤ 500 → 不触发 LTTB,
  // 真实 1Hz 点全展示, 没有"平稳段被抹平"的问题. 长窗口 (1h+) 仍降密.
  const maxPoints = 500;

  const feeder = useSmoothFeeder<NodeStatusHistoryItem>({
    fetcher,
    getX,
    getY: getYRep,
    fetchIntervalMs: rangeSpec.fetchIntervalMs,
    tickMs: rangeSpec.tickMs,
    maxPoints,
  });

  const historyItems = feeder.records;

  const xAxisFormatter = useCallback(
    (val: number) => formatTick(val, rangeSpec.xAxisFormat),
    [rangeSpec.xAxisFormat],
  );

  // 共用的 xAxis (type='time' 让 ECharts 按真实时间戳自动布局, LTTB 出来的不连续 ts 也能正确放)
  const sharedXAxis = useMemo(() => ({
    type: "time" as const,
    axisLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } },
    axisLabel: {
      color: "#4a5568",
      fontSize: 9,
      formatter: xAxisFormatter,
      hideOverlap: true,
    },
  }), [xAxisFormatter]);

  const cpuHistoryOption = useMemo(() => ({
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: "#0d1117",
      borderColor: "rgba(255,255,255,0.05)",
      textStyle: { color: "#c9d1d9", fontSize: 11 },
      formatter: (params: Array<{ value?: [number, number | null] }>) => `CPU ${params[0]?.value?.[1] ?? 0}%`,
    },
    grid: { left: 36, right: 8, top: 8, bottom: 22 },
    xAxis: sharedXAxis,
    yAxis: { type: "value" as const, min: 0, max: 100, splitLine: { lineStyle: { color: "rgba(255,255,255,0.03)" } }, axisLabel: { color: "#4a5568", fontSize: 9, formatter: "{value}%" } },
    series: [{
      type: "line" as const,
      smooth: 0.3,
      symbol: "none",
      connectNulls: true, // 数据断点穿透连线
      lineStyle: { color: "#06b6d4", width: 1.5 },
      areaStyle: { color: { type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(6,182,212,0.15)" }, { offset: 1, color: "rgba(6,182,212,0)" }] } },
      data: historyItems.map<[number, number | null]>((item) => [new Date(item.reported_at).getTime(), item.cpu_usage_percent ?? null]),
    }],
  }), [historyItems, sharedXAxis]);

  const gpuLoadHistoryOption = useMemo(() => ({
    tooltip: { trigger: "axis" as const, backgroundColor: "#0d1117", borderColor: "rgba(255,255,255,0.05)", textStyle: { color: "#c9d1d9", fontSize: 11 } },
    legend: { top: 0, right: 0, textStyle: { color: "#6b7280", fontSize: 10 }, itemWidth: 10, itemHeight: 4 },
    grid: { left: 34, right: 12, top: 28, bottom: 22 },
    xAxis: sharedXAxis,
    yAxis: { type: "value" as const, min: 0, max: 100, splitLine: { lineStyle: { color: "rgba(255,255,255,0.03)" } }, axisLabel: { color: "#4a5568", fontSize: 9, formatter: "{value}%" } },
    series: [
      {
        name: "GPU Util",
        type: "line" as const,
        smooth: 0.3,
        symbol: "none",
        connectNulls: true,
        lineStyle: { color: "#06b6d4", width: 1.8 },
        areaStyle: { color: { type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(6,182,212,0.16)" }, { offset: 1, color: "rgba(6,182,212,0)" }] } },
        data: historyItems.map<[number, number | null]>((item) => [new Date(item.reported_at).getTime(), item.gpu_utilization_percent ?? null]),
      },
      {
        name: "VRAM",
        type: "line" as const,
        smooth: 0.3,
        symbol: "none",
        connectNulls: true,
        lineStyle: { color: "#22c55e", width: 1.5 },
        data: historyItems.map<[number, number | null]>((item) => [new Date(item.reported_at).getTime(), item.gpu_memory_percent ?? null]),
      },
    ],
  }), [historyItems, sharedXAxis]);

  const gpuThermalHistoryOption = useMemo(() => ({
    tooltip: { trigger: "axis" as const, backgroundColor: "#0d1117", borderColor: "rgba(255,255,255,0.05)", textStyle: { color: "#c9d1d9", fontSize: 11 } },
    legend: { top: 0, right: 0, textStyle: { color: "#6b7280", fontSize: 10 }, itemWidth: 10, itemHeight: 4 },
    grid: { left: 34, right: 38, top: 28, bottom: 22 },
    xAxis: sharedXAxis,
    yAxis: [
      { type: "value" as const, splitLine: { lineStyle: { color: "rgba(255,255,255,0.03)" } }, axisLabel: { color: "#4a5568", fontSize: 9 } },
      { type: "value" as const, splitLine: { show: false }, axisLabel: { color: "#4a5568", fontSize: 9 } },
    ],
    series: [
      { name: "Temp", type: "line" as const, smooth: 0.3, symbol: "none", connectNulls: true, lineStyle: { color: "#f97316", width: 1.5 }, data: historyItems.map<[number, number | null]>((item) => [new Date(item.reported_at).getTime(), item.gpu_temperature_c ?? null]) },
      { name: "Power", type: "line" as const, smooth: 0.3, symbol: "none", connectNulls: true, yAxisIndex: 1, lineStyle: { color: "#f59e0b", width: 1.5 }, data: historyItems.map<[number, number | null]>((item) => [new Date(item.reported_at).getTime(), item.gpu_power_draw_w ?? null]) },
      { name: "Clock", type: "line" as const, smooth: 0.3, symbol: "none", connectNulls: true, yAxisIndex: 1, lineStyle: { color: "#a78bfa", width: 1.3 }, data: historyItems.map<[number, number | null]>((item) => [new Date(item.reported_at).getTime(), item.gpu_clock_graphics_mhz ?? null]) },
    ],
  }), [historyItems, sharedXAxis]);

  if (!latestStatus) {
    return <div className="py-20 text-center text-[13px] text-gray-500">等待节点首次心跳上报</div>;
  }

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
  const primaryGpu = (gpus[0] as GpuSnapshot | undefined) ?? null;
  const primaryGpuUtil = Number(primaryGpu?.utilization_percent ?? 0);
  const primaryGpuVramPct = primaryGpu && Number(primaryGpu.total_vram_mb ?? 0) > 0
    ? Math.round((Number(primaryGpu.used_vram_mb ?? 0) / Number(primaryGpu.total_vram_mb ?? 1)) * 100)
    : 0;

  return (
    <div className="py-2">
      {/* ═══════ TOP BAR — title + actions ═══════ */}
      <header className="mb-10 flex items-end justify-between gap-6 border-b border-white/[0.045] pb-7">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-white">硬件监控</h2>
          <p className="mt-1.5 text-[13px] leading-6 text-gray-500">
            节点 agent 上报的实时遥测,采样 1 s,平滑播放。最近更新 <span className="text-cyan-400">{formatRelative(latestStatus.reported_at)}</span>。
          </p>
        </div>
        <TimeRangePicker value={range} onChange={setRange} />
      </header>

      {/* ═══════ MAIN + SIDEBAR LAYOUT ═══════ */}
      <div className="grid grid-cols-1 gap-x-14 gap-y-16 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* ╔════ MAIN COLUMN ════╗ */}
        <div className="min-w-0 space-y-16">

      {/* ═════════ Section: 处理器 ═════════ */}
      <section>
        <SectionHeading
          title="处理器"
          subtitle={cpu?.model ?? "未知 CPU"}
          right={<span className="text-[12px] text-gray-500">{physicalCoreCount ? `${physicalCoreCount} 物理核 · ` : ""}{coreCount} 逻辑线程</span>}
        />

        <div className="mt-8 grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
          {/* Left column — 4 stats stacked vertically */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-7 self-start xl:grid-cols-1 xl:gap-y-6">
            <InlineKv label="负载" value={`${Math.round(cpuUse)}%`} />
            <InlineKv label="当前频率" value={currentClock != null ? `${currentClock} MHz` : "—"} />
            <InlineKv label="最大频率" value={maxClock != null ? `${maxClock} MHz` : "—"} />
            <InlineKv label="后端" value={pythonEnv?.supported_backends ? String(pythonEnv.supported_backends.length) : "—"} />
          </div>

          {/* Right column — chart */}
          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between text-[12px] text-gray-500">
              <span>CPU 历史</span>
              <span className="font-mono text-gray-600">{formatRelative(latestStatus.reported_at)}</span>
            </div>
            {historyItems.length > 0 ? (
              <HistoryChart chartKey={`${nodeId}:cpu`} option={cpuHistoryOption} height={200} />
            ) : (
              <div className="flex h-[200px] items-center justify-center text-[12px] text-gray-600">等待历史数据…</div>
            )}
          </div>
        </div>

        {/* Per-core grid — full width below mosaic */}
        {perCore.length > 0 ? (
          <div className="mt-10">
            <div className="mb-3 flex items-center justify-between text-[12px] text-gray-500">
              <span>每核占用</span>
              <span className="font-mono text-gray-600">{perCore.length} 线程</span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-4 xl:grid-cols-8 2xl:grid-cols-10">
              {perCore.map((value, idx) => {
                const pct = Math.max(0, Math.min(100, Math.round(value)));
                return (
                  <div key={idx}>
                    <div className="mb-1.5 flex items-center justify-between text-[10.5px] font-mono">
                      <span className="text-gray-500">C{idx}</span>
                      <span className="text-white/80">{pct}%</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-white/[0.05]">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: pct >= 90 ? "#f85149" : pct >= 70 ? "#f0b040" : "#06b6d4" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      {/* ═════════ Section: 内存 ═════════ */}
      <section>
        <SectionHeading
          title="内存"
          subtitle={`${bytesToReadable(memUsed)} / ${bytesToReadable(memTotal)}`}
          right={<span className="text-[12px] text-gray-500">压力 <span className="text-white">{Math.round(memUse)}%</span></span>}
        />

        <div className="mt-8 grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {/* Left — gauge + composition + headline numbers */}
          <div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-400 to-emerald-400 transition-all" style={{ width: `${memUse}%` }} />
            </div>
            <MemoryCompositionBar total={memTotal} used={memUsed} cached={memCached ?? 0} available={memAvailable ?? 0} className="mt-6" />
            <div className="mt-9 grid grid-cols-3 gap-x-10">
              <InlineKv label="Available" value={memAvailable != null ? bytesToReadable(memAvailable) : "—"} large />
              <InlineKv label="Cached" value={memCached != null ? bytesToReadable(memCached) : "—"} large />
              <InlineKv label="Reserved" value={hardwareReserved != null ? bytesToReadable(hardwareReserved) : "—"} large />
            </div>
          </div>

          {/* Right — secondary details, 2x3 mini grid */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-7">
            <InlineKv label="Commit" value={memCommitUsed != null && memCommitLimit != null ? `${bytesToReadable(memCommitUsed)} / ${bytesToReadable(memCommitLimit)}` : "—"} />
            <InlineKv label="Paged Pool" value={pagedPool != null ? bytesToReadable(pagedPool) : "—"} />
            <InlineKv label="Nonpaged" value={nonpagedPool != null ? bytesToReadable(nonpagedPool) : "—"} />
            <InlineKv label="Speed" value={memSpeed != null ? `${memSpeed} MT/s` : "—"} />
            <InlineKv label="Slots" value={slotsUsed != null ? `${slotsUsed}/${slotsTotal ?? "?"}` : "—"} />
            <InlineKv label="Form" value={formFactor && memoryType ? `${formFactor} · ${memoryType}` : (formFactor ?? memoryType ?? "—")} />
          </div>
        </div>
      </section>

      {/* ═════════ Section: GPU (per device) ═════════ */}
      {gpus.length === 0 ? (
        <section>
          <div className="py-8 text-center text-[13px] text-gray-600">无 GPU 设备检测到</div>
        </section>
      ) : (
        gpus.map((gpu, idx) => {
          const currentGpu = gpu as GpuSnapshot;
          const used = Number(currentGpu.used_vram_mb ?? 0);
          const total = Number(currentGpu.total_vram_mb ?? 0);
          const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
          const util = Number(currentGpu.utilization_percent ?? 0);
          const temp = currentGpu.temperature_c != null ? Number(currentGpu.temperature_c) : null;
          const powerDraw = currentGpu.power_draw_w != null ? Number(currentGpu.power_draw_w) : null;
          const powerLimit = currentGpu.power_limit_w != null ? Number(currentGpu.power_limit_w) : null;
          const clockCur = currentGpu.clock_graphics_mhz != null ? Number(currentGpu.clock_graphics_mhz) : null;
          const clockMax = currentGpu.clock_max_graphics_mhz != null ? Number(currentGpu.clock_max_graphics_mhz) : null;
          const clockVideo = currentGpu.clock_video_mhz != null ? Number(currentGpu.clock_video_mhz) : null;
          const fan = currentGpu.fan_speed_percent != null ? Number(currentGpu.fan_speed_percent) : null;
          const pcieGen = currentGpu.pcie_gen != null ? Number(currentGpu.pcie_gen) : null;
          const pcieWidth = currentGpu.pcie_width != null ? Number(currentGpu.pcie_width) : null;
          const encoderUtil = currentGpu.encoder_utilization_percent != null ? Number(currentGpu.encoder_utilization_percent) : null;
          const decoderUtil = currentGpu.decoder_utilization_percent != null ? Number(currentGpu.decoder_utilization_percent) : null;
          const gpuIndex = typeof currentGpu.index === "number" ? currentGpu.index : idx;

          return (
            <section key={idx}>
              <SectionHeading
                title={`GPU #${gpuIndex}`}
                subtitle={String(currentGpu.model ?? "Unknown GPU")}
                right={
                  <div className="flex items-center gap-3">
                    <TempColorBand temp={temp} width={90} height={5} />
                    <span className="text-[12px] text-gray-500">{temp != null ? `${Math.round(temp)}°C` : "—"}</span>
                    {pcieGen != null ? <span className="text-[12px] font-mono text-gray-600">PCIe Gen{pcieGen} x{pcieWidth ?? "?"}</span> : null}
                    <span className="text-[12px] font-mono text-gray-500">{total} MB</span>
                    <span className={`rounded px-2 py-0.5 text-[10.5px] font-mono font-semibold ${util > 80 ? "bg-red-500/15 text-red-300" : util > 30 ? "bg-cyan-500/15 text-cyan-300" : "bg-emerald-500/15 text-emerald-300"}`}>{util > 0 ? "Active" : "Idle"}</span>
                  </div>
                }
              />

              {/* Bars on left (1/3) + charts side-by-side on right (2/3) */}
              <div className="mt-8 grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                {/* 左列 — 上下居中, 撑满 row 高度 */}
                <div className="flex flex-col justify-center gap-8">
                  {/* 算力利用率 仪表盘 + 显存竖条 (中央对齐) */}
                  <div className="flex items-center justify-center gap-8">
                    <GpuUtilGauge value={util} />
                    <VramVerticalBar pct={pct} usedMb={used} totalMb={total} />
                  </div>
                  {/* 功耗 横向条 */}
                  {powerDraw != null && powerLimit != null ? (
                    <BarRow label="功耗" value={`${powerDraw.toFixed(1)} W / ${powerLimit} W`} pct={Math.min(100, (powerDraw / powerLimit) * 100)} color="bg-amber-500/70" />
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div>
                    <div className="mb-3 flex items-center justify-between text-[12px] text-gray-500">
                      <span>负载时间线</span>
                      <span className="font-mono text-gray-600">Util · VRAM</span>
                    </div>
                    {idx === 0 && historyItems.length > 1 ? (
                      <HistoryChart chartKey={`${nodeId}:gpu-load`} option={gpuLoadHistoryOption} height={240} />
                    ) : (
                      <div className="flex h-[240px] items-center justify-center text-[12px] text-gray-600">等待 GPU 历史数据…</div>
                    )}
                  </div>
                  <div>
                    <div className="mb-3 flex items-center justify-between text-[12px] text-gray-500">
                      <span>温度 / 功耗 / 时钟</span>
                      <span className="font-mono text-gray-600">Temp · Power · Clock</span>
                    </div>
                    {idx === 0 && historyItems.length > 1 ? (
                      <HistoryChart chartKey={`${nodeId}:gpu-thermal`} option={gpuThermalHistoryOption} height={240} />
                    ) : (
                      <div className="flex h-[240px] items-center justify-center text-[12px] text-gray-600">等待 GPU 历史数据…</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Metrics grid below — 4 col x 3 row */}
              <div className="mt-10 grid grid-cols-2 gap-x-10 gap-y-7 sm:grid-cols-4 xl:grid-cols-6">
                <InlineKv label="Power" value={powerDraw != null ? `${powerDraw.toFixed(0)} W` : "—"} />
                <InlineKv label="Fan" value={fan != null ? `${fan}%` : "N/A"} />
                <InlineKv label="Clock" value={clockCur != null ? `${clockCur} MHz` : "—"} />
                <InlineKv label="Boost" value={clockMax != null ? `${clockMax} MHz` : "—"} />
                <InlineKv label="Video Clock" value={clockVideo != null ? `${clockVideo} MHz` : "—"} />
                <InlineKv label="Power Cap" value={powerLimit != null ? `${powerLimit} W` : "N/A"} />
                <InlineKv label="Driver" value={nvidia.driver_version ?? "—"} />
                <InlineKv label="CUDA" value={nvidia.cuda_version ?? "—"} />
                <InlineKv label="NVCC" value={nvidia.nvcc_version ?? "Not Installed"} />
                <InlineKv label="PCIe" value={pcieGen != null ? `Gen${pcieGen} x${pcieWidth ?? "?"}` : "—"} />
                <InlineKv label="Encoder" value={encoderUtil != null ? `${encoderUtil}%` : "N/A"} />
                <InlineKv label="Decoder" value={decoderUtil != null ? `${decoderUtil}%` : "N/A"} />
              </div>
            </section>
          );
        })
      )}
        {/* ╚════ END MAIN COLUMN ════╝ */}
        </div>

        {/* ╔════ RIGHT SIDEBAR ════╗ */}
        <aside className="space-y-8 self-start xl:sticky xl:top-2">
          {/* KPI stack — 4 vertical mini tiles */}
          <div className="space-y-3.5">
            <SidebarKpi
              label="CPU"
              value={`${Math.round(cpuUse)}%`}
              meta={`${physicalCoreCount ?? "?"}C / ${coreCount}T`}
              accent="cyan"
              barPct={cpuUse}
              spark={<MiniSparkline data={historyItems.map((i) => i.cpu_usage_percent ?? 0)} width={260} height={22} color="#06b6d4" fillOpacity={0.08} />}
            />
            <SidebarKpi
              label="内存"
              value={`${Math.round(memUse)}%`}
              meta={`${bytesToReadable(memUsed)} / ${bytesToReadable(memTotal)}`}
              accent="emerald"
              barPct={memUse}
              spark={<MiniSparkline data={historyItems.map((i) => i.memory_usage_percent ?? 0)} width={260} height={22} color="#10b981" fillOpacity={0.10} />}
            />
            <SidebarKpi
              label="主 GPU"
              value={primaryGpu ? `${primaryGpuUtil}%` : "—"}
              meta={primaryGpu ? `${primaryGpuVramPct}% VRAM` : "无加速卡"}
              accent="violet"
              barPct={primaryGpu ? primaryGpuUtil : 0}
              spark={primaryGpu ? <MiniSparkline data={historyItems.map((i) => i.gpu_utilization_percent ?? 0)} width={260} height={22} color="#a78bfa" fillOpacity={0.10} /> : undefined}
            />
            <SidebarKpi
              label="网络"
              value={availabilityText(network?.link_speed, "N/A")}
              meta={availabilityText(network?.adapter_name, "未连接")}
              accent="sky"
              extra={
                <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
                  <span>↓ {bytesPerSecondToReadable(network?.rx_bytes_per_sec)}</span>
                  <span>↑ {bytesPerSecondToReadable(network?.tx_bytes_per_sec)}</span>
                </div>
              }
            />
          </div>

          {/* 网络详细 */}
          <div className="border-t border-white/[0.045] pt-6">
            <div className="mb-4 text-[12px] font-semibold text-white">网络</div>
            <div className="space-y-3">
              <SidebarKv label="SSID" value={availabilityText(network?.ssid, "Wired / Hidden")} />
              <SidebarKv label="Link" value={availabilityText(network?.link_speed)} />
              <SidebarKv label="IPv4" value={availabilityText(network?.ipv4_address)} />
              <SidebarKv label="IPv6" value={availabilityText(network?.ipv6_address)} />
              <SidebarKv label="Adapter" value={availabilityText(network?.interface_description ?? network?.adapter_name)} />
              <SidebarKv label="Radio" value={availabilityText(network?.radio_type)} />
              <SidebarKv label="Signal" value={availabilityText(network?.signal)} />
            </div>
          </div>

          {/* 运行时 */}
          <div className="border-t border-white/[0.045] pt-6">
            <div className="mb-4 text-[12px] font-semibold text-white">运行时</div>
            <div className="space-y-3">
              <SidebarKv label="Python" value={pythonEnv?.python_version ?? "—"} />
              <SidebarKv label="Env" value={pythonEnv?.active_environment_kind ?? "—"} />
              <SidebarKv label="Backends" value={pythonEnv?.supported_backends ? String(pythonEnv.supported_backends.length) : "—"} />
              <SidebarKv label="心跳" value={formatRelative(latestStatus.reported_at)} />
            </div>
          </div>
        </aside>
        {/* ╚════ END RIGHT SIDEBAR ════╝ */}
      </div>

      {/* ═══════ BOTTOM — Raw JSON drawer (full width) ═══════ */}
      <section className="mt-12 border-t border-white/[0.045] pt-6">
        <div onClick={() => setShowJson(!showJson)} className="flex cursor-pointer items-center justify-between text-[12.5px] text-gray-500 hover:text-gray-300 transition-colors">
          <span>{showJson ? "▾ 折叠原始 JSON" : "▸ 查看原始 JSON 数据"} <span className="ml-1 text-gray-600">(Raw Snapshot)</span></span>
          <span className="font-mono text-gray-600">snapshot.json</span>
        </div>
        {showJson ? <div className="mt-4"><CodeBlock label="snapshot.json" value={prettyJson(latestStatus)} maxHeight={300} /></div> : null}
      </section>
    </div>
  );
}

function HistoryChart({ chartKey, option, height }: { chartKey: string; option: object; height: number }): JSX.Element {
  return (
    <ReactEChartsCore
      key={chartKey}
      echarts={echarts}
      option={option}
      style={{ height }}
      opts={CHART_OPTS}
      notMerge={false}
      lazyUpdate
    />
  );
}

/** Sidebar KPI tile — 紧凑垂直堆叠在右栏 */
function SidebarKpi({
  label,
  value,
  meta,
  accent,
  barPct,
  spark,
  extra,
}: {
  label: string;
  value: string;
  meta: string;
  accent: "cyan" | "violet" | "emerald" | "sky";
  barPct?: number;
  spark?: JSX.Element;
  extra?: JSX.Element;
}): JSX.Element {
  const accentColors: Record<string, { text: string; bar: string }> = {
    cyan: { text: "text-cyan-300", bar: "from-cyan-600 to-cyan-400" },
    violet: { text: "text-violet-300", bar: "from-violet-600 to-violet-400" },
    emerald: { text: "text-emerald-300", bar: "from-emerald-600 to-emerald-400" },
    sky: { text: "text-sky-300", bar: "from-sky-600 to-sky-400" },
  };
  const c = accentColors[accent];
  return (
    <div className="rounded-md border border-white/[0.05] bg-[#0b0e13] px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11.5px] font-medium text-gray-500">{label}</span>
        <span className="font-mono text-[10.5px] text-gray-600">{meta}</span>
      </div>
      <div className={`mt-1.5 text-[22px] font-semibold leading-none tracking-[-0.02em] ${c.text}`}>{value}</div>
      {barPct != null ? (
        <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-white/[0.05]">
          <div className={`h-full rounded-full bg-gradient-to-r ${c.bar} transition-all duration-700`} style={{ width: `${Math.min(100, Math.max(0, barPct))}%` }} />
        </div>
      ) : null}
      {spark ? <div className="mt-2 opacity-80">{spark}</div> : null}
      {extra}
    </div>
  );
}

/** Sidebar K-V 一行 — label 左, value 右, 中间细线对齐 */
function SidebarKv({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-white/90">{value}</span>
    </div>
  );
}

/** Section 标题 — 大标题 + 副标题 + 可选右侧元信息 */
function SectionHeading({ title, subtitle, right }: { title: string; subtitle?: string; right?: JSX.Element }): JSX.Element {
  return (
    <div className="flex items-end justify-between gap-6">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-white tracking-[-0.005em]">{title}</h3>
        {subtitle ? <p className="mt-1 text-[12.5px] leading-5 text-gray-500">{subtitle}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

/** 内联 K-V 单元 — label 上, value 下, 可读且不会"过装饰" */
function InlineKv({ label, value, large }: { label: string; value: string; large?: boolean }): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-gray-500">{label}</div>
      <div className={`mt-2.5 break-all font-mono text-white ${large ? "text-[18px] font-semibold" : "text-[13px]"}`}>{value}</div>
    </div>
  );
}

/** GPU 显存竖向进度条 — 仪表盘右侧, 像带刻度的温度计 */
function VramVerticalBar({ pct, usedMb, totalMb }: { pct: number; usedMb: number; totalMb: number }): JSX.Element {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = clamped >= 90 ? "bg-red-500" : clamped >= 70 ? "bg-amber-500" : "bg-cyan-400";
  const barHeight = 150; // px
  const ticks = [100, 75, 50, 25, 0];
  return (
    <div className="flex flex-col items-center gap-2.5">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-gray-500">VRAM</span>
      <div className="flex items-stretch gap-1.5" style={{ height: `${barHeight}px` }}>
        {/* 刻度尺 — 左侧, 5 个 tick + 数字 */}
        <div className="relative w-7">
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute right-0 flex items-center gap-1"
              style={{ top: `${100 - t}%`, transform: "translateY(-50%)" }}
            >
              <span className="font-mono text-[8.5px] leading-none text-gray-600">{t}</span>
              <span className="block h-px w-1.5 bg-white/15" />
            </div>
          ))}
        </div>
        {/* 竖条 */}
        <div className="relative w-2.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={`absolute bottom-0 left-0 right-0 rounded-full ${color} transition-all duration-500`}
            style={{ height: `${clamped}%` }}
          />
          {/* 内嵌刻度细线 — 25/50/75% 处 */}
          {[25, 50, 75].map((t) => (
            <div
              key={t}
              className="absolute left-0 right-0 h-px bg-white/[0.08]"
              style={{ bottom: `${t}%` }}
            />
          ))}
        </div>
      </div>
      <div className="text-center">
        <div className="font-mono text-[13px] font-semibold leading-none text-white">{clamped}%</div>
        <div className="mt-1.5 font-mono text-[10px] leading-none text-gray-500">{usedMb} / {totalMb} MB</div>
      </div>
    </div>
  );
}

/** 横向进度条 — label 在左, value 在右, 下面条 */
function BarRow({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }): JSX.Element {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[12.5px]">
        <span className="text-gray-400">{label}</span>
        <span className="font-mono text-white">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** 内存分段构成条 — used(蓝) / cached(紫) / available(灰绿) 三段 */
function MemoryCompositionBar({ total, used, cached, available, className }: { total: number; used: number; cached: number; available: number; className?: string }): JSX.Element {
  if (total <= 0) return <div className={className} />;
  const usedPct = Math.min(100, (used / total) * 100);
  const cachedPct = Math.min(100 - usedPct, (cached / total) * 100);
  const availPct = Math.min(100 - usedPct - cachedPct, (available / total) * 100);
  return (
    <div className={className}>
      <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.04]">
        <div className="h-full bg-cyan-500 transition-all duration-700" style={{ width: `${usedPct}%` }} />
        <div className="h-full bg-violet-500/50 transition-all duration-700" style={{ width: `${cachedPct}%` }} />
        <div className="h-full bg-emerald-600/30 transition-all duration-700" style={{ width: `${availPct}%` }} />
      </div>
      <div className="mt-2 flex items-center gap-4 text-[10px] font-mono">
        <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-500" />已用</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-500/50" />缓存</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600/40" />可用</span>
      </div>
    </div>
  );
}

