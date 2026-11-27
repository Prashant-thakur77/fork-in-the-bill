import gsap from "gsap";
import { prefersReducedMotion } from "../motion";

// Pointer effects for mice and trackpads only. The system pointer is never hidden: the marker
// travels beside it, so the click point is always the real one. Everything here is delegated
// from the document, so it keeps working as pages change. Touch, coarse pointers and reduced
// motion get none of it.

const MAGNET = ".btn-dark, .btn-sheet, [data-magnet]";
const TILT = "[data-tilt], .next-row, .dl-card, .faq-jump a, .flag-plate, .dec-card, .gl-plate, .menu-live, .menu-ticket";
const SWEEP = ".btn, .rb-btn, .booth-choice, .sl-chip";

/** What the marker says over each kind of thing. */
const LABELS: Record<string, string> = { open: "open", drag: "drag", play: "play", pick: "pick", send: "send", run: "run", save: "save", break: "break it", copy: "copy" };

export function initPointerFx(): () => void {
  if (typeof window === "undefined") return () => {};
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches || prefersReducedMotion()) return () => {};

  const marker = document.createElement("div");
  marker.className = "cursor-mark";
  marker.setAttribute("aria-hidden", "true");
  marker.innerHTML = '<i></i><span class="cursor-label"></span>';
  document.body.appendChild(marker);
  const label = marker.querySelector<HTMLElement>(".cursor-label")!;
  const toX = gsap.quickTo(marker, "x", { duration: 0.22, ease: "power3.out" });
  const toY = gsap.quickTo(marker, "y", { duration: 0.22, ease: "power3.out" });
  let seen = false;
  let lastLabel = "";
  let magnet: HTMLElement | null = null;
  let tilt: HTMLElement | null = null;

  const labelFor = (t: Element | null): string => {
    if (!t) return "";
    if (t.closest("input, textarea, select, [contenteditable=true]")) return "";
    const tagged = t.closest<HTMLElement>("[data-cursor]");
    if (tagged) return LABELS[tagged.dataset.cursor ?? ""] ?? "";
    if (t.closest(".sl-handle, .sl-road, .share-range, input[type=range]")) return "drag";
    if (t.closest(".rb-btn")) return "play";
    if (t.closest(".code-copy")) return "copy";
    if (t.closest(".next-row, .dl-card, .faq-jump a, .bs-tab, .closing-sign a, .answer")) return "open";
    return "";
  };

  const release = (el: HTMLElement) => gsap.to(el, { x: 0, y: 0, duration: 0.6, ease: "elastic.out(1, 0.5)", overwrite: "auto" });
  const flatten = (el: HTMLElement) => {
    gsap.to(el, { rotateX: 0, rotateY: 0, duration: 0.5, ease: "power3.out", overwrite: "auto", clearProps: "transform" });
    el.style.removeProperty("--glare-x");
    el.classList.remove("is-tilting");
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (!seen) {
      seen = true;
      gsap.set(marker, { x: e.clientX, y: e.clientY });
      marker.classList.add("is-on");
    }
    toX(e.clientX);
    toY(e.clientY);
    const t = e.target as Element | null;

    const text = labelFor(t);
    if (text !== lastLabel) {
      lastLabel = text;
      if (text) label.textContent = text;
      marker.classList.toggle("has-label", !!text);
    }
    marker.classList.toggle("is-quiet", !!t?.closest("input, textarea, select"));

    // Magnetic pull: a primary button leans a third of the way toward the pointer.
    const m = t?.closest<HTMLElement>(MAGNET) ?? null;
    if (m !== magnet) {
      if (magnet) release(magnet);
      magnet = m && !m.hasAttribute("disabled") ? m : null;
    }
    if (magnet) {
      const r = magnet.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      gsap.to(magnet, { x: gsap.utils.clamp(-8, 8, dx * 0.3), y: gsap.utils.clamp(-6, 6, dy * 0.3), duration: 0.3, ease: "power3.out", overwrite: "auto" });
    }

    // A small tilt on plates and cards, with a band of light that follows the pointer.
    const c = t?.closest<HTMLElement>(TILT) ?? null;
    if (c !== tilt) {
      if (tilt) flatten(tilt);
      tilt = c;
      tilt?.classList.add("is-tilting");
    }
    if (tilt) {
      const r = tilt.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      gsap.to(tilt, { rotateY: px * 3.2, rotateX: -py * 3.2, transformPerspective: 900, duration: 0.3, ease: "power3.out", overwrite: "auto" });
      tilt.style.setProperty("--glare-x", `${((px + 0.5) * 100).toFixed(1)}%`);
    }
  };

  // Hover fills sweep in from the side the pointer came from.
  const onOver = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const b = (e.target as Element | null)?.closest<HTMLElement>(SWEEP);
    if (!b || b.contains(e.relatedTarget as Node | null)) return;
    const r = b.getBoundingClientRect();
    b.style.setProperty("--sweep-from", e.clientX < r.left + r.width / 2 ? "0%" : "100%");
  };

  // The hero's art leans with the pointer in two depth layers.
  const onHero = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const hero = (e.target as Element | null)?.closest<HTMLElement>(".home-hero");
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    const near = hero.querySelector(".hero-junction .gantry");
    const far = hero.querySelector(".hero-junction .hero-road");
    if (near) gsap.to(near, { x: px * -10, y: py * -6, duration: 0.8, ease: "power3.out", overwrite: "auto" });
    if (far) gsap.to(far, { x: px * 6, y: py * 4, duration: 0.8, ease: "power3.out", overwrite: "auto" });
  };

  const onLeaveDoc = () => {
    marker.classList.remove("is-on");
    seen = false;
    if (magnet) release(magnet);
    if (tilt) flatten(tilt);
    magnet = tilt = null;
  };
  const onDown = () => marker.classList.add("is-down");
  const onUp = () => marker.classList.remove("is-down");

  document.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointermove", onHero, { passive: true });
  document.addEventListener("pointerover", onOver, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeaveDoc);
  document.addEventListener("pointerdown", onDown, { passive: true });
  document.addEventListener("pointerup", onUp, { passive: true });
  document.documentElement.classList.add("has-fx");
  return () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointermove", onHero);
    document.removeEventListener("pointerover", onOver);
    document.documentElement.removeEventListener("pointerleave", onLeaveDoc);
    document.removeEventListener("pointerdown", onDown);
    document.removeEventListener("pointerup", onUp);
    document.documentElement.classList.remove("has-fx");
    marker.remove();
  };
}
