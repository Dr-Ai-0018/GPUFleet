/**
 * AnimatedNumber — smooth counting transition between values.
 *
 * Uses motion's useSpring to animate from the previous value to the current
 * value, producing a "rolling counter" effect instead of an abrupt jump.
 */
import { useEffect, useRef } from "react";
import { motion, useSpring, useTransform } from "motion/react";

type Props = {
  /** The target numeric value. */
  value: number;
  /** Decimal places to display (default 0). */
  precision?: number;
  /** Optional suffix appended after the number, e.g. "%" or " MB". */
  suffix?: string;
  /** Optional prefix before the number, e.g. "$". */
  prefix?: string;
  /** CSS class applied to the outer <span>. */
  className?: string;
  /** Spring stiffness — higher = faster snap (default 120). */
  stiffness?: number;
  /** Spring damping — higher = less bounce (default 28). */
  damping?: number;
};

function AnimatedNumberInner({
  value,
  precision = 0,
  suffix = "",
  prefix = "",
  className,
  stiffness = 120,
  damping = 28,
}: Props): JSX.Element {
  const spring = useSpring(value, { stiffness, damping });
  const display = useTransform(spring, (v) => `${prefix}${v.toFixed(precision)}${suffix}`);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  // Subscribe to display changes and update DOM directly for performance
  useEffect(() => {
    const unsubscribe = display.on("change", (v) => {
      if (ref.current) ref.current.textContent = v;
    });
    return unsubscribe;
  }, [display]);

  return (
    <motion.span ref={ref} className={className}>
      {`${prefix}${value.toFixed(precision)}${suffix}`}
    </motion.span>
  );
}

export { AnimatedNumberInner as AnimatedNumber };
