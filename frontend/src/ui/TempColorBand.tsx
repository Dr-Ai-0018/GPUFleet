/**
 * TempColorBand — a compact horizontal temperature indicator.
 *
 * Renders a gradient bar (blue → green → yellow → red) with a marker
 * showing the current temperature position. Designed for GPU card headers.
 *
 * Thresholds (°C):  < 50 cool  |  50-65 warm  |  65-80 hot  |  > 80 critical
 */

type Props = {
  /** Current temperature in °C, or null/undefined if unavailable. */
  temp: number | null | undefined;
  /** Maximum temperature for the scale (default 100). */
  max?: number;
  /** Bar width in pixels (default 120). */
  width?: number;
  /** Bar height in pixels (default 8). */
  height?: number;
  /** Show numeric label next to the bar (default true). */
  showLabel?: boolean;
  /** Additional CSS class. */
  className?: string;
};

const GRADIENT =
  "linear-gradient(to right, #3b82f6 0%, #22c55e 35%, #eab308 65%, #ef4444 100%)";

function tempColor(temp: number): string {
  if (temp < 50) return "#3b82f6";
  if (temp < 65) return "#22c55e";
  if (temp < 80) return "#eab308";
  return "#ef4444";
}

export function TempColorBand({
  temp,
  max = 100,
  width = 120,
  height = 8,
  showLabel = true,
  className,
}: Props): JSX.Element {
  if (temp == null) {
    return (
      <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
        <span
          className="rounded-full overflow-hidden opacity-30"
          style={{ width, height, background: "rgba(255,255,255,0.06)" }}
        />
        {showLabel && <span className="text-[11px] font-mono text-gray-600">--°C</span>}
      </span>
    );
  }

  const pct = Math.min(100, Math.max(0, (temp / max) * 100));
  const color = tempColor(temp);

  return (
    <span
      className={`inline-flex items-center gap-2 ${className ?? ""}`}
      title={`${temp}°C`}
    >
      <span
        className="relative rounded-full overflow-hidden"
        style={{ width, height, background: "rgba(255,255,255,0.06)" }}
      >
        {/* Gradient track */}
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: GRADIENT, opacity: 0.5 }}
        />
        {/* Active fill */}
        <span
          className="absolute top-0 left-0 h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: GRADIENT,
          }}
        />
        {/* Marker dot */}
        <span
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full border border-black/40 transition-all duration-500"
          style={{
            left: `${pct}%`,
            width: height + 4,
            height: height + 4,
            background: color,
            boxShadow: `0 0 6px ${color}88`,
          }}
        />
      </span>
      {showLabel && (
        <span
          className="text-[11px] font-mono font-bold transition-colors duration-300"
          style={{ color }}
        >
          {temp}°C
        </span>
      )}
    </span>
  );
}
