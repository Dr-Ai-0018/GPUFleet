/**
 * 任务 / 审计 / 告警等"过去 X 时间"粗粒度过滤窗口.
 *
 * 注意: 跟 timeRange.ts 是两套独立东西 —
 * - timeRange.ts: 监控时序图用的精细窗口 (30s / 5m / 1h ...), 配合 fetch interval + LTTB
 * - timeWindow.ts: 任务/审计列表用的粗窗口 (1h / 24h / 7d / 30d), 直接给 cursor API 的 since 参数
 */

export type TimeWindow = "" | "1h" | "24h" | "7d" | "30d";

export const TIME_WINDOWS: Array<{ value: TimeWindow; label: string }> = [
  { value: "", label: "全部时间" },
  { value: "1h", label: "最近 1 小时" },
  { value: "24h", label: "最近 24 小时" },
  { value: "7d", label: "最近 7 天" },
  { value: "30d", label: "最近 30 天" },
];

/** 把窗口 key 转成 ISO since 字符串. 空窗口返回 undefined (表示不过滤). */
export function windowSince(w: TimeWindow): string | undefined {
  if (!w) return undefined;
  const ms =
    w === "1h" ? 3600000 :
    w === "24h" ? 86400000 :
    w === "7d" ? 7 * 86400000 :
    30 * 86400000;
  return new Date(Date.now() - ms).toISOString();
}
