import { useRef } from "react";
import { Kinetic, PageHead, useReveals } from "../site/ui";
import { Link } from "../site/router";
import { routeFor } from "../site/routes";
import { ghFile, repo } from "../site/data";
import { batchOf } from "../site/batches";
import { Booth } from "../site/Booth";

// The updates list: what a person gets, the window where they ask for it, and exactly what is kept.

const exp2 = batchOf("exp2");
const tsName = repo.kit.ts?.name ?? "the TypeScript kit";

export default function Updates() {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  return (
    <div className="page-wrap updates-page" ref={root}>
      <PageHead
        route={routeFor("/updates")}
        lead={
          <>
            {exp2?.state === "open" ? "Experiment 2 is still running. " : ""}Leave an address and you get one email when its write-up is published, and one when the kit is
            on npm, if you ask for that too. Nothing else is sent.
          </>
        }
      />

      <section className="up-main" aria-label="Join the updates list">
        <div className="up-booth">
          <Booth source="/updates" />
        </div>
        <aside className="up-what" aria-labelledby="up-what-h">
          <Kinetic id="up-what-h" text="What you will get" />
          <ol className="up-items" data-reveal="row">
            <li>
              <span className="up-tab">One email</span>
              <b>The experiment 2 write-up</b>
              <p>
                Whether <code>lanes_v2</code> shipped or <code>lanes_v1</code> stayed, with the same tables as experiment 1. It is sent after the run ends and the
                analysis has been checked. <Link to="/experiment-2">What experiment 2 tests</Link>.
              </p>
            </li>
            <li>
              <span className="up-tab">One email</span>
              <b>A note when the kit is on npm</b>
              <p>
                Today <code>{tsName}</code> is{repo.kit.ts?.published ? " published" : " built from the repository"}. The note says where to install it from and what
                changed. <Link to="/use-it">Use it from the repository now</Link>.
              </p>
            </li>
          </ol>
          <p className="up-not">No newsletter, no product announcements, no passing the list to anyone.</p>
        </aside>
      </section>

      <section className="up-privacy" id="privacy" aria-labelledby="privacy-h">
        <h2 id="privacy-h">What is stored, and how to be removed</h2>
        <p>
          The form stores the email address you type, your answer to "what should we send you", what you run your agent on if you chose to say (at most 200
          characters), the time, and the path of the page the form was on. That is everything in the row. It is kept so those one or two emails can be sent, and
          for nothing else. Your network address is not stored: to slow down scripts, a salted hash of it that changes every day is kept for one hour and then
          deleted. No page or API on this site can read the list back; the only thing published is a count, and only once the list has at least ten people on it.
          To be taken off the list, open an issue on the <a href={`${repo.site.repo}/issues`}>repository's issue tracker</a> asking for removal. The code that does
          all of this is in <a href={ghFile("board/worker/src/waitlist.ts")}>board/worker/src/waitlist.ts</a>.
        </p>
      </section>
    </div>
  );
}
