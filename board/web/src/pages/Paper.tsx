import { useRef } from "react";
import { Blocks, Kinetic, PageHead, useReveals } from "../site/ui";
import { Link } from "../site/router";
import { routeFor } from "../site/routes";
import { ghFile, repo } from "../site/data";

// The paper and the deck. The summary, the limits and the conclusion are read from docs/paper.md
// when the site is built; the figures are the analysis charts; the PDFs are copied into the site.

const P = repo.paper;
const kb = (bytes: number) => `${Math.round(bytes / 1024).toLocaleString("en-US")} KB`;

function Download({ href, title, meta, kind }: { href: string; title: string; meta: string; kind: "paper" | "deck" }) {
  return (
    <a className={`dl-card is-${kind}`} href={href} download data-cursor="save">
      <svg viewBox="0 0 80 100" aria-hidden="true" className="dl-art">
        {kind === "paper" ? (
          <>
            <path d="M8 4 H52 L72 24 V96 H8 Z" />
            <path d="M52 4 V24 H72" />
            <path d="M20 40 H60 M20 52 H60 M20 64 H46" />
          </>
        ) : (
          <>
            <rect x="6" y="18" width="68" height="46" rx="4" />
            <path d="M40 64 V82 M26 90 L40 82 L54 90" />
            <path d="M18 52 V40 M30 52 V32 M42 52 V44 M54 52 V28" className="is-accent" />
          </>
        )}
      </svg>
      <span className="dl-text">
        <b>{title}</b>
        <small>{meta}</small>
      </span>
      <span className="dl-go" aria-hidden="true">
        ↓
      </span>
    </a>
  );
}

export default function Paper() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  if (!P) {
    return (
      <div className="page-wrap paper-page" ref={root}>
        <PageHead route={routeFor("/paper")} lead={<>The write-up is not in this build yet.</>} />
      </div>
    );
  }
  return (
    <div className="page-wrap paper-page" ref={root}>
      <PageHead route={routeFor("/paper")} lead={<>Experiment 1, written up twice: a paper to read and a deck to present. Read the short version here or take the PDFs.</>}>
        <div className="dl-row">
          {P.hasPdf && <Download href="/downloads/fork-in-the-bill-paper.pdf" title="The paper" meta={`PDF, ${kb(P.pdfBytes)}`} kind="paper" />}
          {P.hasDeck && <Download href="/downloads/fork-in-the-bill-deck.pdf" title="The deck" meta={`PDF, ${kb(P.deckBytes)}`} kind="deck" />}
        </div>
      </PageHead>

      <article className="paper-sheet" aria-labelledby="paper-title">
        <header className="paper-head">
          <p className="paper-kicker">Abstract</p>
          <Kinetic id="paper-title" text={P.title} />
        </header>
        <div className="paper-cols">
          <Blocks blocks={P.abstract} base="" className="prose paper-abstract" />
          <aside className="paper-toc" aria-label="Sections of the paper">
            <p>In the paper</p>
            <ol>
              {P.sections.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <a href={ghFile("docs/paper.md")}>Read the source on GitHub ↗</a>
          </aside>
        </div>
      </article>

      {P.figures.length > 0 && (
        <section className="paper-figs" aria-labelledby="figs-h">
          <div className="x2-copy wide">
            <p className="eyebrow-sign">Figures</p>
            <Kinetic id="figs-h" text="The figures, as the analysis drew them" />
            <p>
              Made by <a href={ghFile("analysis/charts.py")}>analysis/charts.py</a> from the run's own records. Nothing is redrawn for the site.
            </p>
          </div>
          <div className="fig-rail" tabIndex={0} role="region" aria-label="Figures from the paper, scroll sideways" data-cursor="drag">
            {P.figures.map((f, i) => (
              <figure key={f.file} className="fig">
                <span className="fig-n" aria-hidden="true">
                  Fig {i + 1}
                </span>
                <img src={`/figures/${f.file}`} alt={f.caption} loading="lazy" />
                <figcaption>{f.caption}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className="paper-two" aria-labelledby="limits-h">
        <div>
          <p className="eyebrow-sign">Limits</p>
          <Kinetic id="limits-h" text="What the paper says it cannot claim" />
          <Blocks blocks={P.limits} base="" />
        </div>
        <div>
          <p className="eyebrow-sign">Conclusion</p>
          <h2 className="kinetic">In short</h2>
          <Blocks blocks={P.conclusion} base="" />
          <p className="doc-next">
            <Link to="/results" className="text-link">
              The results, figure by figure <span aria-hidden="true">→</span>
            </Link>
          </p>
        </div>
      </section>

      <section className="paper-rel" aria-label="Downloads and release">
        <div className="dl-row">
          {P.hasPdf && <Download href="/downloads/fork-in-the-bill-paper.pdf" title="Download the paper" meta={`PDF, ${kb(P.pdfBytes)}`} kind="paper" />}
          {P.hasDeck && <Download href="/downloads/fork-in-the-bill-deck.pdf" title="Download the deck" meta={`PDF, ${kb(P.deckBytes)}`} kind="deck" />}
        </div>
        {repo.releaseTag && (
          <p className="prose">
            The latest release is <a href={`${repo.site.repo}/releases/tag/${repo.releaseTag}`}>{repo.releaseTag}</a>, with the code and the run records. Every
            figure in the paper is filled from one JSON file and checked by a script.
          </p>
        )}
      </section>
    </div>
  );
}
