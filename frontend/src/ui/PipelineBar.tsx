/**
 * PipelineBar — 任务管线分段条
 * 水平分段显示任务在各阶段的分布比例，点击某段可筛选
 */

type Segment = {
  key: string;
  label: string;
  count: number;
  color: string;
  glowColor?: string;
};

type PipelineBarProps = {
  segments: Segment[];
  activeKey?: string | null;
  onSegmentClick?: (key: string) => void;
  height?: number;       // bar height in px, default 28
  className?: string;
};

export function PipelineBar({
  segments,
  activeKey,
  onSegmentClick,
  height = 28,
  className = "",
}: PipelineBarProps): JSX.Element {
  const total = segments.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return (
      <div className={`rounded-lg border border-white/[0.04] bg-white/[0.02] px-4 py-3 text-center text-[11px] font-mono text-gray-600 ${className}`}>
        暂无任务数据
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Bar */}
      <div
        className="flex w-full overflow-hidden rounded-lg border border-white/[0.06] bg-[#090A0D]"
        style={{ height }}
      >
        {segments.map((seg) => {
          if (seg.count === 0) return null;
          const widthPct = (seg.count / total) * 100;
          const isActive = activeKey === seg.key;
          const isAnyActive = activeKey !== null && activeKey !== undefined;

          return (
            <button
              key={seg.key}
              type="button"
              onClick={() => onSegmentClick?.(seg.key)}
              className="relative group transition-all duration-300 flex items-center justify-center overflow-hidden"
              style={{
                width: `${Math.max(widthPct, 3)}%`,
                backgroundColor: seg.color,
                opacity: isAnyActive && !isActive ? 0.35 : 1,
                boxShadow: isActive ? `inset 0 0 12px rgba(255,255,255,0.15), 0 0 8px ${seg.glowColor ?? seg.color}50` : "none",
              }}
              title={`${seg.label}: ${seg.count}`}
            >
              {/* Label inside segment if wide enough */}
              {widthPct >= 12 && (
                <span className="text-[10px] font-mono font-bold text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] truncate px-1">
                  {seg.label} {seg.count}
                </span>
              )}

              {/* Hover highlight */}
              <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        {segments.map((seg) => (
          <button
            key={seg.key}
            type="button"
            onClick={() => onSegmentClick?.(seg.key)}
            className={`flex items-center gap-1.5 text-[10px] font-mono transition-colors ${
              activeKey === seg.key ? "text-white" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <span
              className="w-2 h-2 rounded-[2px] shrink-0"
              style={{ backgroundColor: seg.color }}
            />
            <span>{seg.label}</span>
            <span className="font-bold text-gray-300">{seg.count}</span>
          </button>
        ))}
        <span className="text-[10px] font-mono text-gray-600 ml-auto">
          Total: {total}
        </span>
      </div>
    </div>
  );
}

/**
 * 预定义的任务状态段颜色
 */
export const TASK_PIPELINE_SEGMENTS = {
  pending:   { label: "Pending",   color: "#4a5568", glowColor: "#4a5568" },
  claimed:   { label: "Claimed",   color: "#0891b2", glowColor: "#06b6d4" },
  running:   { label: "Running",   color: "#06b6d4", glowColor: "#22d3ee" },
  succeeded: { label: "Done",      color: "#10b981", glowColor: "#34d399" },
  failed:    { label: "Failed",    color: "#ef4444", glowColor: "#f87171" },
  timeout:   { label: "Timeout",   color: "#dc2626", glowColor: "#ef4444" },
  cancelled: { label: "Cancelled", color: "#6b7280", glowColor: "#9ca3af" },
  lost:      { label: "Lost",      color: "#b91c1c", glowColor: "#dc2626" },
} as const;
