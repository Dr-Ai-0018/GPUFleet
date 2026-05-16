import type { StatusTone } from "../lib/labels";
import styles from "./StatusPill.module.css";

type Props = {
  tone: StatusTone;
  label: string;
  dot?: boolean;
  subtle?: boolean;
  pulse?: boolean;
};

export function StatusPill({ tone, label, dot = true, subtle = false, pulse = false }: Props): JSX.Element {
  const cls = [
    styles.pill,
    styles[`tone_${tone}`],
    subtle ? styles.subtle : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls}>
      {dot ? <span className={`${styles.dot}${pulse ? ` ${styles.pulse}` : ""}`} aria-hidden /> : null}
      <span>{label}</span>
    </span>
  );
}
