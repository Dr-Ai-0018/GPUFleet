/**
 * 节点负载 metric tile — Grafana stat panel 同款语言:
 * label 上 + 大数字 (按 load-level 染色) + 底部细 bar (同色).
 *
 * 在 Overview 节点健康度行、Fleet 表格"实时负载"列、其它节点 metric 展示处复用.
 * 配合 GpuHeatCells 在 GPU tile 的 tooltipContent 里展示多卡明细.
 */

type Size = "sm" | "md";

type Props = {
  label: string;
  /** 百分比 0-100; 内部 clamp. */
  pct: number;
  /** 数据不可用时灰显 "—" 不染色. */
  muted?: boolean;
  /** 右上角小角标, e.g. "×4" 表示 4 卡 GPU. */
  badge?: string;
  /** hover 时浮出的 tooltip 内容, e.g. GPU heat cells. */
  tooltipContent?: JSX.Element;
  /** sm = 表格内嵌紧凑版 (FleetView); md = 独立列表行版 (Overview). 默认 md. */
  size?: Size;
};

const SIZE_CLS: Record<Size, { padding: string; value: string }> = {
  sm: { padding: "px-2 py-1", value: "text-[13.5px]" },
  md: { padding: "px-2.5 py-1.5", value: "text-[15px]" },
};

export function MetricTile({
  label,
  pct,
  muted = false,
  badge,
  tooltipContent,
  size = "md",
}: Props): JSX.Element {
  const clamped = Math.max(0, Math.min(100, pct));
  // 统一 load-level 色阶: < 40 emerald / 40-70 cyan / 70-90 amber / >= 90 red
  const color = muted
    ? "#3a3f4a"
    : clamped >= 90 ? "#f85149"
    : clamped >= 70 ? "#f0b040"
    : clamped >= 40 ? "#06b6d4"
    : "#10b981";
  const valueColorCls = muted
    ? "text-gray-600"
    : clamped >= 90 ? "text-red-300"
    : clamped >= 70 ? "text-amber-300"
    : clamped >= 40 ? "text-cyan-300"
    : "text-emerald-300";

  const sz = SIZE_CLS[size];

  return (
    <div className={`group/tile relative min-w-0 rounded-md border border-white/[0.05] bg-white/[0.015] ${sz.padding} transition-colors group-hover:border-white/[0.08] hover:bg-white/[0.03]`}>
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="text-[9.5px] font-medium uppercase tracking-[0.08em] text-gray-600">
          {label}
        </span>
        {badge ? <span className="font-mono text-[9.5px] text-gray-600">{badge}</span> : null}
      </div>
      <div className={`mt-0.5 ${sz.value} font-semibold leading-none tabular-nums ${valueColorCls}`}>
        {muted ? "—" : `${Math.round(clamped)}%`}
      </div>
      <div className="mt-1 h-[2.5px] overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: muted ? 0 : `${clamped}%`, backgroundColor: color }}
        />
      </div>
      {tooltipContent ? (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100">
          <div className="whitespace-nowrap rounded-md border border-white/[0.08] bg-[#0c0f14] px-2.5 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
            {tooltipContent}
          </div>
        </div>
      ) : null}
    </div>
  );
}
