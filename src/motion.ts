import { useReducedMotion } from 'motion/react';

const ease = [0.22, 1, 0.36, 1] as const;

/** Shared, short transitions for the workspace; reduced motion is instant. */
export function useMotionSettings() {
  const reduced = !!useReducedMotion();
  const transition = { duration: reduced ? 0 : 0.2, ease };
  return {
    reduced,
    transition,
    reveal: {
      initial: reduced ? (false as const) : { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0 },
      transition,
    },
    popover: {
      initial: reduced ? (false as const) : { opacity: 0, y: 6, scale: 0.98 },
      animate: { opacity: 1, y: 0, scale: 1 },
      exit: { opacity: 0, y: reduced ? 0 : 6, scale: reduced ? 1 : 0.98 },
      transition,
    },
  };
}
