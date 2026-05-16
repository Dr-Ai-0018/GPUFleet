import { useEffect, useState } from "react";
import { copyText } from "../lib/copy";
import styles from "./CodeBlock.module.css";

type Props = {
  label?: string;
  value: string;
  language?: string;
  multiline?: boolean;
  maxHeight?: number;
  copyable?: boolean;
};

export function CodeBlock({
  label,
  value,
  multiline = true,
  maxHeight,
  copyable = true,
}: Props): JSX.Element {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const id = window.setTimeout(() => setState("idle"), 1600);
    return () => window.clearTimeout(id);
  }, [state]);

  async function onCopy() {
    const ok = await copyText(value);
    setState(ok ? "ok" : "err");
  }

  return (
    <div className={styles.code}>
      {label || copyable ? (
        <div className={styles.head}>
          {label ? <span className={styles.label}>{label}</span> : <span />}
          {copyable ? (
            <button
              type="button"
              className={styles.copyBtn}
              onClick={onCopy}
              data-state={state}
            >
              {state === "ok" ? "已复制" : state === "err" ? "复制失败" : "复制"}
            </button>
          ) : null}
        </div>
      ) : null}
      <pre
        className={multiline ? styles.body : `${styles.body} ${styles.bodyInline}`}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {value || "—"}
      </pre>
    </div>
  );
}
