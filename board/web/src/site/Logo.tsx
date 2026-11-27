import { useRef } from "react";
import gsap from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(MotionPathPlugin, useGSAP);

// The mark: a guide-sign plate with a road that forks into two lanes, each with its arrowhead.
// Motion set: reveal (plate hung, border drawn, road drawn up, arrowheads snap, one task token
// runs up and takes a lane), hover (a token runs again and takes the other lane: the 50/50 split),
// idle (footer only, every 8 s while visible), still for reduced motion.

export const MARK = {
  trunk: "M32 56 V40",
  left: "M32 40 C32 31 21 30 21 21 V15",
  right: "M32 40 C32 31 43 30 43 21 V15",
  headL: "M15.5 20 L21 13.5 L26.5 20",
  headR: "M37.5 20 L43 13.5 L48.5 20",
  runL: "M32 60 V40 C32 31 21 30 21 21 V10",
  runR: "M32 60 V40 C32 31 43 30 43 21 V10",
};

interface Props {
  size?: number;
  reveal?: boolean;
  idle?: boolean;
  className?: string;
  title?: string;
}

export function LogoMark({ size = 32, reveal = false, idle = false, className = "", title }: Props) {
  const root = useRef<SVGSVGElement>(null);
  const turn = useRef(0);

  const { contextSafe } = useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const q = gsap.utils.selector(root);
        if (reveal) {
          const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
          tl.from(q(".lm-plate"), { clipPath: "inset(0 0 100% 0 round 13px)", duration: 0.45 })
            .from(q(".lm-border"), { strokeDashoffset: 230, duration: 0.6, ease: "power2.out" }, 0.15)
            .from(q(".lm-trunk"), { strokeDashoffset: 16, duration: 0.25, ease: "power2.in" }, 0.3)
            .from(q(".lm-branch"), { strokeDashoffset: 32, duration: 0.4, ease: "power2.out" }, 0.52)
            .from(q(".lm-head"), { scale: 0, transformOrigin: "50% 30%", duration: 0.16, ease: "power4.out", stagger: 0.04 }, 0.86)
            .add(() => run(), 0.9);
        }
        if (idle) {
          let visible = false;
          const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
          if (root.current) io.observe(root.current);
          const id = window.setInterval(() => visible && document.visibilityState === "visible" && run(), 8000);
          return () => {
            io.disconnect();
            window.clearInterval(id);
          };
        }
      });
    },
    { scope: root },
  );

  const run = contextSafe(() => {
    if (!root.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const token = root.current.querySelector(".lm-token");
    if (!token) return;
    const side = turn.current++ % 2 === 0 ? MARK.runR : MARK.runL;
    gsap.killTweensOf(token);
    gsap.fromTo(
      token,
      { opacity: 1 },
      {
        motionPath: { path: side },
        duration: 0.7,
        ease: "power1.inOut",
        onComplete: () => void gsap.set(token, { opacity: 0 }),
      },
    );
  });

  return (
    <svg
      ref={root}
      className={`logo-mark ${className}`}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      onPointerEnter={() => run()}
      onFocus={() => run()}
    >
      <rect className="lm-plate" x="1" y="1" width="62" height="62" rx="13" />
      <rect className="lm-border" x="4.5" y="4.5" width="55" height="55" rx="10" pathLength={230} strokeDasharray="230" />
      <path className="lm-road lm-trunk" d={MARK.trunk} pathLength={16} strokeDasharray="16" />
      <path className="lm-road lm-branch" d={MARK.left} pathLength={32} strokeDasharray="32" />
      <path className="lm-road lm-branch" d={MARK.right} pathLength={32} strokeDasharray="32" />
      <path className="lm-road lm-head" d={MARK.headL} />
      <path className="lm-road lm-head" d={MARK.headR} />
      <circle className="lm-token" cx="0" cy="0" r="3.4" opacity="0" />
    </svg>
  );
}

/** Static SVG markup of the mark, for the favicon and share images. */
export function markSvg(size: number, colors = { plate: "#0B6B45", line: "#F4F5EF" }): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><rect x="1" y="1" width="62" height="62" rx="13" fill="${colors.plate}"/><rect x="4.5" y="4.5" width="55" height="55" rx="10" fill="none" stroke="${colors.line}" stroke-width="2.2"/><g fill="none" stroke="${colors.line}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"><path d="${MARK.trunk}"/><path d="${MARK.left}"/><path d="${MARK.right}"/><path d="${MARK.headL}"/><path d="${MARK.headR}"/></g></svg>`;
}
