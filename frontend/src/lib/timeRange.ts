/**
 * 时间窗预设 + x 轴 tick formatter 自适应.
 *
 * 后端 /status/history 支持 since/until 时间窗, 前端这一层把"用户选择"翻译成具体参数,
 * 并为每个窗口提供最合理的 x 轴标注格式和拉取间隔.
 */

export type RangeKey =
  | "30s"
  | "1m"
  | "3m"
  | "5m"
  | "10m"
  | "30m"
  | "1h"
  | "3h"
  | "6h"
  | "12h"
  | "1d"
  | "3d"
  | "7d"
  | "30d";

export interface RangeSpec {
  key: RangeKey;
  label: string;
  /** 窗口长度 (毫秒). */
  windowMs: number;
  /** 后端拉取间隔 (毫秒). 短窗高频, 长窗低频. */
  fetchIntervalMs: number;
  /** 平滑播放 tick 间隔 (毫秒). 30s 窗 → 1s; 1d 窗 → 30min. */
  tickMs: number;
  /** 后端 limit (上限 5000). 实际由 LTTB 再降到画布上限. */
  limit: number;
  /** x 轴 tick 格式. */
  xAxisFormat: "HH:mm:ss" | "HH:mm" | "M/D HH:mm" | "M/D" | "YYYY-M-D";
}

export const RANGE_PRESETS: RangeSpec[] = [
  // fetchIntervalMs 对齐节点心跳节奏 (默认 5s/批 上报), tickMs=1s 由 useSmoothFeeder buffer+tick 模型平滑成 1Hz 滚动
  { key: "30s",  label: "最近 30 秒",  windowMs: 30_000,        fetchIntervalMs: 5_000,   tickMs: 1_000,    limit: 60,   xAxisFormat: "HH:mm:ss" },
  { key: "1m",   label: "最近 1 分钟", windowMs: 60_000,        fetchIntervalMs: 5_000,   tickMs: 1_000,    limit: 80,   xAxisFormat: "HH:mm:ss" },
  { key: "3m",   label: "最近 3 分钟", windowMs: 180_000,       fetchIntervalMs: 5_000,   tickMs: 2_000,    limit: 200,  xAxisFormat: "HH:mm:ss" },
  { key: "5m",   label: "最近 5 分钟", windowMs: 300_000,       fetchIntervalMs: 5_000,   tickMs: 3_000,    limit: 350,  xAxisFormat: "HH:mm:ss" },
  // 短窗口 (≤ 30m) limit 都 ≤ 500, 确保 maxPoints=500 时不触发 LTTB 降密 — 1Hz 真实点全展示, 没有平稳段被抹平的问题
  { key: "10m",  label: "最近 10 分钟", windowMs: 600_000,      fetchIntervalMs: 10_000,  tickMs: 5_000,    limit: 500,  xAxisFormat: "HH:mm" },
  { key: "30m",  label: "最近 30 分钟", windowMs: 1_800_000,    fetchIntervalMs: 15_000,  tickMs: 10_000,   limit: 500,  xAxisFormat: "HH:mm" },
  // 1h+ 长窗口仍走 LTTB (真实点上千, 必须降密), 保留视觉特征
  { key: "1h",   label: "最近 1 小时", windowMs: 3_600_000,     fetchIntervalMs: 30_000,  tickMs: 20_000,   limit: 3600, xAxisFormat: "HH:mm" },
  { key: "3h",   label: "最近 3 小时", windowMs: 10_800_000,    fetchIntervalMs: 60_000,  tickMs: 60_000,   limit: 5000, xAxisFormat: "HH:mm" },
  { key: "6h",   label: "最近 6 小时", windowMs: 21_600_000,    fetchIntervalMs: 60_000,  tickMs: 120_000,  limit: 5000, xAxisFormat: "HH:mm" },
  { key: "12h",  label: "最近 12 小时", windowMs: 43_200_000,   fetchIntervalMs: 120_000, tickMs: 240_000,  limit: 5000, xAxisFormat: "HH:mm" },
  { key: "1d",   label: "最近 1 天",  windowMs: 86_400_000,    fetchIntervalMs: 300_000, tickMs: 600_000,  limit: 5000, xAxisFormat: "M/D HH:mm" },
  { key: "3d",   label: "最近 3 天",  windowMs: 259_200_000,   fetchIntervalMs: 300_000, tickMs: 1_800_000, limit: 5000, xAxisFormat: "M/D HH:mm" },
  { key: "7d",   label: "最近 7 天",  windowMs: 604_800_000,   fetchIntervalMs: 600_000, tickMs: 3_600_000, limit: 5000, xAxisFormat: "M/D" },
  { key: "30d",  label: "最近 30 天", windowMs: 2_592_000_000, fetchIntervalMs: 900_000, tickMs: 14_400_000, limit: 5000, xAxisFormat: "M/D" },
];

export function getRangeSpec(key: RangeKey): RangeSpec {
  const found = RANGE_PRESETS.find((r) => r.key === key);
  if (!found) throw new Error(`Unknown range key: ${key}`);
  return found;
}

/** 给定 chart 宽度 (px) 算可视点数上限. 默认每 4px 一个点. */
export function maxPointsForWidth(widthPx: number, pxPerPoint = 4): number {
  return Math.max(50, Math.floor(widthPx / pxPerPoint));
}

/** 把时间戳 (ms) 按 RangeSpec 的格式格式化成字符串 (本地时区, 不引 dayjs/dateformat 重型库). */
export function formatTick(tsMs: number, format: RangeSpec["xAxisFormat"]): string {
  const d = new Date(tsMs);
  const yyyy = d.getFullYear();
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  switch (format) {
    case "HH:mm:ss":
      return `${hh}:${mm}:${ss}`;
    case "HH:mm":
      return `${hh}:${mm}`;
    case "M/D HH:mm":
      return `${M}/${D} ${hh}:${mm}`;
    case "M/D":
      return `${M}/${D}`;
    case "YYYY-M-D":
      return `${yyyy}-${M}-${D}`;
  }
}
