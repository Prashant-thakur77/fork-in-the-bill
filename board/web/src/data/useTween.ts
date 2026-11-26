import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "../motion";

/** Tweens a number toward its target so meters roll instead of jumping. */
export function useTween(target: number, duration = 0.9): number {
  const [value, setValue] = useState(target);
  const obj = useRef({ v: target });

  useEffect(() => {
    if (prefersReducedMotion()) {
      obj.current.v = target;
      setValue(target);
      return;
    }
    const tw = gsap.to(obj.current, {
      v: target,
      duration,
      ease: "power2.out",
      onUpdate: () => setValue(obj.current.v),
    });
    return () => {
      tw.kill();
    };
  }, [target, duration]);

  return value;
}
