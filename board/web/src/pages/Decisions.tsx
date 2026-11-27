import { useMemo, useRef, useState } from "react";
import { Blocks, PageHead, useReveals } from "../site/ui";
import { routeFor } from "../site/routes";
import { ghFile, repo, type Block } from "../site/data";

// DECISIONS.md, quoted in full. The index is one large guide sign, each decision a destination on
// it; a search box narrows both the sign and the list. Every decision keeps its #d<n> anchor.

const list = repo.decisionsLog;

function textOf(blocks: Block[]): string {
  return blocks
    .map((b) => (b.type === "p" ? b.text : b.type === "list" ? b.items.join(" ") : [...b.head, ...b.rows.flat()].join(" ")))
    .join(" ")
    .toLowerCase();
}
const HAY = list.map((d) => `${d.id} ${d.title} ${textOf(d.blocks)}`.toLowerCase());

export default function Decisions() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return list.map((_, i) => words.every((w) => HAY[i]!.includes(w)));
  }, [q]);
  const n = shown.filter(Boolean).length;
  return (
    <div className="page-wrap dec-page" ref={root}>
      <PageHead
        route={routeFor("/decisions")}
        lead={
          <>
            Every choice made while building and running the experiments, with the reason. Quoted in full from <a href={ghFile("DECISIONS.md")}>DECISIONS.md</a>.
          </>
        }
      />
      <div className="dec-layout">
        <aside className="dec-side">
          <div className="dec-find">
            <label htmlFor="dec-q">Find a decision</label>
            <input id="dec-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="margin, flush, prompt…" autoComplete="off" spellCheck={false} />
            <p role="status">{q ? `${n} of ${list.length} match` : `${list.length} decisions, in the order they were made`}</p>
          </div>
          <nav className="dec-sign" id="index" aria-label="Decisions index">
            <span className="ph-tab">All exits</span>
            <ol>
              {list.map((d, i) => (
                <li key={d.id} hidden={!shown[i]}>
                  <a href={`#${d.id.toLowerCase()}`}>
                    <span className="dec-no">{d.id}</span>
                    <span className="dec-title">{d.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
        <div className="dec-list">
          {list.map((d, i) => (
            <article key={d.id} id={d.id.toLowerCase()} className="dec" aria-labelledby={`${d.id}-h`} hidden={!shown[i]}>
              <span className="dec-post" aria-hidden="true">
                {d.id}
              </span>
              <h2 id={`${d.id}-h`}>{d.title}</h2>
              <Blocks blocks={d.blocks} />
              <a className="dec-top" href="#index">
                Back to the index <span aria-hidden="true">↑</span>
              </a>
            </article>
          ))}
          {n === 0 && <p className="dec-none">No decision mentions that. Try one word, or clear the box.</p>}
        </div>
      </div>
    </div>
  );
}
