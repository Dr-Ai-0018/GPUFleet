/**
 * GPU 算力利用率半圆仪表盘 — 颜色随利用率沿弧线渐变 (emerald → cyan → amber → red).
 * 用于节点详情 MonitorPanel 的单卡 / Overview 集群均值.
 *
 * SVG viewBox 200x120, 半径 78. 中间显示大数字 + 百分号, 下方 sublabel + caption.
 */

import { useId } from "react";

type Props = {
  /** 0-100; 内部 clamp. */
  value: number;
  /** SVG 中心下方小写英文标签, 默认 "UTIL". Overview 集群版传 "AVG UTIL". */
  sublabel?: string;
  /** 仪表下方中文说明, 默认 "算力利用率". Overview 集群版传 "集群平均算力". */
  caption?: string;
};

export function GpuUtilGauge({
  value,
  sublabel = "UTIL",
  caption = "算力利用率",
}: Props): JSX.Element {
  const pct = Math.max(0, Math.min(100, value));
  const radius = 78;
  const cx = 100;
  const cy = 100;
  const arcLength = Math.PI * radius;
  const dashOffset = arcLength * (1 - pct / 100);
  const id = useId().replace(/:/g, "");
  const gradId = `gpu-gauge-${id}`;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" width="200" height="120" className="block">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="38%" stopColor="#06b6d4" />
            <stop offset="72%" stopColor="#f0b040" />
            <stop offset="100%" stopColor="#f85149" />
          </linearGradient>
        </defs>
        {/* Background arc — 渐变低不透明度让 "颜色区间" 可见 */}
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          stroke={`url(#${gradId})`}
          strokeOpacity="0.18"
          strokeWidth="11"
          fill="none"
          strokeLinecap="round"
        />
        {/* Foreground arc — 当前值实色 */}
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          stroke={`url(#${gradId})`}
          strokeWidth="11"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={arcLength}
          strokeDashoffset={dashOffset}
          style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
        />
        {/* 大数字 + % */}
        <text
          x={cx}
          y={cy - 14}
          textAnchor="middle"
          fill="white"
          fontSize="34"
          fontWeight="600"
          fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace"
          style={{ letterSpacing: "-1px" }}
        >
          {Math.round(pct)}
          <tspan fontSize="16" fill="#6b7280" dx="2">%</tspan>
        </text>
        {/* 小标签 */}
        <text
          x={cx}
          y={cy + 6}
          textAnchor="middle"
          fill="#6b7280"
          fontSize="10"
          fontFamily="ui-monospace, monospace"
          style={{ letterSpacing: "1.5px" }}
        >
          {sublabel}
        </text>
      </svg>
      <span className="-mt-1 text-[11.5px] text-gray-500">{caption}</span>
    </div>
  );
}
