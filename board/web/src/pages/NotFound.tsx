import { useEffect, useRef, useState } from "react";
import { Link } from "../site/router";
import { ROUTES } from "../site/routes";
import { Led } from "../led/Led";
import { useReveals } from "../site/ui";

export default function NotFound() {
  const root = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState("");
  useEffect(() => setPath(window.location.pathname), []);
  useReveals(root);
  return (
    <div className="page-wrap nf" ref={root}>
      <div className="nf-scene">
        <div className="nf-vms">
          <Led text="WRONG EXIT" cols={70} align="center" scan label="Wrong exit" />
        </div>
        <div className="nf-board" data-reveal="hang">
          <span className="nf-tab">404</span>
          <h1>Wrong exit</h1>
          <p>
            There is no page at <code>{path || "this address"}</code>. The road is closed here, but every exit below is open.
          </p>
          <div className="cta-row">
            <Link to="/" className="btn btn-dark">
              Back to the junction
            </Link>
            <Link to="/live" className="btn btn-line">
              Watch the live board
            </Link>
          </div>
        </div>
        <div className="nf-barrier" aria-hidden="true" />
      </div>
      <nav aria-label="All pages" className="nf-exits">
        <h2>Open exits</h2>
        <ul data-reveal="row">
          {ROUTES.filter((r) => r.path !== "/").map((r) => (
            <li key={r.path}>
              <Link to={r.path}>
                <span className="exit-no">{r.exit}</span> {r.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
