import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "accent" | "ghost" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
};

export function Button({
  variant = "ghost",
  size = "md",
  leadingIcon,
  trailingIcon,
  className,
  children,
  type,
  ...rest
}: Props): JSX.Element {
  const cls = [
    styles.btn,
    styles[`variant_${variant}`],
    styles[`size_${size}`],
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type ?? "button"} className={cls} {...rest}>
      {leadingIcon ? <span aria-hidden style={{ display: "inline-flex" }}>{leadingIcon}</span> : null}
      <span>{children}</span>
      {trailingIcon ? <span aria-hidden style={{ display: "inline-flex" }}>{trailingIcon}</span> : null}
    </button>
  );
}
