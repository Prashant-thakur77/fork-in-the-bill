import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { prefersReducedMotion } from "../motion";

// Smooth scrolling for wheel and trackpad, driven by the one animation ticker the site already
// has, so scroll-linked motion and the scroll position never disagree. Native speed and direction
// are kept; nothing is hijacked. It is off for reduced motion and for touch, where the platform's
// own scrolling is better.

let lenis: Lenis | null = null;
let locks = 0;

export function initSmoothScroll(): () => void {
  if (typeof window === "undefined" || lenis) return () => {};
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (prefersReducedMotion() || !fine) return () => {};
  const l = new Lenis({
    lerp: 0.14,
    wheelMultiplier: 1,
    smoothWheel: true,
    anchors: { offset: -84 },
    // Panels that scroll on their own keep their native wheel.
    prevent: (node: Element) => !!node.closest?.(".menu-sheet, .vf-tape, [data-own-scroll]"),
  });
  lenis = l;
  l.on("scroll", ScrollTrigger.update);
  const tick = (time: number) => l.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  document.documentElement.classList.add("has-smooth");
  return () => {
    gsap.ticker.remove(tick);
    l.destroy();
    lenis = null;
    document.documentElement.classList.remove("has-smooth");
  };
}

/** Jump without animation (page changes). */
export function jumpTo(y: number) {
  if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
  else window.scrollTo(0, y);
}

/** Travel to a position or an element; instant under reduced motion. */
export function travelTo(target: number | HTMLElement) {
  if (lenis) lenis.scrollTo(target, { offset: typeof target === "number" ? 0 : -84, duration: 0.9 });
  else if (typeof target === "number") window.scrollTo({ top: target, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  else target.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

/** Stops the page behind an open panel from scrolling. Calls nest. */
export function scrollLock(on: boolean) {
  locks = Math.max(0, locks + (on ? 1 : -1));
  const locked = locks > 0;
  document.documentElement.classList.toggle("is-locked", locked);
  if (locked) lenis?.stop();
  else lenis?.start();
}

/** The page's position as a motorway chainage: 3,400 px down the road reads "km 3+400". */
export function chainage(px: number): string {
  const m = Math.max(0, Math.round(px / 100) * 100);
  return `km ${Math.floor(m / 1000)}+${String(m % 1000).padStart(3, "0")}`;
}
