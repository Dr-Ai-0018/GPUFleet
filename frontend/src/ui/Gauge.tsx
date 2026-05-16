import styles from "./Gauge.module.css";

type Tone = "calm" | "warm" | "alert" | "indigo";

type Props = {
  value: number;
  size?: number;
  thickness?: number;
  label?: string;
  tone?: Tone;
};

export function Gauge({ value, size = 76, thickness = 4, label, tone }: Props): JSX.Element {
  const safe = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - safe / 100);

  const autoTone: Tone = tone ?? (safe >= 90 ? "alert" : safe >= 75 ? "warm" : "calm");

  return (
    <div className={`${styles.gauge} ${styles[`tone_${autoTone}`]}`} style={{ width: size, height: size }}>
      <svg className={styles.svg} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className={styles.track}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
        />
        <circle
          className={styles.value}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className={styles.center}>
        <div className={styles.percent}>
          {Math.round(safe)}<span className={styles.pct}>%</span>
        </div>
        {label ? <div className={styles.label}>{label}</div> : null}
      </div>
    </div>
  );
}
