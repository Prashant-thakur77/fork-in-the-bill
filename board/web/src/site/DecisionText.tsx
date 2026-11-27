import { Link } from "./router";
import { Blocks } from "./ui";
import { repo } from "./data";

/** One entry of DECISIONS.md, quoted in full with a link to its place in the index. */
export function DecisionText({ id }: { id: string }) {
  const d = repo.decisionsLog.find((x) => x.id === id);
  if (!d) return null;
  return (
    <div className="quote-block">
      <p className="quote-src">
        <Link to={`/decisions#${id.toLowerCase()}`}>
          {d.id}. {d.title}
        </Link>
      </p>
      <Blocks blocks={d.blocks} />
    </div>
  );
}
