/**
 * DeltaBadge — 趋势变化指示器
 * 用于 OverviewView KPI 卡片，显示与上次数据对比的增减趋势
 */

type DeltaBadgeProps = {
  current: number;
  previous: number | null;
  suffix?: string;       // e.g. "%" or " nodes"
  inverted?: boolean;     // true = 下降是好事 (如 error count)
  precision?: number;     // decimal places, default 1
};

export function DeltaBadge({
  current,
  previous,
  suffix = "%",
  inverted = false,
  precision = 1,
}: DeltaBadgeProps): JSX.Element {
  if (previous === null || previous === undefined) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[10px] font-mono text-gray-500">
        <span className="text-gray-600">—</span>
        <span>无历史</span>
      </span>
    );
  }

  const delta = current - previous;
  const absDelta = Math.abs(delta);

  if (absDelta < 0.01) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[10px] font-mono text-gray-500">
        <span>→</span>
        <span>持平</span>
      </span>
    );
  }

  const isUp = delta > 0;
  const isPositive = inverted ? !isUp : isUp;
  const arrow = isUp ? "↑" : "↓";
  const sign = isUp ? "+" : "";

  const colorCls = isPositive
    ? "border-emerald-400/20 bg-emerald-400/8 text-emerald-400"
    : "border-red-400/20 bg-red-400/8 text-red-400";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono font-semibold ${colorCls}`}>
      <span>{arrow}</span>
      <span>{sign}{absDelta.toFixed(precision)}{suffix}</span>
    </span>
  );
}

/**
 * TrendArrow — 更简洁的趋势箭头（无数字）
 * 用于空间受限的场景
 */
export function TrendArrow({
  current,
  previous,
  inverted = false,
}: {
  current: number;
  previous: number | null;
  inverted?: boolean;
}): JSX.Element {
  if (previous === null) return <></>;
  const delta = current - previous;
  if (Math.abs(delta) < 0.01) {
    return <span className="text-gray-500 text-[12px]">→</span>;
  }
  const isUp = delta > 0;
  const isPositive = inverted ? !isUp : isUp;
  return (
    <span className={`text-[12px] ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
      {isUp ? "↑" : "↓"}
    </span>
  );
}
