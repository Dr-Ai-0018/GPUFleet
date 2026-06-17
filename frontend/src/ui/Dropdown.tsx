/**
 * Dropdown — 自定义下拉, 完全替代原生 <select>.
 *
 * 原生 select 的 <option> 弹出列表无法用 CSS 完全定制 (浏览器接管),
 * 在深色主题下会露原皮 (白底黑字 / 系统配色高亮), 是塑料感的主要源头.
 *
 * 本组件视觉跟 KpiTile v3 / Card / forms.input 完全一致:
 * - 触发按钮 = forms.input 同款 (深底 + 软 border + cyan focus)
 * - 弹出面板 = surface-grad + 软 border + 10px 圆角 + 软阴影
 * - option hover/focus = cyan tint, 选中 = 夹色 + check icon
 *
 * 键盘: Up/Down 移动, Enter 确认, Esc 关闭, Tab 关闭. Outside click 关闭.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type DropdownOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** 可选: option 行左侧 icon (12-14px). */
  icon?: JSX.Element;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  /** 占位文本 — value 为空 / 没匹配选项时显示 */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** sm = 28px 高 (筛选条用), md = 34px 高 (表单用). 默认 md. */
  size?: "sm" | "md";
  /** option 字用等宽 (适合 node_id / type 这种 ID-like 值) */
  mono?: boolean;
  /** 选中态文字色 — 默认 cyan 夹色; 也可传 "neutral" 用白 */
  tone?: "running" | "neutral";
};

export function Dropdown({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  className = "",
  size = "md",
  mono = false,
  tone = "running",
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const hasValue = !!selected;
  const displayLabel = selected?.label ?? placeholder ?? "—";

  // 打开时初始 focusIdx = 当前选中项
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    setFocusIdx(idx >= 0 ? idx : 0);
  }, [open, value, options]);

  // 滚动当前 focus 项进可视区
  useEffect(() => {
    if (!open || focusIdx < 0 || !listRef.current) return;
    const el = listRef.current.children[focusIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [open, focusIdx]);

  // outside click 关闭
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  function selectAt(idx: number) {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
  }

  function moveFocus(delta: 1 | -1) {
    if (options.length === 0) return;
    let i = focusIdx < 0 ? 0 : focusIdx;
    for (let step = 0; step < options.length; step++) {
      i = (i + delta + options.length) % options.length;
      if (!options[i].disabled) {
        setFocusIdx(i);
        return;
      }
    }
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(-1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (focusIdx >= 0) selectAt(focusIdx);
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const heightCls = size === "sm" ? "h-[28px] text-[12px]" : "h-[34px] text-[13px]";
  const selectedTextCls = tone === "running" ? "text-[var(--c-running-soft-text)]" : "text-white";

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className={`flex w-full items-center justify-between gap-2 rounded-[8px] border px-3 ${heightCls} text-left transition-colors ${
          mono && hasValue ? "font-mono" : ""
        } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
        style={{
          backgroundColor: open ? "rgba(0,0,0,0.30)" : "rgba(0,0,0,0.25)",
          borderColor: open ? "rgba(6,182,212,0.40)" : "rgba(255,255,255,0.06)",
          color: hasValue ? "var(--text)" : "var(--text-faint)",
        }}
      >
        <span className="truncate">{displayLabel}</span>
        <Chevron open={open} />
      </button>

      {open ? (
        <div
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1.5 max-h-[260px] overflow-y-auto rounded-[10px] border py-1 max-[480px]:fixed max-[480px]:top-1/2 max-[480px]:right-4 max-[480px]:left-4 max-[480px]:max-h-[min(320px,70vh)] max-[480px]:-translate-y-1/2"
          style={{
            backgroundColor: "#0a0d12",
            backgroundImage: "var(--surface-grad)",
            borderColor: "rgba(255,255,255,0.07)",
            boxShadow: "0 14px 36px -6px rgba(0,0,0,0.65), 0 4px 12px -2px rgba(0,0,0,0.4)",
          }}
        >
          {options.map((opt, i) => {
            const isSel = opt.value === value;
            const isFoc = i === focusIdx;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSel}
                disabled={opt.disabled}
                onMouseEnter={() => !opt.disabled && setFocusIdx(i)}
                onClick={() => selectAt(i)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-[7px] text-left text-[13px] transition-colors ${
                  mono ? "font-mono" : ""
                } ${
                  opt.disabled
                    ? "cursor-not-allowed text-gray-600"
                    : isSel
                      ? `cursor-pointer ${selectedTextCls}`
                      : isFoc
                        ? "cursor-pointer text-white"
                        : "cursor-pointer text-gray-300"
                }`}
                style={{
                  backgroundColor: isFoc && !opt.disabled ? "rgba(6,182,212,0.08)" : "transparent",
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {opt.icon ? <span className="shrink-0">{opt.icon}</span> : null}
                  <span className="truncate">{opt.label}</span>
                </span>
                {isSel ? (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden
      width="10"
      height="6"
      viewBox="0 0 10 6"
      fill="none"
      className={`shrink-0 text-gray-500 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M1 1l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
