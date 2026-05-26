/**
 * GpuHeatCells — GPU 热力方块组件
 * 每个 GPU 一个小色块，颜色编码利用率
 * 用于 FleetView 表格替换 ArcGauge，支持 8-GPU 节点不破版
 */
import { useState } from "react";

type GpuInfo = {
  index: number;
  name?: string;
  utilization_percent?: number;
  used_vram_mb?: number;
  total_vram_mb?: number;
  temperature_c?: number;
};

type GpuHeatCellsProps = {
  gpus: Array<Record<string, unknown>>;
  size?: number;  // cell size in px, default 16
  gap?: number;   // gap in px, default 3
};

function getHeatColor(util: number): string {
  if (util >= 90) return "#f85149";   // saturated - red
  if (util >= 70) return "#f0b040";   // heavy - amber
  if (util >= 40) return "#06b6d4";   // moderate - cyan
  if (util >= 10) return "#0e4b6e";   // light - dark blue
  return "#1a1a2e";                    // idle - deep gray
}

function getHeatLabel(util: number): string {
  if (util >= 90) return "饱和";
  if (util >= 70) return "重载";
  if (util >= 40) return "中等";
  if (util >= 10) return "轻载";
  return "空闲";
}

export function GpuHeatCells({ gpus, size = 16, gap = 3 }: GpuHeatCellsProps): JSX.Element {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!gpus || gpus.length === 0) {
    return <span className="text-[10px] font-mono text-gray-600">N/A</span>;
  }

  const parsedGpus: GpuInfo[] = gpus.map((g, i) => ({
    index: Number(g.index ?? i),
    name: String(g.name ?? g.gpu_name ?? "GPU"),
    utilization_percent: Number(g.utilization_percent ?? 0),
    used_vram_mb: Number(g.used_vram_mb ?? 0),
    total_vram_mb: Number(g.total_vram_mb ?? 0),
    temperature_c: Number(g.temperature_c ?? 0),
  }));

  return (
    <div className="relative inline-flex items-center" style={{ gap }}>
      {parsedGpus.map((gpu, i) => {
        const util = gpu.utilization_percent ?? 0;
        const color = getHeatColor(util);
        const isHovered = hoveredIdx === i;

        return (
          <div
            key={gpu.index}
            className="relative"
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            {/* Heat cell */}
            <div
              className="rounded-[3px] transition-all duration-200"
              style={{
                width: size,
                height: size,
                backgroundColor: color,
                boxShadow: util >= 70 ? `0 0 6px ${color}60` : "none",
                transform: isHovered ? "scale(1.25)" : "scale(1)",
                outline: isHovered ? `1px solid ${color}` : "none",
                outlineOffset: "1px",
              }}
            />

            {/* Tooltip */}
            {isHovered && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none">
                <div className="rounded-lg border border-white/[0.1] bg-[#0d0f14] px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.6)] whitespace-nowrap">
                  <div className="text-[11px] font-mono text-white font-medium">
                    GPU #{gpu.index} {gpu.name}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[10px] font-mono">
                    <span style={{ color }}>
                      {Math.round(util)}% {getHeatLabel(util)}
                    </span>
                    {gpu.total_vram_mb > 0 && (
                      <span className="text-gray-400">
                        {(gpu.used_vram_mb! / 1024).toFixed(1)}/{(gpu.total_vram_mb / 1024).toFixed(1)} GB
                      </span>
                    )}
                    {gpu.temperature_c > 0 && (
                      <span className="text-gray-400">{gpu.temperature_c}°C</span>
                    )}
                  </div>
                  {/* tooltip arrow */}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-[#0d0f14]" />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Summary label */}
      <span className="text-[10px] font-mono text-gray-500 ml-1">
        ×{parsedGpus.length}
      </span>
    </div>
  );
}
