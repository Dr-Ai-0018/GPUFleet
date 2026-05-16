/**
 * AmbientBackground — lightweight CSS-only animated background.
 * No WebGL, no canvas, pure CSS gradients + keyframes.
 * Elegant, performant, GPU-composited.
 */
import styles from "./ParticleField.module.css";

export function ParticleField(): JSX.Element {
  return (
    <div className={styles.bg} aria-hidden>
      <div className={styles.orb1} />
      <div className={styles.orb2} />
      <div className={styles.orb3} />
      <div className={styles.grid} />
      <div className={styles.noise} />
    </div>
  );
}
