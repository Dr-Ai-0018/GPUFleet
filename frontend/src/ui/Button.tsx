import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "accent" | "ghost" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = "ghost",
    size = "md",
    leadingIcon,
    trailingIcon,
    className,
    children,
    type,
    ...rest
  }: Props,
  ref,
): JSX.Element {
  const cls = [styles.btn, styles[`variant_${variant}`], styles[`size_${size}`], className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button ref={ref} type={type ?? "button"} className={cls} {...rest}>
      {leadingIcon ? (
        <span aria-hidden style={{ display: "inline-flex" }}>
          {leadingIcon}
        </span>
      ) : null}
      <span>{children}</span>
      {trailingIcon ? (
        <span aria-hidden style={{ display: "inline-flex" }}>
          {trailingIcon}
        </span>
      ) : null}
    </button>
  );
});
