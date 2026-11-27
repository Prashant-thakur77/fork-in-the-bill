import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import gsap from "gsap";
import { Link, useRouter } from "./router";
import { LogoMark } from "./Logo";
import { Picto } from "./Picto";
import { MENU_GROUPS, ROUTES, type MenuGroup, type Route } from "./routes";
import { repo } from "./data";
import { CURRENT, batchOf, batchStatus } from "./batches";
import { totals, useLiveState } from "./live";
import { prefersReducedMotion } from "../motion";
import { scrollLock } from "./scroll";

const MAIN = ROUTES.filter((r) => r.group === "main");
const HOME = ROUTES[0]!;

const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

/** One small drawing per menu group, in the page signs' line style. */
function GroupArt({ group }: { group: MenuGroup }) {
  return (
    <svg className="mg-art" viewBox="0 0 96 64" aria-hidden="true">
      {group === "experiment" && (
        <>
          <path d="M48 62 V44 C48 30 22 32 22 18 V4 M48 44 C48 30 74 32 74 18 V4" />
          <path className="is-accent" d="M48 62 V52 M48 46 V40" />
          <path d="M14 12 L22 3 L30 12 M66 12 L74 3 L82 12" />
        </>
      )}
      {group === "flagsmith" && (
        <>
          <path d="M6 10 H90 M16 10 V60 M80 10 V60" />
          <rect x="26" y="16" width="44" height="20" rx="3" className="is-fill" />
          <path className="is-accent" d="M34 26 H62" />
          <path d="M48 62 V44" />
        </>
      )}
      {group === "evidence" && (
        <>
          <path d="M22 4 H74 V52 L67 60 L61 52 L54 60 L48 52 L42 60 L35 52 L29 60 L22 52 Z" />
          <path d="M32 18 H64 M32 30 H56" />
          <path className="is-accent" d="M36 42 L44 49 L60 36" />
        </>
      )}
      {group === "use" && (
        <>
          <path d="M66 62 V2 M44 6 V16 M44 24 V34" />
          <path className="is-accent" d="M18 62 V48 C18 32 44 36 44 22" />
          <path className="is-accent" d="M36 30 L44 20 L52 30" />
        </>
      )}
    </svg>
  );
}

/** The run that is live now, as a small LED-style plate. */
function LivePlate({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const live = useLiveState(CURRENT);
  const batch = batchOf(CURRENT);
  const snap = live.kind === "ok" ? live.snapshot : null;
  const st = batch ? batchStatus(batch, snap) : null;
  const t = snap ? totals(snap) : null;
  if (!batch || !st) return null;
  if (compact) {
    return (
      <Link to="/live" className={`live-pill is-${st.key}`} onClick={onNavigate} aria-label={`${batch.label}: ${st.label}. Open the live board`}>
        <i aria-hidden="true" />
        <span>
          {batch.label.replace("Experiment", "Exp")} {st.label.toLowerCase()}
        </span>
      </Link>
    );
  }
  return (
    <Link to="/live" className={`menu-live is-${st.key}`} onClick={onNavigate} data-cursor="open">
      <span className="menu-live-k">
        <i aria-hidden="true" />
        {st.label} · {batch.label}
      </span>
      <span className="menu-live-v">
        {t ? (
          <>
            <b>{t.done.toLocaleString("en-US")}</b> tasks done · <b>{t.solved.toLocaleString("en-US")}</b> solved · <b>${t.usd.toFixed(2)}</b> spent
          </>
        ) : live.kind === "error" ? (
          "Live numbers are not reachable right now."
        ) : live.kind === "none" ? (
          "Run status shows on the deployed site."
        ) : (
          "Reading the board…"
        )}
      </span>
      <span className="menu-live-go">
        Open the live board <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}

function Menu({ open, onClose, returnFocus, origin }: { open: boolean; onClose: () => void; returnFocus: () => void; origin: { x: number; y: number } }) {
  const { path } = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Route>(HOME);
  const wasOpen = useRef(false);
  const drag = useRef<{ y0: number; t0: number; dy: number } | null>(null);

  // Open: a wipe that grows from the button (a sheet rising from the bottom on phones); the
  // links come up from their masks. Close is quicker than open.
  useEffect(() => {
    const el = panel.current;
    const sh = sheet.current;
    if (!el || !sh) return;
    const phone = window.matchMedia("(max-width: 760px)").matches;
    const reduce = prefersReducedMotion();
    if (open) {
      wasOpen.current = true;
      scrollLock(true);
      el.style.visibility = "visible";
      gsap.killTweensOf([el, sh]);
      if (!reduce) {
        const tl = gsap.timeline();
        if (phone) {
          tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "none" }).fromTo(sh, { yPercent: 100 }, { yPercent: 0, duration: 0.42, ease: "expo.out" }, 0);
        } else {
          tl.set(sh, { yPercent: 0 }).fromTo(
            el,
            { opacity: 1, clipPath: `circle(0px at ${origin.x}px ${origin.y}px)` },
            { clipPath: `circle(150vmax at ${origin.x}px ${origin.y}px)`, duration: 0.5, ease: "expo.out", clearProps: "clipPath" },
          );
        }
        tl.fromTo(el.querySelectorAll(".mm-rise"), { yPercent: 115 }, { yPercent: 0, duration: 0.42, ease: "expo.out", stagger: 0.012 }, phone ? 0.1 : 0.08)
          .fromTo(el.querySelectorAll(".mg-art, .menu-side > *"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out", stagger: 0.03 }, 0.14)
          .fromTo(el.querySelectorAll(".mm-lane"), { scaleY: 0 }, { scaleY: 1, duration: 0.5, ease: "power3.out", stagger: 0.04 }, 0.05);
      } else {
        gsap.set([el, sh], { clearProps: "all" });
        el.style.visibility = "visible";
      }
      (el.querySelector<HTMLElement>(".menu-close") ?? el).focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      scrollLock(false);
      gsap.killTweensOf([el, sh]);
      const hide = () => {
        el.style.visibility = "hidden";
        gsap.set(sh, { clearProps: "transform" });
      };
      if (reduce) hide();
      else if (phone) gsap.to(sh, { yPercent: 100, duration: 0.26, ease: "power2.in", onComplete: hide });
      else gsap.to(el, { clipPath: `circle(0px at ${origin.x}px ${origin.y}px)`, duration: 0.28, ease: "power2.in", onComplete: () => (hide(), gsap.set(el, { clearProps: "clipPath" })) });
    }
    return undefined;
  }, [open, origin.x, origin.y]);

  // Escape closes; Tab stays inside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        returnFocus();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, returnFocus]);

  // The preview sign leans toward the pointer (fine pointers only); it never sits under it.
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = preview.current;
    if (!p || e.pointerType !== "mouse" || prefersReducedMotion()) return;
    const r = panel.current!.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width - 0.5;
    const dy = (e.clientY - r.top) / r.height - 0.5;
    gsap.to(p, { x: dx * 36, y: dy * 70, rotate: dx * 3, duration: 0.6, ease: "power3.out", overwrite: true });
  };

  // Phones: drag the sheet down by its handle to close it.
  const onGrab = (e: RPointerEvent<HTMLDivElement>) => {
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    drag.current = { y0: e.clientY, t0: performance.now(), dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDrag = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !sheet.current) return;
    d.dy = Math.max(0, e.clientY - d.y0);
    gsap.set(sheet.current, { y: d.dy });
  };
  const onDrop = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !sheet.current) return;
    const fast = d.dy / Math.max(1, performance.now() - d.t0) > 0.6;
    if (d.dy > 120 || (fast && d.dy > 30)) {
      gsap.set(sheet.current, { y: 0, yPercent: (d.dy / sheet.current.offsetHeight) * 100 });
      onClose();
      returnFocus();
    } else gsap.to(sheet.current, { y: 0, duration: 0.3, ease: "expo.out" });
  };

  const pick = (r: Route) => () => setShown(r);
  const close = () => onClose();

  return (
    <div
      className="menu"
      id="site-menu"
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Site menu"
      tabIndex={-1}
      onPointerMove={onMove}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
          returnFocus();
        }
      }}
      {...(open ? {} : ({ inert: "" } as object))}
    >
      <div className="menu-sheet" ref={sheet}>
        <div className="menu-grab" onPointerDown={onGrab} onPointerMove={onDrag} onPointerUp={onDrop} onPointerCancel={onDrop}>
          <span className="menu-handle" aria-hidden="true" />
          <Link to="/" className="menu-home" onClick={close} onMouseEnter={pick(HOME)} onFocus={pick(HOME)}>
            <LogoMark size={30} />
            <span>Fork in the Bill</span>
          </Link>
          <button
            type="button"
            className="menu-close"
            onClick={() => {
              onClose();
              returnFocus();
            }}
          >
            <span className="menu-x" aria-hidden="true">
              <i />
              <i />
            </span>
            Close
          </button>
        </div>

        <div className="menu-body">
          <nav className="menu-groups" aria-label="All pages">
            {MENU_GROUPS.map((g) => (
              <section key={g.key} className={`mg mg-${g.key}`} aria-labelledby={`mg-${g.key}`}>
                <span className="mm-lane" aria-hidden="true" />
                <GroupArt group={g.key} />
                <h2 id={`mg-${g.key}`} className="mg-title">
                  <span className="mm-mask">
                    <span className="mm-rise">{g.title}</span>
                  </span>
                </h2>
                <p className="mg-line">
                  <span className="mm-mask">
                    <span className="mm-rise">{g.line}</span>
                  </span>
                </p>
                <ul>
                  {ROUTES.filter((r) => r.menu === g.key).map((r) => (
                    <li key={r.path}>
                      <Link
                        to={r.path}
                        className={`nv-link ${path === r.path ? "is-active" : ""}`}
                        aria-current={path === r.path ? "page" : undefined}
                        onClick={close}
                        onMouseEnter={pick(r)}
                        onFocus={pick(r)}
                        data-cursor="open"
                      >
                        <span className="mm-mask">
                          <span className="mm-rise">
                            <span className="mm-label" data-text={r.label}>
                              <span>{r.label}</span>
                            </span>
                            {r.path === "/live" && <i className="mm-dot" aria-hidden="true" />}
                          </span>
                        </span>
                        {r.blurb && (
                          <span className="mm-mask mm-blurb">
                            <span className="mm-rise">{r.blurb}</span>
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>

          <aside className="menu-side" aria-label="Now, and elsewhere">
            <div className="menu-preview" aria-hidden="true">
              <div className="menu-preview-sign" ref={preview}>
                <span className="ph-tab">
                  Exit <b>{shown.exit}</b>
                </span>
                {shown.path === "/" || shown.path === "/live" ? <LogoMark size={56} /> : <Picto path={shown.path} />}
                <p className="menu-preview-title">{shown.title}</p>
                <p className="menu-preview-text">{shown.description}</p>
              </div>
            </div>
            <LivePlate onNavigate={close} />
            <Link to="/updates" className="menu-ticket" onClick={close} onMouseEnter={pick(ROUTES.find((r) => r.path === "/updates")!)} data-cursor="open">
              <span className="menu-ticket-k">Updates window</span>
              <span className="menu-ticket-v">
                One email when the experiment 2 write-up is published <span aria-hidden="true">→</span>
              </span>
            </Link>
            <a className="menu-gh" href={repo.site.repo} rel="noopener">
              <GitHubIcon /> GitHub repository <span aria-hidden="true">↗</span>
            </a>
          </aside>
        </div>
      </div>
    </div>
  );
}

export function Header() {
  const { path } = useRouter();
  const header = useRef<HTMLElement>(null);
  const nav = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  // Hide on the way down, return on the way up.
  useEffect(() => {
    let last = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const d = y - last;
        const focusInside = header.current?.contains(document.activeElement);
        if (y < 80 || d < -6) setHidden(false);
        else if (d > 6 && !focusInside) setHidden(true);
        setScrolled(y > 8);
        last = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setHidden(false);
    setMenu(false);
  }, [path]);

  // The active marker is one painted bar that slides to the current link.
  useIsoLayout(() => {
    const place = () => {
      const n = nav.current;
      const b = bar.current;
      if (!n || !b) return;
      const target = n.querySelector<HTMLElement>(".nav-link.is-active");
      if (!target) {
        b.style.opacity = "0";
        return;
      }
      const nb = n.getBoundingClientRect();
      const tb = target.getBoundingClientRect();
      b.style.opacity = "1";
      b.style.width = `${tb.width - 24}px`;
      b.style.transform = `translateX(${tb.left - nb.left + 12}px)`;
    };
    place();
    window.addEventListener("resize", place);
    document.fonts?.ready.then(place).catch(() => {});
    return () => window.removeEventListener("resize", place);
  }, [path]);

  const toggle = () => {
    const r = menuBtn.current?.getBoundingClientRect();
    if (r) setOrigin({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    setMenu((m) => !m);
  };

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header ref={header} className={`site-header ${hidden && !menu ? "is-hidden" : ""} ${scrolled ? "is-scrolled" : ""}`}>
        <Link to="/" className="brand" aria-label="Fork in the Bill, home">
          <LogoMark size={34} reveal />
          <span className="brand-word">Fork in the Bill</span>
        </Link>
        <nav aria-label="Main" className="nav-desktop">
          <div className="nav-track" ref={nav}>
            <ul>
              {MAIN.map((r) => (
                <li key={r.path}>
                  <Link to={r.path} className={`nav-link ${path === r.path ? "is-active" : ""}`} aria-current={path === r.path ? "page" : undefined}>
                    {r.label}
                  </Link>
                </li>
              ))}
            </ul>
            <span className="nav-bar" ref={bar} aria-hidden="true" />
          </div>
        </nav>
        <div className="header-end">
          <LivePlate compact />
          <a className="gh-link" href={repo.site.repo} rel="noopener" aria-label="GitHub repository">
            <GitHubIcon />
            <span>GitHub</span>
          </a>
          <button ref={menuBtn} type="button" className={`menu-btn ${menu ? "is-open" : ""}`} aria-expanded={menu} aria-controls="site-menu" onClick={toggle} data-magnet="">
            <span className="menu-lines" aria-hidden="true">
              <i />
              <i />
            </span>
            Menu
          </button>
        </div>
      </header>
      <Menu open={menu} onClose={() => setMenu(false)} returnFocus={() => menuBtn.current?.focus()} origin={origin} />
    </>
  );
}
