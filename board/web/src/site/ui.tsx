import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { Link } from "./router";
import { ghFile, type Block, type Snippet } from "./data";
import { routeFor, type Route } from "./routes";
import { Picto } from "./Picto";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/* ---------- inline markdown: `code`, **bold**, *em*, [text](url) ---------- */

function resolveHref(href: string): { href: string; internal: boolean } {
  if (/^https?:/.test(href)) return { href, internal: false };
  if (href.startsWith("/")) return { href, internal: true };
  // relative repo file, e.g. pilot-report.md from prereg/
  return { href: ghFile(href.replace(/^\.\//, "")), internal: false };
}

export function Md({ text, base = "" }: { text: string; base?: string }) {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (m[3]) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      const { href, internal } = resolveHref(/^https?:|^\//.test(lm[2]!) ? lm[2]! : `${base}${lm[2]}`);
      out.push(
        internal ? (
          <Link key={k++} to={href}>
            {lm[1]}
          </Link>
        ) : (
          <a key={k++} href={href} rel="noopener">
            {lm[1]}
          </a>
        ),
      );
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function Blocks({ blocks, base = "", className = "prose" }: { blocks: Block[]; base?: string; className?: string }) {
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        if (b.type === "p") return <p key={i}>{<Md text={b.text} base={base} />}</p>;
        if (b.type === "list") {
          const L = b.ordered ? "ol" : "ul";
          return (
            <L key={i}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Md text={it} base={base} />
                </li>
              ))}
            </L>
          );
        }
        return (
          <div className="table-wrap" key={i} tabIndex={0} role="region" aria-label="Table">
            <table className="data-table">
              <thead>
                <tr>
                  {b.head.map((h, j) => (
                    <th key={j} scope="col">
                      <Md text={h} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, n) => (n === 0 ? <th key={n} scope="row"><Md text={c} /></th> : <td key={n}><Md text={c} /></td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- code ---------- */

const KW = /\b(def|return|if|else|elif|for|in|while|try|except|import|from|as|class|const|let|await|async|new|function|resource|not|and|or|true|false|True|False|None|null)\b/g;

function highlight(code: string, lang: string): ReactNode[] {
  const lines = code.split("\n");
  return lines.map((line, i) => {
    const parts: ReactNode[] = [];
    const commentRe = lang === "py" || lang === "sh" || lang === "tf" || lang === "make" ? /(^|\s)(#.*)$/ : lang === "ts" ? /(^|\s)(\/\/.*)$/ : null;
    let body = line;
    let comment = "";
    if (commentRe) {
      const m = commentRe.exec(line);
      if (m && !/["'`][^"'`]*$/.test(line.slice(0, m.index + m[1]!.length))) {
        body = line.slice(0, m.index + m[1]!.length);
        comment = m[2]!;
      }
    }
    const tokRe = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    const pushPlain = (s: string) => {
      let l2 = 0;
      let km: RegExpExecArray | null;
      KW.lastIndex = 0;
      while ((km = KW.exec(s))) {
        if (km.index > l2) parts.push(s.slice(l2, km.index));
        parts.push(
          <span className="tk-k" key={`k${i}-${k++}`}>
            {km[0]}
          </span>,
        );
        l2 = km.index + km[0].length;
      }
      if (l2 < s.length) parts.push(s.slice(l2));
    };
    while ((m = tokRe.exec(body))) {
      pushPlain(body.slice(last, m.index));
      parts.push(
        <span className="tk-s" key={`s${i}-${k++}`}>
          {m[0]}
        </span>,
      );
      last = m.index + m[0].length;
    }
    pushPlain(body.slice(last));
    if (comment)
      parts.push(
        <span className="tk-c" key={`c${i}`}>
          {comment}
        </span>,
      );
    return (
      <Fragment key={i}>
        {parts}
        {i < lines.length - 1 ? "\n" : ""}
      </Fragment>
    );
  });
}

export function langOf(file: string): string {
  if (/\.py$/.test(file)) return "py";
  if (/\.(ts|tsx|js|mjs)$/.test(file) || /ts\/README/.test(file)) return "ts";
  if (/\.json$/.test(file)) return "json";
  if (/\.tf$/.test(file)) return "tf";
  if (/Makefile$/.test(file)) return "make";
  return "sh";
}

export function Code({ code, lang = "sh", caption, href, label }: { code: string; lang?: string; caption?: ReactNode; href?: string; label?: string }) {
  const [copied, setCopied] = useState<"" | "ok" | "select">("");
  const pre = useRef<HTMLPreElement>(null);
  const flash = (s: "ok" | "select") => {
    setCopied(s);
    window.setTimeout(() => setCopied(""), s === "ok" ? 1400 : 3200);
  };
  // When the clipboard is not allowed, select the code so the visitor can copy it by hand.
  const selectCode = () => {
    const el = pre.current;
    const sel = window.getSelection();
    if (el && sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    flash("select");
  };
  return (
    <figure className="code">
      <div className="code-bar">
        <span className="code-file">{caption}</span>
        <span className="code-actions">
          {href && (
            <a href={href} rel="noopener" className="code-src">
              Source<span className="sr-only">: {label ?? "file on GitHub"}</span> <span aria-hidden="true">↗</span>
            </a>
          )}
          <button
            type="button"
            className="code-copy"
            onClick={() => {
              if (!navigator.clipboard) return selectCode();
              navigator.clipboard.writeText(code).then(() => flash("ok"), selectCode);
            }}
          >
            <span aria-live="polite">{copied === "ok" ? "Copied" : copied === "select" ? "Selected: press Ctrl+C" : "Copy"}</span>
          </button>
        </span>
      </div>
      <pre tabIndex={0} ref={pre}>
        <code>{highlight(code, lang)}</code>
      </pre>
    </figure>
  );
}

/** A snippet read from a repo file at build time, with its file and line linked. */
export function RepoCode({ s, lang }: { s: Snippet; lang?: string }) {
  return (
    <Code
      code={s.code}
      lang={lang ?? langOf(s.file)}
      caption={
        <>
          {s.file}
          {s.line > 0 && <span className="code-line">:{s.line}</span>}
        </>
      }
      href={ghFile(s.file, s.line || undefined)}
      label={s.file}
    />
  );
}

/* ---------- kinetic headline: words rise from masks ---------- */

export function Kinetic({ text, as: Tag = "h2", id, className = "" }: { text: string; as?: "h1" | "h2" | "h3" | "p"; id?: string; className?: string }) {
  return (
    <Tag id={id} className={`kinetic ${className}`} data-kinetic="">
      {text.split(" ").map((w, i, a) => (
        <Fragment key={i}>
          <span className="kw">
            <span>{w}</span>
          </span>
          {i < a.length - 1 ? " " : ""}
        </Fragment>
      ))}
    </Tag>
  );
}

/* ---------- page sign: breadcrumbs, exit number, title, purpose ---------- */

export function PageHead({ route, lead, children }: { route?: Route; path?: string; lead: ReactNode; children?: ReactNode }) {
  const r = route!;
  return (
    <header className="page-head">
      <nav aria-label="Breadcrumb" className="crumbs">
        <ol>
          <li>
            <Link to="/">Home</Link>
          </li>
          <li aria-current="page">{r.label}</li>
        </ol>
      </nav>
      <div className="ph-gantry" aria-hidden="true">
        <span className="ph-beam" />
      </div>
      <div className="ph-sign" data-reveal="hang">
        <span className="ph-tab">
          Exit <b>{r.exit}</b>
        </span>
        <Picto path={r.path} />
        <Kinetic as="h1" text={r.title} className="ph-title" />
        <p className="ph-lead">{lead}</p>
        {children}
      </div>
    </header>
  );
}

export function pageRoute(path: string): Route {
  return routeFor(path);
}

/* ---------- on this page ---------- */

export function OnThisPage({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
        else if (els[0] && els[0].getBoundingClientRect().top > window.innerHeight * 0.35) setActive(els[0].id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [items]);
  return (
    <nav className="toc" aria-label="On this page">
      <p className="toc-h">On this page</p>
      <ol>
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.id}`} aria-current={active === i.id ? "location" : undefined}>
              {i.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* ---------- shared scroll reveals ---------- */

/**
 * Scroll and load reveals for everything under `scope`, by data attribute. Start states are set
 * here, never in CSS, so the page reads fine without JavaScript. Reduced motion: nothing moves.
 *   data-reveal="hang"   a sign swings in on its hangers and settles
 *   data-reveal="print"  a receipt prints out of its slot
 *   data-reveal="draw"   SVG strokes with pathLength=1 draw in
 *   data-reveal="stamp"  lands with a press and a small settle
 *   data-reveal="row"    list items hang in one after another
 *   data-kinetic         heading words rise from masks
 */
export function useReveals(scope: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const st = (el: Element, start = "top 86%") => ({ trigger: el, start, once: true });
        gsap.utils.toArray<HTMLElement>("[data-kinetic]").forEach((el) => {
          gsap.from(el.querySelectorAll(".kw > span"), { yPercent: 110, duration: 0.8, ease: "expo.out", stagger: 0.045, scrollTrigger: st(el, "top 92%") });
        });
        gsap.utils.toArray<HTMLElement>('[data-reveal="hang"]').forEach((el) => {
          gsap.from(el, { rotate: -2.5, y: -16, opacity: 0, transformOrigin: "50% 0%", duration: 1.1, ease: "elastic.out(1, 0.6)", scrollTrigger: st(el) });
        });
        gsap.utils.toArray<HTMLElement>('[data-reveal="print"]').forEach((el) => {
          gsap.from(el, { clipPath: "inset(0 0 100% 0)", duration: 1.0, ease: "steps(16)", scrollTrigger: st(el, "top 96%") });
        });
        gsap.utils.toArray<HTMLElement>('[data-reveal="stamp"]').forEach((el) => {
          gsap.from(el, { scale: 1.3, opacity: 0, rotate: -6, duration: 0.42, ease: "back.out(2)", scrollTrigger: st(el, "top 80%") });
        });
        gsap.utils.toArray<HTMLElement>('[data-reveal="row"]').forEach((el) => {
          gsap.from(el.children, { clipPath: "inset(0 0 100% 0)", y: -10, duration: 0.7, ease: "expo.out", stagger: 0.07, scrollTrigger: st(el) });
        });
        gsap.utils.toArray<SVGElement>('[data-reveal="draw"]').forEach((el) => {
          const paths = el.querySelectorAll("[data-draw]");
          gsap.fromTo(paths, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.2, ease: "power2.out", stagger: 0.08, scrollTrigger: st(el) });
        });
      });
    },
    { scope, dependencies: deps, revertOnUpdate: true },
  );
}

export function Section({ id, title, kicker, children, className = "" }: { id: string; title: string; kicker?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`doc-section ${className}`} aria-labelledby={`${id}-h`}>
      <Kinetic text={title} id={`${id}-h`} />
      {kicker && <p className="doc-kicker">{kicker}</p>}
      {children}
    </section>
  );
}
