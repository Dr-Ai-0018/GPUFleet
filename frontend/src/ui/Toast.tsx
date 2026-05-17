import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./Toast.module.css";

export type ToastTone = "info" | "success" | "warning" | "error";

export type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  ttl: number;
};

type ToastApi = {
  push: (toast: Omit<Toast, "id" | "ttl"> & { ttl?: number }) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback<ToastApi["push"]>((toast) => {
    idRef.current += 1;
    const id = idRef.current;
    const ttl = toast.ttl ?? 4200;
    setItems((prev) => [...prev, { id, tone: toast.tone, title: toast.title, description: toast.description, ttl }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } as Toast & { exiting?: boolean } : t)));
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 220);
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className={styles.stack} role="status" aria-live="polite">
        {items.map((entry) => (
          <ToastItem key={entry.id} toast={entry} onDismiss={() => dismiss(entry.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }): JSX.Element {
  const [phase, setPhase] = useState<"enter" | "visible" | "exit">("enter");

  useEffect(() => {
    const enterTimer = setTimeout(() => setPhase("visible"), 20);
    return () => clearTimeout(enterTimer);
  }, []);

  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setPhase("exit");
      setTimeout(onDismiss, 220);
    }, toast.ttl);
    return () => clearTimeout(exitTimer);
  }, [toast.ttl, onDismiss]);

  const cls = [
    styles.toast,
    styles[`tone_${toast.tone}`],
    phase === "visible" ? styles.visible : "",
    phase === "exit" ? styles.exit : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <div className={styles.icon} aria-hidden>
        <ToastIcon tone={toast.tone} />
      </div>
      <div className={styles.body}>
        <div className={styles.title}>{toast.title}</div>
        {toast.description ? <div className={styles.desc}>{toast.description}</div> : null}
      </div>
      <button type="button" className={styles.close} onClick={() => { setPhase("exit"); setTimeout(onDismiss, 220); }} aria-label="关闭">
        <svg width={12} height={12} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>
      <div className={styles.progress} style={{ animationDuration: `${toast.ttl}ms` }} />
    </div>
  );
}

function ToastIcon({ tone }: { tone: ToastTone }): JSX.Element {
  const p = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (tone) {
    case "success":
      return <svg {...p}><circle cx="8" cy="8" r="6" /><path d="M5.5 8l1.5 1.5 3.5-3.5" /></svg>;
    case "error":
      return <svg {...p}><circle cx="8" cy="8" r="6" /><path d="M6 6l4 4M10 6l-4 4" /></svg>;
    case "warning":
      return <svg {...p}><path d="M8 2L14 13H2L8 2z" /><path d="M8 7v2.5" /><circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" /></svg>;
    default:
      return <svg {...p}><circle cx="8" cy="8" r="6" /><path d="M8 5.5v3" /><circle cx="8" cy="10.5" r="0.5" fill="currentColor" stroke="none" /></svg>;
  }
}
