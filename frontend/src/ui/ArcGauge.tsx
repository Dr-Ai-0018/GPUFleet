/**
 * ArcGauge — SVG 半圆弧形仪表
 * 用于：GPU 利用率、CPU 负载等半圆形指标
 */
type ArcGaugeProps = {
  value: number;        // 0-100
  size?: number;        // px, default 100
  strokeWidth?: number; // default 8
  color?: string;
  trackColor?: string;
  label?: string;       // 中心大数字
  unit?: string;        // 单位，如 "%"
  sublabel?: string;
};

export function ArcGauge({
  value,
  size = 100,
  strokeWidth = 8,
  color = "#0ff0b3",
  trackColor = "rgba(255,255,255,0.06)",
  label,
  unit = "%",
  sublabel,
}: ArcGaugeProps): JSX.Element {
  const clampedValue = Math.max(0, Math.min(100, value));
  // Arc spans 210 degrees (from 195deg to 345deg, bottom-center gap)
  const arcDeg = 210;
  const startAngle = 195; // degrees from 3-o'clock
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2 + size * 0.08; // shift center down slightly

  function polarToCartesian(angleDeg: number) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  function describeArc(startDeg: number, endDeg: number) {
    const start = polarToCartesian(startDeg);
    const end = polarToCartesian(endDeg);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  }

  const endAngle = startAngle + arcDeg;
  const progressAngle = startAngle + (clampedValue / 100) * arcDeg;

  // Dynamic color based on value
  const dynamicColor = color === "auto"
    ? clampedValue >= 85 ? "#f85149" : clampedValue >= 60 ? "#f0b040" : "#0ff0b3"
    : color;

  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: size, height: size * 0.72 }}>
      <svg width={size} height={size * 0.72} viewBox={`0 0 ${size} ${size * 0.72}`} overflow="visible">
        {/* Track arc */}
        <path
          d={describeArc(startAngle, endAngle)}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Progress arc */}
        {clampedValue > 0 && (
          <path
            d={describeArc(startAngle, progressAngle)}
            fill="none"
            stroke={dynamicColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            style={{
              transition: "all 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
              filter: `drop-shadow(0 0 5px ${dynamicColor}70)`,
            }}
          />
        )}
      </svg>
      {/* Center label */}
      <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center" style={{ bottom: size * 0.02 }}>
        {label !== undefined && (
          <div className="flex items-end gap-0.5">
            <span className="font-bold font-mono leading-none text-white" style={{ fontSize: size * 0.24 }}>
              {label}
            </span>
            <span className="font-mono text-gray-400 pb-0.5" style={{ fontSize: size * 0.13 }}>{unit}</span>
          </div>
        )}
        {sublabel && (
          <span className="font-mono text-gray-500 mt-0.5" style={{ fontSize: size * 0.11 }}>{sublabel}</span>
        )}
      </div>
    </div>
  );
}
