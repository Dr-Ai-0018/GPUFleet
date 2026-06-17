/**
 * KPI tile v3 — 借浅色参考图精华, 移植到深底.
 *
 * 设计要点 (避开 v1 塑料 / v2 扁平失味):
 * - 独立卡片 (不挤一条 divide), 有合适 gap → 呼吸感
 * - 左上 icon 在 tone 软色方框里 → 一眼能看出"这个 KPI 是讲什么"
 * - 大数字 medium 字重 + 紧 tracking → 高级感
 * - 副标灰色细字 → 信息层级清晰
 * - 底部右下藏一条 tone 柔色波浪线 → 质感的关键, 像"该 KPI 的波形签名"
 * - active 态: tone 半透明 border + 微亮卡片底色 → 整张"亮起来", 不发光不 underline
 * - 圆角: 10px (rounded-[10px]) — 中等, 不幼稚, 也不锐利
 */

import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

export type KpiTone = "neutral" | "online" | "running" | "waiting" | "danger" | "violet";

const TONE_SOFT_BG_VAR: Record<KpiTone, string> = {
  neutral: "var(--tone-soft-bg-gray)",
  online: "var(--tone-soft-bg-emerald)",
  running: "var(--tone-soft-bg-cyan)",
  waiting: "var(--tone-soft-bg-amber)",
  danger: "var(--tone-soft-bg-red)",
  violet: "var(--tone-soft-bg-violet)",
};
const TONE_ICON_TEXT_CLS: Record<KpiTone, string> = {
  neutral: "text-gray-400",
  online: "text-[var(--c-online-soft-text)]",
  running: "text-[var(--c-running-soft-text)]",
  waiting: "text-[var(--c-waiting-soft-text)]",
  danger: "text-[var(--c-danger-soft-text)]",
  violet: "text-[var(--c-violet-soft-text)]",
};
const TONE_BORDER_ACTIVE: Record<KpiTone, string> = {
  neutral: "rgba(255,255,255,0.14)",
  online: "rgba(16,185,129,0.40)",
  running: "rgba(6,182,212,0.40)",
  waiting: "rgba(240,176,64,0.42)",
  danger: "rgba(248,81,73,0.40)",
  violet: "rgba(139,92,246,0.40)",
};
const TONE_WAVE_STROKE: Record<KpiTone, string> = {
  neutral: "rgba(255,255,255,0.08)",
  online: "rgba(16,185,129,0.22)",
  running: "rgba(6,182,212,0.22)",
  waiting: "rgba(240,176,64,0.24)",
  danger: "rgba(248,81,73,0.22)",
  violet: "rgba(139,92,246,0.22)",
};

type Props = {
  label: string;
  value: string | number;
  sublabel?: string;
  tone?: KpiTone;
  active?: boolean;
  /** 左上 icon — 16-18px SVG. 颜色继承父级 (TONE_ICON_TEXT_CLS). */
  icon?: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
};

export function KpiTile({
  label,
  value,
  sublabel,
  tone = "neutral",
  active = false,
  icon,
  onClick,
  className = "",
}: Props): JSX.Element {
  const isInteractive = !!onClick;

  const cardStyle: CSSProperties = {
    backgroundColor: "#0a0d12",
    backgroundImage: active ? "var(--surface-grad-active)" : "var(--surface-grad)",
    borderColor: active ? TONE_BORDER_ACTIVE[tone] : "rgba(255,255,255,0.05)",
  };

  const content = (
    <div className="relative overflow-hidden px-5 py-4 text-left">
      {/* ── 顶部行: icon + label + (active 标记) ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] ${TONE_ICON_TEXT_CLS[tone]}`}
            style={{ backgroundColor: TONE_SOFT_BG_VAR[tone] }}
          >
            {icon ?? <DefaultDot />}
          </div>
          <span className="text-[12px] tracking-[0.01em] text-gray-400">{label}</span>
        </div>
        {active ? (
          <span className="mt-1 font-mono text-[9.5px] tracking-[0.14em] text-gray-500 uppercase">
            active
          </span>
        ) : null}
      </div>

      {/* ── 大数字 ── */}
      <div className="mt-3.5 text-[28px] leading-none font-medium tracking-[-0.02em] text-white tabular-nums">
        {value}
      </div>

      {/* ── 副标 ── */}
      {sublabel ? (
        <div className="mt-2 text-[11.5px] tracking-[0.01em] text-gray-500">{sublabel}</div>
      ) : null}

      {/* ── 底部柔色波浪线装饰 (质感的关键) ── */}
      <WaveDecor tone={tone} />
    </div>
  );

  const baseCls = `relative block overflow-hidden rounded-[10px] border transition-[background-image,border-color] duration-200 ${className}`;

  if (isInteractive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseCls} w-full cursor-pointer hover:border-white/[0.10]`}
        style={cardStyle}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={baseCls} style={cardStyle}>
      {content}
    </div>
  );
}

// — 内部装饰 —

function WaveDecor({ tone }: { tone: KpiTone }): JSX.Element {
  const stroke = TONE_WAVE_STROKE[tone];
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-10 w-full"
      viewBox="0 0 200 40"
      preserveAspectRatio="none"
    >
      {/* 主波 — 略高 */}
      <path
        d="M0,24 C20,12 40,32 60,22 C80,12 100,30 120,22 C140,14 160,28 180,20 C190,16 195,22 200,18"
        fill="none"
        stroke={stroke}
        strokeWidth="1"
      />
      {/* 副波 — 错开 + 更淡 */}
      <path
        d="M0,32 C20,22 40,38 60,30 C80,22 100,36 120,30 C140,24 160,34 180,28 C190,24 195,30 200,26"
        fill="none"
        stroke={stroke}
        strokeWidth="1"
        opacity="0.55"
      />
    </svg>
  );
}

function DefaultDot(): JSX.Element {
  return <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />;
}
