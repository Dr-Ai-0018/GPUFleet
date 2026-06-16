import { useEffect, useRef, useState } from "react";
import { RANGE_PRESETS, type RangeKey } from "../lib/timeRange";

interface Props {
  value: RangeKey;
  onChange: (key: RangeKey) => void;
  disabled?: boolean;
}

/**
 * 紧凑下拉选择器, 14 档时间窗预设. 点击外部自动关闭.
 * 视觉风格跟节点详情页其它操作按钮 (cyan / white/5) 对齐.
 */
export function TimeRangePicker({ value, onChange, disabled }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const current = RANGE_PRESETS.find((r) => r.key === value) ?? RANGE_PRESETS[0];

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((x) => !x)}
        className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-gray-300 transition-all hover:bg-white/10 disabled:opacity-40"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan-400">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="font-mono">{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-md border border-white/10 bg-[#0d1117] shadow-xl"
        >
          {RANGE_PRESETS.map((r) => (
            <button
              key={r.key}
              type="button"
              role="option"
              aria-selected={r.key === value}
              onClick={() => {
                onChange(r.key);
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left text-[11px] transition-colors ${
                r.key === value
                  ? "bg-cyan-500/20 text-cyan-300"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
