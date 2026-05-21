/**
 * BlockProgress — 分段方块进度条
 * 用于：内存使用、VRAM 占用等分段可视化
 */
type BlockProgressProps = {
  value: number;       // 0-100
  blocks?: number;     // 分段数量，default 12
  color?: string;
  dimColor?: string;
  height?: number;     // px, default 8
  gap?: number;        // px between blocks, default 2
  animate?: boolean;
  className?: string;
};

export function BlockProgress({
  value,
  blocks = 12,
  color = "#0ff0b3",
  dimColor = "rgba(255,255,255,0.06)",
  height = 8,
  gap = 2,
  animate = true,
  className = "",
}: BlockProgressProps): JSX.Element {
  const clampedValue = Math.max(0, Math.min(100, value));
  const filledCount = Math.round((clampedValue / 100) * blocks);

  // Color thresholds
  const activeColor =
    color === "auto"
      ? clampedValue >= 90 ? "#f85149"
        : clampedValue >= 70 ? "#f0b040"
        : "#0ff0b3"
      : color;

  return (
    <div className={`flex items-center ${className}`} style={{ gap }}>
      {Array.from({ length: blocks }, (_, i) => {
        const filled = i < filledCount;
        return (
          <div
            key={i}
            className="rounded-sm flex-1"
            style={{
              height,
              backgroundColor: filled ? activeColor : dimColor,
              boxShadow: filled ? `0 0 4px ${activeColor}50` : "none",
              transition: animate ? `background-color 0.3s ease ${i * 20}ms` : "none",
            }}
          />
        );
      })}
    </div>
  );
}
