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
        <header className={styles.head}>
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p className={styles.sub}>{subtitle}</p> : null}
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </header>
      ) : null}
      <div className={bodyFlush ? `${styles.body} ${styles.bodyFlush}` : styles.body}>
        {children}
      </div>
    </section>
  );
}

export function FieldGrid({ children }: { children: ReactNode }): JSX.Element {
  return <div className={styles.fieldGrid}>{children}</div>;
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
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={mono ? `${styles.fieldValue} ${styles.fieldValueMono}` : styles.fieldValue}>
        {value === null || value === undefined || value === "" ? "—" : value}
      </span>
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </div>
  );
}

export const cardClasses = {
  titleRow: styles.titleRow,
  titleTag: styles.titleTag,
  actionsRow: styles.actionsRow,
};
