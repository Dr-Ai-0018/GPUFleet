import styles from "./Skeleton.module.css";

type Props = {
  className?: string;
};

export function Skeleton({ className }: Props): JSX.Element {
  return <div className={[styles.skeleton, className ?? ""].filter(Boolean).join(" ")} aria-hidden />;
}
