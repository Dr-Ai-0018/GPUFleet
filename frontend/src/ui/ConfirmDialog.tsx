import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import styles from "./ConfirmDialog.module.css";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "accent";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  variant = "danger",
  onConfirm,
  onCancel,
}: Props): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key !== "Tab") {
        return;
      }
      const focusable = [cancelRef.current, confirmRef.current].filter(
        (el): el is HTMLButtonElement => el !== null && !el.disabled,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onCancel],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      cancelRef.current?.focus();
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return createPortal(
    <div className={styles.overlay} onClick={onCancel} role="presentation">
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className={styles["dialog__title"]}>
          {title}
        </h2>
        <p id="confirm-dialog-message" className={styles["dialog__message"]}>
          {message}
        </p>
        <div className={styles["dialog__actions"]}>
          <Button ref={cancelRef} variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} variant={variant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
