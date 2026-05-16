/**
 * Motion primitives — shared animation wrappers for the entire app.
 * Built on top of `motion` (formerly framer-motion).
 */
import { type ReactNode } from "react";
import { motion, AnimatePresence, type Variants } from "motion/react";

/* ─── Page transition wrapper ─── */

export function PageTransition({ children, id }: { children: ReactNode; id: string }): JSX.Element {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={id}
        initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -4, filter: "blur(2px)" }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        style={{ width: "100%" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/* ─── Stagger container + item ─── */

const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.02,
    },
  },
};

const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  },
};

export function StaggerList({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  );
}

/* ─── Hover scale card ─── */

export function HoverCard({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}): JSX.Element {
  return (
    <motion.div
      className={className}
      onClick={onClick}
      whileHover={{ y: -3, scale: 1.005 }}
      whileTap={{ scale: 0.995 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      {children}
    </motion.div>
  );
}

/* ─── Fade in on mount ─── */

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ─── Number counter animation ─── */

export function AnimatedNumber({ value, className }: { value: number; className?: string }): JSX.Element {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={className}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      {value}
    </motion.span>
  );
}

/* Re-export motion for direct use */
export { motion, AnimatePresence };
