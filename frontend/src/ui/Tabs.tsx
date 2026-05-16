import type { ReactNode } from "react";
import styles from "./Tabs.module.css";

export type TabItem<T extends string> = {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
};

type Props<T extends string> = {
  value: T;
  onChange: (next: T) => void;
  items: TabItem<T>[];
  ariaLabel?: string;
};

export function Tabs<T extends string>({ value, onChange, items, ariaLabel }: Props<T>): JSX.Element {
  return (
    <div className={styles.tabs}>
      <div className={styles.tablist} role="tablist" aria-label={ariaLabel}>
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={value === item.value}
            className={`${styles.tab}${value === item.value ? ` ${styles.tabActive}` : ""}`}
            onClick={() => onChange(item.value)}
          >
            {item.label}
            {item.hint ? <span className={styles.hint}>{item.hint}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
