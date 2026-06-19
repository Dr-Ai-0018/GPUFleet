import type { ReactNode } from "react";
import styles from "./Card.module.css";

type CardProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
  /** Pull the body padding so an embedded list/table can flush to the edges. */
  bodyFlush?: boolean;
};

export function Card({
  title,
  subtitle,
  actions,
  className,
  children,
  bodyFlush = false,
}: CardProps): JSX.Element {
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <section className={`${styles.card}${className ? ` ${className}` : ""}`}>
      {hasHeader ? (
        <header className={styles["card__head"]}>
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p className={styles["card__sub"]}>{subtitle}</p> : null}
          </div>
          {actions ? <div className={styles["card__actions"]}>{actions}</div> : null}
        </header>
      ) : null}
      <div
        className={
          bodyFlush
            ? `${styles["card__body"]} ${styles["card__body--flush"]}`
            : styles["card__body"]
        }
      >
        {children}
      </div>
    </section>
  );
}

export function FieldGrid({ children }: { children: ReactNode }): JSX.Element {
  return <div className={styles["card__field-grid"]}>{children}</div>;
}

export function Field({
  label,
  value,
  hint,
  mono = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className={styles["card__field"]}>
      <span className={styles["card__field-label"]}>{label}</span>
      <span
        className={
          mono
            ? `${styles["card__field-value"]} ${styles["card__field-value--mono"]}`
            : styles["card__field-value"]
        }
      >
        {value === null || value === undefined || value === "" ? "—" : value}
      </span>
      {hint ? <span className={styles["card__field-hint"]}>{hint}</span> : null}
    </div>
  );
}

export const cardClasses = {
  titleRow: styles["card__title-row"],
  titleTag: styles["card__title-tag"],
  actionsRow: styles["card__actions-row"],
};
