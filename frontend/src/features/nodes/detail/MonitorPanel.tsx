import { useEffect, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { api } from "../../../api";
import { bytesToReadable, formatRelative, prettyJson } from "../../../lib/format";
import { CodeBlock } from "../../../ui/CodeBlock";
import { MiniSparkline } from "../../../ui/MiniSparkline";
import { TempColorBand } from "../../../ui/TempColorBand";
import { useConsoleStore } from "../../../state/ConsoleStore";
import type { NodeStatusHistoryItem } from "../../../types";
import { beijingTimeFormatter, bytesPerSecondToReadable, availabilityText, cardCls, zhLabel, enLabel, zhBody } from "./shared";
import type { GpuSnapshot, MonitorPanelProps, NetworkSnapshot, NvidiaSnapshot } from "./types";

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

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
  const [historyItems, setHistoryItems] = useState<NodeStatusHistoryItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function fetchHistory() {
      try {
        const res = await callApi((token) => api.getNodeStatusHistory(token, nodeId, 60));
        if (!cancelled) {
          setHistoryItems(res.items);
        }
      } catch {
        // history is best-effort
      }
    }

    void fetchHistory();
    const id = window.setInterval(() => {
      void fetchHistory();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [callApi, nodeId]);

  const historyLabels = useMemo(
    () => historyItems.map((item) => beijingTimeFormatter.format(new Date(item.reported_at))),
    [historyItems],
  );

  const cpuHistoryOption = useMemo(() => ({
    tooltip: { trigger: "axis" as const, backgroundColor: "#0d1117", borderColor: "rgba(255,255,255,0.05)", textStyle: { color: "#c9d1d9", fontSize: 11 }, formatter: (params: Array<{ value?: number }>) => `CPU ${params[0]?.value ?? 0}%` },
    grid: { left: 36, right: 8, top: 8, bottom: 20 },
    xAxis: { type: "category" as const, data: historyLabels, axisLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } }, axisLabel: { color: "#4a5568", fontSize: 9, interval: Math.max(0, Math.floor(historyItems.length / 6) - 1) } },
    yAxis: { type: "value" as const, min: 0, max: 100, splitLine: { lineStyle: { color: "rgba(255,255,255,0.03)" } }, axisLabel: { color: "#4a5568", fontSize: 9, formatter: "{value}%" } },
    series: [{ type: "line" as const, smooth: true, symbol: "none", connectNulls: false, lineStyle: { color: "#06b6d4", width: 1.5 }, areaStyle: { color: { type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(6,182,212,0.15)" }, { offset: 1, color: "rgba(6,182,212,0)" }] } }, data: historyItems.map((item) => item.cpu_usage_percent) }],
  }), [historyItems, historyLabels]);

  const gpuLoadHistoryOption = useMemo(() => ({
    tooltip: { trigger: "axis" as const, backgroundColor: "#0d1117", borderColor: "rgba(255,255,255,0.05)", textStyle: { color: "#c9d1d9", fontSize: 11 } },
    legend: { top: 0, right: 0, textStyle: { color: "#6b7280", fontSize: 10 }, itemWidth: 10, itemHeight: 4 },
    grid: { left: 34, right: 12, top: 28, bottom: 20 },
    xAxis: { type: "category" as const, data: historyLabels, axisLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } }, axisLabel: { color: "#4a5568", fontSize: 9, interval: Math.max(0, Math.floor(historyItems.length / 6) - 1) } },
    yAxis: { type: "value" as const, min: 0, max: 100, splitLine: { lineStyle: { color: "rgba(255,255,255,0.03)" } }, axisLabel: { color: "#4a5568", fontSize: 9, formatter: "{value}%" } },
    series: [
      {
        name: "GPU Util",
        type: "line" as const,
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#06b6d4", width: 1.8 },
        areaStyle: { color: { type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(6,182,212,0.16)" }, { offset: 1, color: "rgba(6,182,212,0)" }] } },
        data: historyItems.map((item) => item.gpu_utilization_percent),
      },
      {
        name: "VRAM",
        type: "line" as const,
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#22c55e", width: 1.5 },
        data: historyItems.map((item) => item.gpu_memory_percent),
      },
    ],
  }), [historyItems, historyLabels]);

  const gpuThermalHistoryOption = useMemo(() => ({
    tooltip: { trigger: "axis" as const, backgroundColor: "#0d1117", borderColor: "rgba(255,255,255,0.05)", textStyle: { color: "#c9d1d9", fontSize: 11 } },
    legend: { top: 0, right: 0, textStyle: { color: "#6b7280", fontSize: 10 }, itemWidth: 10, itemHeight: 4 },
    grid: { left: 34, right: 38, top: 28, bottom: 20 },
    xAxis: { type: "category" as const, data: historyLabels, axisLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } }, axisLabel: { color: "#4a5568", fontSize: 9, interval: Math.max(0, Math.floor(historyItems.length / 6) - 1) } },
    yAxis: [
      { type: "value" as const, splitLine: { lineStyle: { color: "rgba(255,255,255,0.03)" } }, axisLabel: { color: "#4a5568", fontSize: 9 } },
      { type: "value" as const, splitLine: { show: false }, axisLabel: { color: "#4a5568", fontSize: 9 } },
    ],
    series: [
      { name: "Temp", type: "line" as const, smooth: true, symbol: "none", lineStyle: { color: "#f97316", width: 1.5 }, data: historyItems.map((item) => item.gpu_temperature_c) },
      { name: "Power", type: "line" as const, smooth: true, symbol: "none", yAxisIndex: 1, lineStyle: { color: "#f59e0b", width: 1.5 }, data: historyItems.map((item) => item.gpu_power_draw_w) },
      { name: "Clock", type: "line" as const, smooth: true, symbol: "none", yAxisIndex: 1, lineStyle: { color: "#a78bfa", width: 1.3 }, data: historyItems.map((item) => item.gpu_clock_graphics_mhz) },
    ],
  }), [historyItems, historyLabels]);

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
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[14px] border border-[var(--card-border)] bg-[var(--surface-card)]">
        <div className="flex items-center justify-between border-b border-white/[0.04] px-6 py-4">
          <div><div className={zhLabel}>运行概览</div></div>
          <div className="rounded-md border border-cyan-400/15 bg-cyan-400/[0.06] px-2.5 py-1 text-[11px] font-medium tracking-[0.06em] text-cyan-300">实时</div>
        </div>
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1.5fr)_340px]">
          <div className="border-b border-white/[0.04] px-7 py-6 xl:border-b-0 xl:border-r">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <div className="text-[11px] font-medium tracking-[0.06em] text-cyan-300/75">核心负载</div>
                <h3 className="mt-3 text-[22px] font-bold leading-[1.15] tracking-[-0.015em] text-white">CPU、内存、GPU</h3>
                <p className="mt-2 text-[13px] leading-6 text-gray-400">{cpu?.model ?? "未知 CPU"}{primaryGpu ? ` · ${String(primaryGpu.model ?? "主 GPU")}` : ""}</p>
              </div>
              <div className="shrink-0 text-right">
                <div className={zhLabel}>最近更新</div>
                <div className="mt-2 text-[16px] font-mono text-cyan-300">{formatRelative(latestStatus.reported_at)}</div>
              </div>
            </div>

            <div className="mt-6 grid gap-0 border-t border-white/[0.04] lg:grid-cols-[1fr_1fr_1.15fr]">
              {/* CPU — 大数字 + 横向进度条 */}
              <div className="py-5 lg:pr-6">
                <div className={enLabel}>CPU</div>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-[34px] font-bold font-mono leading-none text-white">{Math.round(cpuUse)}%</span>
                  <span className="pb-1 text-[12px] font-mono text-gray-500">{physicalCoreCount ?? "?"}C / {coreCount}T</span>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-all duration-700" style={{ width: `${cpuUse}%` }} />
                </div>
                <div className="mt-3">
                  <MiniSparkline data={historyItems.map((item) => item.cpu_usage_percent ?? 0)} width={240} height={32} color="#06b6d4" fillOpacity={0.06} className="opacity-80" />
                </div>
              </div>
              {/* 内存 — 大数字 + 分段构成条 */}
              <div className="border-t border-white/[0.04] py-5 lg:border-l lg:border-t-0 lg:px-6">
                <div className={zhLabel}>内存</div>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-[34px] font-bold font-mono leading-none text-white">{Math.round(memUse)}%</span>
                  <span className="pb-1 text-[12px] font-mono text-gray-500">{bytesToReadable(memUsed)} / {bytesToReadable(memTotal)}</span>
                </div>
                <MemoryCompositionBar total={memTotal} used={memUsed} cached={memCached ?? 0} available={memAvailable ?? 0} className="mt-4" />
              </div>
              <div className="border-t border-white/[0.04] py-5 lg:border-l lg:border-t-0 lg:pl-6">
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0">
                    <div className={zhLabel}>主 GPU</div>
                    <div className="mt-3 flex items-end gap-3">
                      <span className="text-[34px] font-bold font-mono leading-none text-white">{primaryGpu ? `${primaryGpuUtil}%` : "—"}</span>
                      <span className="pb-1 text-[12px] font-mono text-gray-500">{primaryGpu ? `${primaryGpuVramPct}% VRAM` : "无加速卡"}</span>
                    </div>
                    <div className="mt-4">
                      <MiniSparkline data={historyItems.map((item) => item.gpu_utilization_percent ?? 0)} width={240} height={40} color="#a78bfa" fillOpacity={0.08} className="opacity-90" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={`mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 ${zhBody}`}>
              <span>内存 {memSpeed != null ? `${memSpeed} MT/s` : "—"}</span>
              <span>网络 {availabilityText(network?.ssid, "有线 / 隐藏")}</span>
              <span>链路 {availabilityText(network?.link_speed, "—")}</span>
              <span>环境 {pythonEnv?.python_version ? `Python ${pythonEnv.python_version}` : "—"}</span>
            </div>
          </div>

          <div className="px-7 py-6">
            <div className="space-y-6">
              <div className="border-b border-white/[0.04] pb-5">
                <div className={zhLabel}>网络</div>
                <div className="mt-3 flex items-end justify-between gap-4">
                  <div>
                    <div className="text-[28px] font-bold leading-none text-white">{availabilityText(network?.link_speed, "N/A")}</div>
                    <div className={`mt-3 ${zhBody} text-gray-500`}>{availabilityText(network?.adapter_name, "未连接")}</div>
                  </div>
                  <div className={`text-right ${zhBody}`}>
                    <div>下载 {bytesPerSecondToReadable(network?.rx_bytes_per_sec)}</div>
                    <div className="mt-1">上传 {bytesPerSecondToReadable(network?.tx_bytes_per_sec)}</div>
                  </div>
                </div>
                <div className={`mt-4 flex flex-wrap gap-x-5 gap-y-2 ${zhBody}`}>
                  <span>{availabilityText(network?.ssid, "有线 / 隐藏")}</span>
                  <span>{availabilityText(network?.ipv4_address, "IPv4 —")}</span>
                </div>
              </div>

              <div>
                <div className={zhLabel}>运行环境</div>
                <div className="mt-3 flex items-end justify-between gap-4">
                  <div>
                    <div className="text-[28px] font-bold leading-none text-white">{pythonEnv?.python_version ? `Python ${pythonEnv.python_version}` : "环境缺失"}</div>
                    <div className={`mt-3 ${zhBody} text-gray-500`}>
                      {pythonEnv?.active_environment_kind
                        ? `${pythonEnv.active_environment_kind}${pythonEnv.active_environment_name ? ` · ${pythonEnv.active_environment_name}` : ""}`
                        : "无环境元数据"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={zhLabel}>后端</div>
                    <div className="mt-2 text-[34px] font-bold font-mono leading-none text-cyan-300">{pythonEnv?.supported_backends ? pythonEnv.supported_backends.length : "—"}</div>
                  </div>
                </div>
                <div className={`mt-4 flex flex-wrap gap-x-5 gap-y-2 ${zhBody}`}>
                  <span>心跳 {formatRelative(latestStatus.reported_at)}</span>
                  <span className="inline-flex items-center gap-1">GPU 温度 <TempColorBand temp={primaryGpu?.temperature_c != null ? Number(primaryGpu.temperature_c) : null} width={80} height={5} /></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(380px,0.85fr)]">
        <section className={`${cardCls} space-y-6`}>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_240px] xl:items-start">
            <div className="space-y-5">
              <div className="space-y-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-gray-500">System Processor</p>
                <h3 className="max-w-[16ch] text-[28px] font-bold leading-[1.12] tracking-[-0.02em] text-white">{cpu?.model ?? "未知 CPU"}</h3>
                <p className="text-[14px] text-gray-500">{physicalCoreCount ? `${physicalCoreCount} physical cores / ` : ""}{coreCount} 逻辑线程</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <InlineStat label="Physical" value={physicalCoreCount != null ? String(physicalCoreCount) : "—"} />
                <InlineStat label="Logical" value={String(coreCount)} />
                <InlineStat label="RAM" value={bytesToReadable(memTotal)} />
                <InlineStat label="后端" value={pythonEnv?.supported_backends ? String(pythonEnv.supported_backends.length) : "—"} />
              </div>
            </div>

            <div className="border border-cyan-500/10 bg-cyan-950/20 px-5 py-5">
              <div className="text-[11px] font-medium tracking-[0.06em] text-cyan-300/70">CPU 负载</div>
              <div className="mt-3 flex items-end gap-2">
                <span className="text-5xl font-bold font-mono leading-none text-cyan-300">{Math.round(cpuUse)}</span>
                <span className="pb-1 text-lg font-mono text-cyan-300/70">%</span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-400 to-cyan-300 transition-all" style={{ width: `${cpuUse}%` }} /></div>
              <div className="mt-5 space-y-2 text-[11px] font-mono">
                <div className="flex items-center justify-between border-b border-white/[0.04] pb-2"><span className="text-gray-500">Current Clock</span><span className="text-white">{currentClock != null ? `${currentClock} MHz` : "—"}</span></div>
                <div className="flex items-center justify-between"><span className="text-gray-500">Max Clock</span><span className="text-white">{maxClock != null ? `${maxClock} MHz` : "—"}</span></div>
              </div>
            </div>
          </div>

          <div className="border-t border-white/[0.04] pt-5">
            <div className="mb-4 flex items-center justify-between">
              <span className={zhLabel}>CPU 历史</span>
              <span className="text-[11px] font-mono text-gray-600">{formatRelative(latestStatus.reported_at)}</span>
            </div>
            {historyItems.length > 0 ? <ReactEChartsCore echarts={echarts} option={cpuHistoryOption} style={{ height: 150 }} opts={{ renderer: "canvas" }} /> : <div className="flex h-[150px] items-center justify-center text-[11px] text-gray-600">等待历史数据…</div>}
          </div>

          {perCore.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between"><span className={zhLabel}>每核占用</span><span className="text-[11px] text-gray-600">{perCore.length} 线程采样</span></div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
                {perCore.map((value, idx) => {
                  const pct = Math.max(0, Math.min(100, Math.round(value)));
                  return (
                    <div key={idx} className="border border-white/[0.04] bg-white/[0.02] rounded px-3 py-2.5">
                      <div className="mb-2 flex items-center justify-between text-[10px] font-mono"><span className="text-gray-500">C{idx}</span><span className="text-white/80">{pct}%</span></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: pct >= 90 ? "#f85149" : pct >= 70 ? "#f0b040" : "#06b6d4" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>

        <section className={`${cardCls} space-y-6`}>
          <div className="border border-cyan-500/10 bg-cyan-950/20 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={zhLabel}>内存占用</p>
                <h3 className="mt-2 text-[24px] font-bold tracking-[-0.01em] text-white">{bytesToReadable(memUsed)} / {bytesToReadable(memTotal)}</h3>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-gray-500">Pressure</div>
                <div className="mt-2 text-4xl font-bold font-mono text-cyan-300">{Math.round(memUse)}<span className="ml-1 text-lg text-cyan-300/70">%</span></div>
              </div>
            </div>
            <div className="mt-6 space-y-4">
              <div className="h-3 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-400 to-emerald-400 transition-all" style={{ width: `${memUse}%` }} /></div>
              <div className="grid grid-cols-3 gap-x-6 text-[11px] font-mono">
                <div><div className="text-gray-500">Available</div><div className="mt-1 text-white">{memAvailable != null ? bytesToReadable(memAvailable) : "—"}</div></div>
                <div><div className="text-gray-500">Cached</div><div className="mt-1 text-white">{memCached != null ? bytesToReadable(memCached) : "—"}</div></div>
                <div><div className="text-gray-500">Reserved</div><div className="mt-1 text-white">{hardwareReserved != null ? bytesToReadable(hardwareReserved) : "—"}</div></div>
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

          <div className="border-t border-white/[0.04] pt-5">
            <div className="mb-4 flex items-center justify-between">
              <div><p className={zhLabel}>网络链路</p><h4 className="mt-2 text-[20px] font-bold tracking-[-0.01em] text-white">{availabilityText(network?.adapter_name, "未连接")}</h4></div>
              <div className="text-right text-[11px] font-mono"><div className="text-cyan-400">{availabilityText(network?.ssid, "Wired / Hidden")}</div><div className="mt-1 text-gray-500">{availabilityText(network?.link_speed)}</div></div>
            </div>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <div className="py-2"><div className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500">Upload</div><div className="mt-1 text-2xl font-bold font-mono text-white">{bytesPerSecondToReadable(network?.tx_bytes_per_sec)}</div></div>
              <div className="py-2"><div className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500">Download</div><div className="mt-1 text-2xl font-bold font-mono text-white">{bytesPerSecondToReadable(network?.rx_bytes_per_sec)}</div></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <InlineTag label="SSID" value={availabilityText(network?.ssid, "Wired / Hidden")} />
              <span className="text-gray-700">·</span>
              <InlineTag label="Radio" value={availabilityText(network?.radio_type)} />
              <span className="text-gray-700">·</span>
              <InlineTag label="Signal" value={availabilityText(network?.signal)} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <MetricCell label="IPv4" value={availabilityText(network?.ipv4_address)} />
              <MetricCell label="IPv6" value={availabilityText(network?.ipv6_address)} />
              <MetricCell label="Adapter" value={availabilityText(network?.interface_description ?? network?.adapter_name)} />
              <MetricCell label="Link" value={availabilityText(network?.link_speed)} />
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

      {gpus.length === 0 ? (
        <div className="py-10 text-center text-[13px] text-gray-600">无 GPU 设备检测到</div>
      ) : (
        <div className="space-y-6">
          {gpus.map((gpu, idx) => {
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
              <div key={idx} className={`${cardCls} pb-6`}>
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] font-mono font-bold uppercase text-gray-500">GPU #{gpuIndex}</span>
                    <span className="text-[14px] font-bold text-white">{String(currentGpu.model ?? "Unknown GPU")}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <TempColorBand temp={temp} width={100} height={6} />
                    {pcieGen != null ? <span className="text-[10px] font-mono text-gray-500">PCIe Gen{pcieGen} x{pcieWidth ?? "?"}</span> : null}
                    <span className="text-[11px] font-mono text-gray-500">{total} MB</span>
                    <span className={`rounded border px-2 py-0.5 text-[10px] font-mono font-bold ${util > 80 ? "border-red-800/30 bg-red-950/40 text-red-400" : util > 30 ? "border-cyan-800/30 bg-cyan-950/40 text-cyan-400" : "border-emerald-800/30 bg-emerald-950/40 text-emerald-400"}`}>{util > 0 ? "Active" : "Idle"}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-8 xl:grid-cols-[0.95fr_1.05fr]">
                  <div className="space-y-4">
                    <div><div className={`mb-2 flex justify-between ${zhBody}`}><span>算力利用率</span><span className="font-mono font-bold text-white">{util}%</span></div><div className="h-2.5 w-full overflow-hidden rounded-full bg-white/5"><div className={`h-full rounded-full ${util > 80 ? "bg-red-500" : "bg-cyan-500"}`} style={{ width: `${util}%` }} /></div></div>
                    <div><div className={`mb-2 flex justify-between ${zhBody}`}><span>显存占用</span><span className="font-mono font-bold text-white">{used}/{total} MB ({pct}%)</span></div><div className="h-2.5 w-full overflow-hidden rounded-full bg-white/5"><div className={`h-full rounded-full ${pct > 90 ? "bg-red-500" : "bg-cyan-400"}`} style={{ width: `${pct}%` }} /></div></div>
                    {powerDraw != null && powerLimit != null ? <div><div className={`mb-2 flex justify-between ${zhBody}`}><span>功耗</span><span className="font-mono font-bold text-white">{powerDraw.toFixed(1)}W / {powerLimit}W</span></div><div className="h-2.5 w-full overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-amber-500/70" style={{ width: `${Math.min(100, (powerDraw / powerLimit) * 100)}%` }} /></div></div> : null}
                  </div>
                  <div>
                    <div className="mb-3 flex items-center justify-between"><div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gray-500">Load Timeline</div><div className="text-[11px] font-mono text-gray-600">Util / VRAM</div></div>
                    {idx === 0 && historyItems.length > 1 ? <ReactEChartsCore echarts={echarts} option={gpuLoadHistoryOption} style={{ height: 160 }} opts={{ renderer: "canvas" }} /> : <div className="flex h-[160px] items-center justify-center text-[11px] text-gray-600">等待 GPU 历史数据…</div>}
                  </div>
                </div>
                <div className="mt-5 border-t border-white/[0.04] pt-4">
                  <div className="mb-3 flex items-center justify-between"><div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gray-500">Thermal / Power Timeline</div><div className="text-[11px] font-mono text-gray-600">Temp / Power / Clock</div></div>
                  {idx === 0 && historyItems.length > 1 ? <ReactEChartsCore echarts={echarts} option={gpuThermalHistoryOption} style={{ height: 140 }} opts={{ renderer: "canvas" }} /> : <div className="flex h-[140px] items-center justify-center text-[11px] text-gray-600">等待 GPU 历史数据…</div>}
                </div>
                <div className="mt-5 grid grid-cols-3 gap-x-6 gap-y-5">
                  <div><span className="mb-1 block text-[9px] font-mono uppercase text-gray-500">TEMP</span><TempColorBand temp={temp} width={80} height={6} className="mt-1" /></div>
                  <div><span className="mb-1 block text-[9px] font-mono uppercase text-gray-500">POWER</span><span className="text-[16px] font-bold font-mono text-white">{powerDraw != null ? `${powerDraw.toFixed(0)}W` : "—"}</span></div>
                  <div><span className="mb-1 block text-[9px] font-mono uppercase text-gray-500">FAN</span><span className="text-[16px] font-bold font-mono text-white">{fan != null ? `${fan}%` : "N/A"}</span></div>
                  <div><span className="mb-1 block text-[9px] font-mono uppercase text-gray-500">CLOCK</span><span className="text-[16px] font-bold font-mono text-white">{clockCur ?? "—"} <span className="text-[11px] text-gray-600">MHz</span></span></div>
                  <div><span className="mb-1 block text-[9px] font-mono uppercase text-gray-500">BOOST</span><span className="text-[16px] font-bold font-mono text-white">{clockMax ?? "—"} <span className="text-[11px] text-gray-600">MHz</span></span></div>
                  <div><span className="mb-1 block text-[9px] font-mono uppercase text-gray-500">UTIL</span><span className="text-[16px] font-bold font-mono text-white">{util}%</span></div>
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

      <div className={`${cardCls} p-4`}>
        <div onClick={() => setShowJson(!showJson)} className="flex cursor-pointer items-center justify-between select-none text-xs font-mono text-gray-400 hover:text-white">
          <span>{showJson ? "▾ 折叠原始 JSON" : "▸ 查看原始 JSON 数据 (Raw Snapshot)"}</span>
        </div>
        {showJson ? <div className="mt-4"><CodeBlock label="snapshot.json" value={prettyJson(latestStatus)} maxHeight={300} /></div> : null}
      </div>
    </div>
  );
}

function InlineStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="border-t border-white/[0.05] pt-3">
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gray-500">{label}</div>
      <div className="mt-2 text-[22px] font-bold font-mono text-white">{value}</div>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0 border-b border-white/[0.04] py-2">
      <span className="mb-1 block text-[9px] font-mono uppercase text-gray-500">{label}</span>
      <span className="block break-all text-[13px] font-bold font-mono leading-snug text-white">{value}</span>
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

function InlineTag({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <span className="text-[10px] font-mono text-gray-300">
      <span className="text-gray-500">{label}</span>
      <span className="mx-1 text-gray-600">/</span>
      <span className="text-white">{value}</span>
    </span>
  );
}
