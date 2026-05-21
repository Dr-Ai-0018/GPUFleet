/**
 * RingGauge — SVG 环形仪表
 * 用于：在线节点率、GPU 利用率等圆形指标
 */
type RingGaugeProps = {
  value: number;        // 0-100
  size?: number;        // px, default 80
  strokeWidth?: number; // default 6
  color?: string;       // default cyan
  trackColor?: string;
  label?: string;       // 中心标签
  sublabel?: string;    // 中心副标签
  animate?: boolean;
};

export function RingGauge({
  value,
  size = 80,
  strokeWidth = 6,
  color = "#0ff0b3",
  trackColor = "rgba(255,255,255,0.06)",
  label,
  sublabel,
  animate = true,
}: RingGaugeProps): JSX.Element {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const clampedValue = Math.max(0, Math.min(100, value));
  const offset = circumference - (clampedValue / 100) * circumference;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={animate ? {
            transition: "stroke-dashoffset 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
            filter: `drop-shadow(0 0 4px ${color}60)`,
          } : {
            filter: `drop-shadow(0 0 4px ${color}60)`,
          }}
        />
      </svg>
      {/* Center content */}
      {(label !== undefined || sublabel !== undefined) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {label !== undefined && (
            <span className="font-bold font-mono leading-none text-white" style={{ fontSize: size * 0.22 }}>
              {label}
            </span>
          )}
          {sublabel !== undefined && (
            <span className="font-mono text-gray-500 leading-none mt-0.5" style={{ fontSize: size * 0.13 }}>
              {sublabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
