"use client";

import { motion, useReducedMotion } from "motion/react";

/** Confirmed: a ring fills, then the check draws. Static under reduced motion. */
export function SuccessMark() {
  const reduce = useReducedMotion();
  const ease = [0.16, 1, 0.3, 1] as const;
  return (
    <motion.svg
      viewBox="0 0 64 64"
      className="size-16 text-tint"
      aria-hidden
      initial={reduce ? false : { scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.45, ease }}
    >
      <circle cx="32" cy="32" r="32" fill="currentColor" />
      <motion.path
        d="M19 33.5 28 42l17-19"
        fill="none"
        stroke="var(--tint-foreground)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, delay: reduce ? 0 : 0.25, ease }}
      />
    </motion.svg>
  );
}
