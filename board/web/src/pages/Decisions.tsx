import { DocPage } from "../site/DocPage";
import { Blocks } from "../site/ui";
import { ghFile, repo } from "../site/data";

export default function Decisions() {
  const list = repo.decisionsLog;
  return (
    <DocPage
      path="/decisions"
      lead={
        <>
          Every choice made while building and running the experiments, with the reason. Quoted in full from <a href={ghFile("DECISIONS.md")}>DECISIONS.md</a>.
        </>
      }
    >
      <nav className="dec-index" id="index" aria-label="Decisions index">
        <ol data-reveal="row">
          {list.map((d) => (
            <li key={d.id}>
              <a href={`#${d.id.toLowerCase()}`}>
                <span className="dec-id">{d.id}</span>
                <span className="dec-title">{d.title}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="dec-list">
        {list.map((d) => (
          <article key={d.id} id={d.id.toLowerCase()} className="dec" aria-labelledby={`${d.id}-h`}>
            <h2 id={`${d.id}-h`}>
              <span className="dec-id">{d.id}</span> {d.title}
            </h2>
            <Blocks blocks={d.blocks} />
            <a className="dec-top" href="#index">
              Back to the index <span aria-hidden="true">↑</span>
            </a>
          </article>
        ))}
      </div>
    </DocPage>
  );
}
