export function availabilityText(value: string | number | null | undefined, fallback = "N/A"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function bytesPerSecondToReadable(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB/s`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`;
  return `${value.toFixed(0)} B/s`;
}

export const cardCls = "rounded-xl p-5 transition-all duration-300 bg-[linear-gradient(180deg,rgba(16,18,23,0.95)_0%,rgba(10,11,14,0.98)_100%)] border border-white/[0.04] shadow-[0_4px_20px_-2px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.03)] hover:border-white/[0.08]";
export const inputCls = "w-full bg-[rgba(5,5,7,0.8)] border border-white/5 rounded-md px-3 py-2 text-xs text-white outline-none focus:bg-[rgba(10,11,14,0.95)] focus:border-cyan-500/50 focus:shadow-[0_0_0_2px_rgba(6,182,212,0.1)] transition-all font-mono";
export const labelCls = "text-[11px] font-mono text-gray-400";
export const badgeCls = "px-2.5 py-0.5 text-xs font-mono font-medium border rounded-md flex items-center gap-1.5";

/** 中文小标签 — 11px sans-serif + 轻字距，比 font-mono+tracking 渲染好得多 */
export const zhLabel = "text-[11px] font-medium tracking-[0.06em] text-gray-500";
/** 英文小标签 — 保持 mono + uppercase + 宽字距 */
export const enLabel = "text-[10px] font-mono uppercase tracking-[0.18em] text-gray-500";
/** 中文正文（12px）— sans-serif，不加 font-mono */
export const zhBody = "text-[12px] text-gray-400";

export const beijingTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai",
});
