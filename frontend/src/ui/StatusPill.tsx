import type { StatusTone } from "../lib/labels";
import styles from "./StatusPill.module.css";

type Props = {
  tone: StatusTone;
  label: string;
  dot?: boolean;
  subtle?: boolean;
  pulse?: boolean;
  /** Use shape indicators (●△■✕) alongside color for accessibility. Default true. */
  shape?: boolean;
};

/**
 * Shape-per-tone mapping for color-blind accessibility.
 *   online  → filled circle  ●
 *   running → filled circle  ● (pulse animation distinguishes from online)
 *   waiting → hollow circle  ○
 *   offline → triangle       △
 *   danger  → cross          ✕
 *   muted   → square         ■
 */
const SHAPE_MAP: Record<StatusTone, string> = {
  online: "●",
  running: "●",
  waiting: "○",
  offline: "△",
  danger: "✕",
  muted: "■",
};

export function StatusPill({ tone, label, dot = true, subtle = false, pulse = false, shape = true }: Props): JSX.Element {
  const cls = [
    styles.pill,
    styles[`tone_${tone}`],
    subtle ? styles.subtle : "",
  ]
    .filter(Boolean)
    .join(" ");

  const indicator = shape ? (
    <span className={`${styles.shape}${pulse ? ` ${styles.pulse}` : ""}`} aria-hidden>
      {SHAPE_MAP[tone] ?? "●"}
    </span>
  ) : dot ? (
    <span className={`${styles.dot}${pulse ? ` ${styles.pulse}` : ""}`} aria-hidden />
  ) : null;

  return (
    <span className={cls}>
      {indicator}
      <span>{label}</span>
    </span>
  );
}
