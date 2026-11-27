import { createContext, useCallback, useContext, useEffect, useRef, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { docTitle, normalize, routeFor } from "./routes";
import { prefersReducedMotion } from "../motion";

interface RouterCtx {
  path: string;
  navigate(to: string): void;
}

const Ctx = createContext<RouterCtx>({ path: "/", navigate: () => {} });

export function useRouter(): RouterCtx {
  return useContext(Ctx);
}

function scrollToHash(hash: string): boolean {
  if (!hash) return false;
  const el = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!el) return false;
  el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  return true;
}

function setMeta(path: string) {
  const r = routeFor(path);
  document.title = docTitle(r);
  document.querySelector('meta[name="description"]')?.setAttribute("content", r.description);
}

/**
 * Client routing between the prerendered pages. Each page also exists as its own HTML file, so a
 * reload or a deep link works without this. A page change plays a lane-change wipe: an asphalt
 * panel crosses the screen left to right with its lane line shifting over, the page swaps under it.
 */
export function RouterProvider({ initialPath, children }: { initialPath: string; children: ReactNode }) {
  const [path, setPath] = useState(() => normalize(initialPath));
  const wipe = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const swap = useCallback((target: string, hash: string) => {
    flushSync(() => setPath(target));
    setMeta(target);
    if (!scrollToHash(hash)) window.scrollTo(0, 0);
    const main = document.getElementById("main");
    main?.focus({ preventScroll: true });
    ScrollTrigger.refresh();
  }, []);

  const go = useCallback(
    (target: string, hash: string) => {
      const w = wipe.current;
      if (!w || prefersReducedMotion() || busy.current) {
        swap(target, hash);
        return;
      }
      busy.current = true;
      const tl = gsap.timeline({
        onComplete: () => {
          busy.current = false;
          gsap.set(w, { visibility: "hidden" });
        },
      });
      tl.set(w, { visibility: "visible", clipPath: "inset(0 100% 0 0)" })
        .to(w, { clipPath: "inset(0 0% 0 0)", duration: 0.26, ease: "power2.in" })
        .fromTo(w.querySelector(".wipe-line"), { y: "-46%" }, { y: "0%", duration: 0.26, ease: "power2.inOut" }, 0)
        .add(() => swap(target, hash))
        .to(w, { clipPath: "inset(0 0 0 100%)", duration: 0.34, ease: "power3.out" }, "+=0.04")
        .to(w.querySelector(".wipe-line"), { y: "46%", duration: 0.34, ease: "power2.inOut" }, "<");
    },
    [swap],
  );

  const navigate = useCallback(
    (to: string) => {
      const url = new URL(to, window.location.href);
      const target = normalize(url.pathname);
      if (target === path && url.search === window.location.search) {
        window.history.pushState(null, "", url.pathname + url.search + url.hash);
        if (!scrollToHash(url.hash)) window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
        return;
      }
      window.history.pushState(null, "", url.pathname + url.search + url.hash);
      if (target === path && !url.search) {
        // Same page with its query dropped (the board showing another batch): the page listens for this.
        window.dispatchEvent(new PopStateEvent("popstate"));
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
        return;
      }
      // The live board reads ?demo=replay once on load; a full load keeps that behaviour exact.
      if (url.search) {
        window.location.reload();
        return;
      }
      go(target, url.hash);
    },
    [path, go],
  );

  useEffect(() => {
    const onPop = () => {
      const target = normalize(window.location.pathname);
      flushSync(() => setPath(target));
      setMeta(target);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <Ctx.Provider value={{ path, navigate }}>
      {children}
      <div className="wipe" ref={wipe} aria-hidden="true">
        <div className="wipe-line" />
      </div>
    </Ctx.Provider>
  );
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

/** An internal link: a plain anchor that the router takes over for same-site page changes. */
export function Link({ to, onClick, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (to.startsWith("#")) return; // in-page anchor: the browser handles it
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
