import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Link, useRouter } from "./router";
import { LogoMark } from "./Logo";
import { ROUTES, routeFor } from "./routes";
import { repo } from "./data";
import { prefersReducedMotion } from "../motion";

const MAIN = ROUTES.filter((r) => r.group === "main");
const MORE = ROUTES.filter((r) => r.group === "more");

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

function MoreMenu({ active }: { active: boolean }) {
  const { path } = useRouter();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="more" ref={wrap} onBlur={(e) => !wrap.current?.contains(e.relatedTarget as Node) && setOpen(false)}>
      <button
        ref={btn}
        type="button"
        className={`nav-link more-btn ${active ? "is-active" : ""}`}
        aria-expanded={open}
        aria-controls="more-panel"
        onClick={() => setOpen((o) => !o)}
      >
        More
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      <div id="more-panel" className={`more-panel ${open ? "is-open" : ""}`} hidden={!open}>
        <ul>
          {MORE.map((r) => (
            <li key={r.path}>
              <Link to={r.path} aria-current={path === r.path ? "page" : undefined}>
                <span className="exit-no" aria-hidden="true">
                  {r.exit}
                </span>
                <span>
                  <b>{r.label}</b>
                  <small>{r.description.split(/[.:]/)[0]}</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MobileMenu({ open, onClose, returnFocus }: { open: boolean; onClose: () => void; returnFocus: () => void }) {
  const { path } = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Open and close: the sheet grows from the menu button as a circle; links rise from masks.
  useEffect(() => {
    const el = panel.current;
    if (!el || !mounted) return;
    const reduce = prefersReducedMotion();
    if (open) {
      const html = document.documentElement;
      const prev = html.style.overflow;
      html.style.overflow = "hidden";
      const first = el.querySelector<HTMLElement>("a, button");
      first?.focus({ preventScroll: true });
      const tl = reduce
        ? null
        : gsap
            .timeline()
            .fromTo(el, { clipPath: "circle(0% at calc(100% - 40px) 34px)" }, { clipPath: "circle(150% at calc(100% - 40px) 34px)", duration: 0.5, ease: "expo.out" })
            .from(el.querySelectorAll(".mm-link > span"), { yPercent: 110, duration: 0.5, ease: "expo.out", stagger: 0.035 }, 0.08);
      return () => {
        html.style.overflow = prev;
        tl?.kill();
      };
    }
    if (reduce) {
      setMounted(false);
      return;
    }
    const tl = gsap.to(el, {
      clipPath: "circle(0% at calc(100% - 40px) 34px)",
      duration: 0.26,
      ease: "power2.in",
      onComplete: () => setMounted(false),
    });
    return () => {
      tl.kill();
    };
  }, [open, mounted]);

  useEffect(() => {
    if (open) onClose();
    // close when the page changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      returnFocus();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>("a[href], button")];
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  if (!mounted && !open) return null;
  const link = (r: (typeof ROUTES)[number]) => (
    <li key={r.path}>
      <Link to={r.path} className="mm-link" aria-current={path === r.path ? "page" : undefined}>
        <span>
          <i className="exit-no" aria-hidden="true">
            {r.exit}
          </i>
          {r.label}
        </span>
      </Link>
    </li>
  );
  return (
    <div ref={panel} id="site-menu" className="mobile-menu" role="dialog" aria-modal="true" aria-label="Site menu" onKeyDown={onKeyDown}>
      <div className="mm-top">
        <span className="mm-title">Menu</span>
        <button
          type="button"
          className="mm-close"
          onClick={() => {
            onClose();
            returnFocus();
          }}
        >
          Close
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M4 4 L16 16 M16 4 L4 16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <nav aria-label="All pages" className="mm-nav">
        <p className="mm-group">The experiment</p>
        <ul>
          {link(ROUTES[0]!)}
          {MAIN.map(link)}
        </ul>
        <p className="mm-group">More</p>
        <ul className="mm-more">{MORE.map(link)}</ul>
        <a className="mm-gh" href={repo.site.repo} rel="noopener">
          <GitHubIcon /> Code on GitHub
        </a>
      </nav>
    </div>
  );
}

export function Header() {
  const { path } = useRouter();
  const current = routeFor(path);
  const header = useRef<HTMLElement>(null);
  const nav = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);

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

  useEffect(() => setHidden(false), [path]);

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
              <li>
                <MoreMenu active={current.group === "more"} />
              </li>
            </ul>
            <span className="nav-bar" ref={bar} aria-hidden="true" />
          </div>
        </nav>
        <div className="header-end">
          <a className="gh-link" href={repo.site.repo} rel="noopener" aria-label="GitHub repository">
            <GitHubIcon />
            <span>GitHub</span>
          </a>
          <button
            ref={menuBtn}
            type="button"
            className="menu-btn"
            aria-expanded={menu}
            aria-controls="site-menu"
            onClick={() => setMenu(true)}
          >
            <span className="menu-lines" aria-hidden="true">
              <i />
              <i />
            </span>
            Menu
          </button>
        </div>
      </header>
      <MobileMenu open={menu} onClose={() => setMenu(false)} returnFocus={() => menuBtn.current?.focus()} />
    </>
  );
}
