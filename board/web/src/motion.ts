// Shared motion vocabulary: mechanical and steady (see .design/DESIGN.md).
export const DUR = { snap: 0.16, ui: 0.32, reveal: 0.8, show: 1.6 } as const;
export const EASE = {
  snap: "power4.out", // signal heads, presses
  reveal: "expo.out", // signs being hung, sections arriving
  exit: "power2.in",
  merge: "power2.inOut", // lane closure taper
} as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
