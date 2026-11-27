import { repo } from "./data";

// One roadside prop under each page sign, so every page opens on its own piece of the road.
// Anything written on a prop is read from the repo at build time.

const preregSha = repo.hashes.find((h) => h.file === "prereg/experiment-1.md")?.sha256 ?? "";

function Cones() {
  return (
    <svg viewBox="0 0 600 64" className="pp-svg" aria-hidden="true">
      <rect x="150" y="10" width="300" height="20" rx="3" className="pp-stripe-ground" />
      <path d={Array.from({ length: 12 }, (_, i) => `M${158 + i * 26} 30 L${172 + i * 26} 10 L${182 + i * 26} 10 L${168 + i * 26} 30 Z`).join(" ")} className="pp-stripe" />
      <path d="M170 30 V58 M430 30 V58" className="pp-leg" />
      {[60, 100, 500, 540].map((x) => (
        <g key={x} transform={`translate(${x} 0)`}>
          <path d="M-14 58 L-4 16 H4 L14 58 Z" className="pp-cone" />
          <path d="M-9 38 H9 L10.5 46 H-10.5 Z" className="pp-band" />
          <rect x="-18" y="56" width="36" height="6" rx="2" className="pp-cone" />
        </g>
      ))}
    </svg>
  );
}

export function PageProp({ path }: { path: string }) {
  switch (path) {
    case "/results":
      return (
        <div className="page-prop pp-results">
          <Cones />
        </div>
      );
    case "/proof":
      // the receipt tongue: the registered hash, printed in full
      return (
        <div className="page-prop pp-proof">
          <div className="pp-receipt">
            <span>Pre-reg sha256</span>
            <code>{preregSha}</code>
          </div>
        </div>
      );
    case "/method":
      return (
        <div className="page-prop pp-method">
          <div className="pp-stamp">
            <b>Registered</b>
            <code>{preregSha.slice(0, 8)}</code>
          </div>
        </div>
      );
    case "/timeline": {
      // one lane-use signal per phase, lit by the phase's status in PROGRESS.md
      const phases = repo.progress.phases;
      return (
        <div className="page-prop pp-timeline" aria-hidden="true">
          {phases.map((p) => {
            const s = /done/i.test(p.status) ? "is-done" : /progress|running/i.test(p.status) ? "is-now" : "is-wait";
            return (
              <span key={p.n} className={`pp-sig ${s}`} title={`${p.n}. ${p.phase}: ${p.status}`}>
                <svg viewBox="0 0 40 40">
                  {s === "is-done" ? <path d="M20 8 V28 M11 20 L20 30 L29 20" /> : s === "is-now" ? <path d="M12 12 L28 28 M28 14 V28 H14" /> : <path d="M11 11 L29 29 M29 11 L11 29" />}
                </svg>
                <i>{p.n}</i>
              </span>
            );
          })}
        </div>
      );
    }
    default:
      return null;
  }
}
