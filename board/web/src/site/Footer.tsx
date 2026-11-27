import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { Link } from "./router";
import { LogoMark } from "./Logo";
import { MENU_GROUPS, ROUTES } from "./routes";
import { BoothLineForm } from "./Booth";
import { travelTo } from "./scroll";
import { ghFile, repo } from "./data";
import { totals, useLiveState, utcTime } from "./live";
import { CURRENT, batchOf, batchStatus } from "./batches";
import { carMarkup } from "../art/car";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function StatusLine() {
  const live = useLiveState(CURRENT);
  const batch = batchOf(CURRENT);
  const name = batch?.label ?? CURRENT;
  let dot = "is-off";
  let text = "Checking the run…";
  if (live.kind === "none") text = "Run status shows on the deployed site.";
  if (live.kind === "error") text = "Live numbers are not reachable right now.";
  if (live.kind === "ok") {
    const s = live.snapshot;
    const st = batch ? batchStatus(batch, s) : null;
    if (!s) text = `${name}: no totals posted yet.`;
    else {
      const t = totals(s);
      dot = st?.key === "live" ? "is-on" : "is-amber";
      text = `${name} · ${st?.label.toLowerCase() ?? s.status} · ${t.done.toLocaleString("en-US")} tasks done · checked ${utcTime(live.checkedAt)}`;
    }
  }
  return (
    <p className="status-line" aria-live="polite">
      <i className={`status-dot ${dot}`} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

const WORD = "FORK IN THE BILL";

export function Footer() {
  const root = useRef<HTMLElement>(null);
  const prereg = repo.hashes.find((h) => /experiment-1\.md$/.test(h.file));

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        // The road lettering is painted letter by letter as the finale comes into view.
        gsap.from(".fw-ch", {
          yPercent: 105,
          duration: 0.9,
          ease: "expo.out",
          stagger: 0.035,
          scrollTrigger: { trigger: ".finale-word", start: "top 92%", once: true },
        });
        // The exit sign swings in on its two hangers and settles.
        gsap.from(".finale-sign", {
          rotate: -5,
          y: -18,
          transformOrigin: "50% 0%",
          duration: 1.1,
          ease: "elastic.out(1, 0.55)",
          scrollTrigger: { trigger: ".finale", start: "top 85%", once: true },
        });
        // The painted letters lift a little under the pointer, and a car on the road drives to it.
        const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
        const word = root.current?.querySelector<HTMLElement>(".finale-word");
        const car = root.current?.querySelector<HTMLElement>(".finale-car");
        if (fine && word) {
          const letters = gsap.utils.toArray<HTMLElement>(".fw-ch");
          const lift = letters.map((l) => gsap.quickTo(l, "y", { duration: 0.5, ease: "power3.out" }));
          const drive = car ? gsap.quickTo(car, "x", { duration: 1.4, ease: "power2.out" }) : null;
          const onMove = (e: PointerEvent) => {
            if (e.pointerType !== "mouse") return;
            letters.forEach((l, i) => {
              const r = l.getBoundingClientRect();
              const d = Math.abs(e.clientX - (r.left + r.width / 2));
              lift[i]!(d < 160 ? -14 * (1 - d / 160) : 0);
            });
            drive?.(e.clientX - 40);
          };
          const onLeave = () => lift.forEach((f) => f(0));
          word.parentElement!.addEventListener("pointermove", onMove, { passive: true });
          word.parentElement!.addEventListener("pointerleave", onLeave);
        }
        // Lane dashes run faster while the visitor scrolls, then settle back to cruising speed.
        const dashes = gsap.utils.toArray<HTMLElement>(".finale .lane-dashes");
        const tween = gsap.to(dashes, { backgroundPositionX: "-=320px", duration: 2.8, ease: "none", repeat: -1 });
        ScrollTrigger.create({
          trigger: ".finale",
          start: "top bottom",
          end: "bottom top",
          onUpdate: (self) => {
            const v = Math.min(Math.abs(self.getVelocity()) / 600, 4);
            gsap.to(tween, { timeScale: 1 + v, duration: 0.3, overwrite: true });
          },
          onToggle: (self) => (self.isActive ? tween.play() : tween.pause()),
        });
      });
    },
    { scope: root },
  );

  return (
    <footer className="site-footer" ref={root}>
      <div className="finale">
        <div className="finale-gantry" aria-hidden="true">
          <span className="finale-beam" />
        </div>
        <div className="finale-sign">
          <span className="finale-tab">Exit</span>
          <LogoMark size={88} idle />
          <div>
            <p className="finale-legend">Fork in the Bill</p>
            <p className="finale-sub">Two lanes, one bill, a rule fixed before the first task.</p>
            <div className="finale-actions">
              <Link to="/live" className="btn btn-sheet">
                Watch the live board
              </Link>
              <button
                type="button"
                className="btn btn-ghost-sheet"
                onClick={() => {
                  travelTo(0);
                  document.getElementById("main")?.focus({ preventScroll: true });
                }}
              >
                Back to the start <span aria-hidden="true">↑</span>
              </button>
            </div>
          </div>
        </div>
        <div className="finale-road" aria-hidden="true">
          <div className="lane-dashes" />
          <span className="finale-car" dangerouslySetInnerHTML={{ __html: `<svg viewBox="-50 -30 100 60" width="76" height="46"><g transform="rotate(90)">${carMarkup("sedan", "sheet")}</g></svg>` }} />
        </div>
        <p className="finale-word">
          <span className="sr-only">Fork in the Bill</span>
          {WORD.split(" ").map((w, wi) => (
            <span className="fw-word" key={wi} aria-hidden="true">
              {[...w].map((c, ci) => (
                <span className="fw-mask" key={ci}>
                  <span className="fw-ch">{c}</span>
                </span>
              ))}
            </span>
          ))}
        </p>
        <div className="finale-road is-edge" aria-hidden="true">
          <div className="lane-dashes" />
        </div>
      </div>

      <div className="footer-body">
        <div className="footer-cols">
          {MENU_GROUPS.map((g) => (
            <nav key={g.key} aria-label={g.title}>
              <p className="footer-h">{g.title}</p>
              <ul>
                {ROUTES.filter((r) => r.menu === g.key).map((r) => (
                  <li key={r.path}>
                    <Link to={r.path}>{r.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
          <nav aria-label="Source">
            <p className="footer-h">Source</p>
            <ul>
              <li>
                <a href={repo.site.repo} rel="noopener">
                  GitHub repository
                </a>
              </li>
              {repo.paper?.hasPdf && (
                <li>
                  <a href="/downloads/fork-in-the-bill-paper.pdf">The paper (PDF)</a>
                </li>
              )}
              {repo.paper?.hasDeck && (
                <li>
                  <a href="/downloads/fork-in-the-bill-deck.pdf">The deck (PDF)</a>
                </li>
              )}
              {repo.releaseTag && (
                <li>
                  <a href={`${repo.site.repo}/releases/tag/${repo.releaseTag}`} rel="noopener">
                    Release {repo.releaseTag}
                  </a>
                </li>
              )}
              <li>
                <a href={ghFile(prereg?.file ?? "prereg/experiment-1.md")} rel="noopener">
                  Pre-registration
                </a>
              </li>
              <li>
                <a href={ghFile("DECISIONS.md")} rel="noopener">
                  DECISIONS.md
                </a>
              </li>
              <li>
                <a href={ghFile("LICENSE")} rel="noopener">
                  MIT licence
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <div className="footer-booth">
          <p className="footer-h">Updates window</p>
          <BoothLineForm source="footer" />
        </div>
        <div className="footer-meta">
          <StatusLine />
          <p>
            Made for the Toggle Wars hackathon, Track 01: Test Something Real.{" "}
            {repo.site.commit && (
              <>
                Build{" "}
                <a href={`${repo.site.repo}/commit/${repo.site.commit}`} rel="noopener">
                  <code>{repo.site.commitShort}</code>
                </a>
                .
              </>
            )}
          </p>
        </div>
      </div>
    </footer>
  );
}
