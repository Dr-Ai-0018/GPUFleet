/**
 * MiniSparkline — 纯 SVG 迷你折线图
 * 用于：KPI 卡片内的趋势线，不依赖 ECharts
 */
type MiniSparklineProps = {
  data: number[];       // 数据点数组
  width?: number;       // px, default 80
  height?: number;      // px, default 28
  color?: string;
  fillOpacity?: number; // 0-1, default 0.15
  strokeWidth?: number; // default 1.5
  className?: string;
};

export function MiniSparkline({
  data,
  width = 80,
  height = 28,
  color = "#0ff0b3",
  fillOpacity = 0.15,
  strokeWidth = 1.5,
  className = "",
}: MiniSparklineProps): JSX.Element {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className={className} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = strokeWidth;

  const points = data.map((v, i) => ({
    x: pad + (i / (data.length - 1)) * (width - pad * 2),
    y: pad + ((1 - (v - min) / range) * (height - pad * 2)),
  }));

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const fillPath =
    linePath +
    ` L ${points[points.length - 1].x.toFixed(1)} ${(height - pad).toFixed(1)}` +
    ` L ${points[0].x.toFixed(1)} ${(height - pad).toFixed(1)} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ overflow: "visible" }}
    >
      {/* Fill area */}
      <defs>
        <linearGradient id={`spark-fill-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={fillOpacity * 2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path
        d={fillPath}
        fill={`url(#spark-fill-${color.replace("#", "")})`}
      />
      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 2px ${color}80)` }}
      />
      {/* Last point dot */}
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r={2}
        fill={color}
        style={{ filter: `drop-shadow(0 0 3px ${color})` }}
      />
    </svg>
  );
}
