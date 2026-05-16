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
    window.setTimeout(() => {
      setItems((prev) => prev.filter((entry) => entry.id !== id));
    }, ttl);
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className={styles.stack} role="status" aria-live="polite">
        {items.map((entry) => (
          <ToastItem
            key={entry.id}
            toast={entry}
            onDismiss={() => setItems((prev) => prev.filter((it) => it.id !== entry.id))}
          />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setOpen(true), 10);
    return () => window.clearTimeout(id);
  }, []);
  const cls = [
    styles.toast,
    styles[`tone_${toast.tone}`],
    open ? styles.open : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <span className={styles.bar} aria-hidden />
      <div className={styles.body}>
        <div className={styles.title}>{toast.title}</div>
        {toast.description ? <div className={styles.desc}>{toast.description}</div> : null}
      </div>
      <button type="button" className={styles.close} onClick={onDismiss} aria-label="关闭">
        ×
      </button>
    </div>
  );
}
