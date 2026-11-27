import { useRef, type ReactNode } from "react";
import { OnThisPage, PageHead, useReveals } from "./ui";
import { routeFor } from "./routes";

/** A content page: the page sign, an optional "On this page" list, then the sections. */
export function DocPage({ path, lead, toc, headExtra, children }: { path: string; lead: ReactNode; toc?: { id: string; label: string }[]; headExtra?: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useReveals(root);
  return (
    <div className="page-wrap" ref={root}>
      <PageHead route={routeFor(path)} lead={lead}>
        {headExtra}
      </PageHead>
      {toc ? (
        <div className="doc">
          <OnThisPage items={toc} />
          <div className="doc-body">{children}</div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
