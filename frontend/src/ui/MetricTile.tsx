/**
 * 节点负载 metric tile — Grafana stat panel 同款语言:
 * label 上 + 大数字 (按 load-level 染色) + 底部 gradient bar (示波器轨迹感).
 *
 * 在 Overview 节点健康度行、Fleet 表格"实时负载"列、其它节点 metric 展示处复用.
 * 配合 GpuHeatCells 在 GPU tile 的 tooltipContent 里展示多卡明细.
 *
 * 质感设计 (v2):
 * - 卡片底色: 纵向 gradient + inset bezel (顶光底暗) → "金属凸起"感
 * - 进度条: linear gradient (暗端→亮端) + 末端 box-shadow → "示波器扫光"感
 * - 字重: medium (500) + tighter tracking → 高级感, 不是塑料厚胶
 * - 颜色: "夹色" 版 (略灰 emerald/cyan/amber/red), 不再幼儿园彩笔色
 */

type Size = "sm" | "md";
type Level = "low" | "mid" | "high" | "crit" | "muted";

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

const SIZE_CLS: Record<Size, { padding: string; value: string; barH: string }> = {
  sm: { padding: "px-2 py-1.5", value: "text-[13.5px]", barH: "h-[3px]" },
  md: { padding: "px-2.5 py-2", value: "text-[15px]", barH: "h-[3.5px]" },
};

const LEVEL_TEXT: Record<Level, string> = {
  muted: "text-gray-600",
  low: "text-[var(--c-online-soft-text)]",
  mid: "text-[var(--c-running-soft-text)]",
  high: "text-[var(--c-waiting-soft-text)]",
  crit: "text-[var(--c-danger-soft-text)]",
};

const LEVEL_BAR_GRAD: Record<Level, string> = {
  muted: "rgba(255,255,255,0.06)",
  low: "var(--bar-grad-emerald)",
  mid: "var(--bar-grad-cyan)",
  high: "var(--bar-grad-amber)",
  crit: "var(--bar-grad-red)",
};

const LEVEL_BAR_GLOW: Record<Level, string> = {
  muted: "none",
  low: "0 0 6px rgba(16,185,129,0.55)",
  mid: "0 0 6px rgba(6,182,212,0.55)",
  high: "0 0 6px rgba(240,176,64,0.55)",
  crit: "0 0 8px rgba(248,81,73,0.65)",
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
  const level: Level = muted
    ? "muted"
    : clamped >= 90 ? "crit"
    : clamped >= 70 ? "high"
    : clamped >= 40 ? "mid"
    : "low";

  const sz = SIZE_CLS[size];

  return (
    <div
      className={`group/tile relative min-w-0 rounded-md border border-white/[0.04] ${sz.padding} transition-colors hover:border-white/[0.08]`}
      style={{
        backgroundColor: "#0a0d12",
        backgroundImage: "var(--surface-grad)",
        boxShadow: "var(--bezel-card)",
      }}
    >
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="text-[9.5px] font-medium uppercase tracking-[0.10em] text-gray-600">
          {label}
        </span>
        {badge ? <span className="font-mono text-[9.5px] text-gray-600">{badge}</span> : null}
      </div>
      <div className={`mt-1 ${sz.value} font-medium leading-none tracking-[-0.02em] tabular-nums ${LEVEL_TEXT[level]}`}>
        {muted ? "—" : `${Math.round(clamped)}%`}
      </div>
      {/* 进度条 — gradient + 末端 box-shadow 发光端头 */}
      <div className={`mt-1.5 ${sz.barH} overflow-hidden rounded-full bg-black/40`}>
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: muted ? 0 : `${clamped}%`,
            background: LEVEL_BAR_GRAD[level],
            boxShadow: muted ? "none" : LEVEL_BAR_GLOW[level],
          }}
        />
      </div>
      {tooltipContent ? (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100">
          <div
            className="whitespace-nowrap rounded-md border border-white/[0.08] px-2.5 py-1.5"
            style={{
              backgroundColor: "#0c0f14",
              backgroundImage: "var(--surface-grad)",
              boxShadow: "var(--bezel-card), 0 8px 24px rgba(0,0,0,0.5)",
            }}
          >
            {tooltipContent}
          </div>
        </div>
      ) : null}
    </div>
  );
}
