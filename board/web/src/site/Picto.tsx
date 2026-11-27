import type { ReactNode } from "react";

// One pictogram per page sign, drawn like the symbols on real guide signs: white line work,
// a yellow accent where something moves or is checked.

const P: Record<string, ReactNode> = {
  // the harness in plan view: a planner lane and a worker lane side by side, a ramp between them
  "/how-it-works": (
    <>
      <path d="M22 112 V8 M98 112 V8" />
      <path d="M60 112 V96 M60 84 V68 M60 56 V40 M60 28 V12" />
      <path className="pa" d="M40 96 C40 74 80 70 80 46" />
      <path className="pa" d="M70 50 L80 40 L90 50" />
    </>
  ),
  // the Flagsmith gantry over the fork: one road in, two lanes out
  "/why-flagsmith": (
    <>
      <path d="M10 22 H110 M24 22 V36 M96 22 V36" />
      <rect x="38" y="30" width="44" height="16" rx="3" className="paf" />
      <path d="M60 112 V80 C60 64 36 66 36 52 M60 80 C60 64 84 66 84 52" />
    </>
  ),
  // the registration: a hash plate, sealed with a round stamp
  "/method": (
    <>
      <rect x="14" y="20" width="80" height="62" rx="6" />
      <path d="M30 40 H62 M30 54 H74 M30 68 H54" />
      <circle className="paf" cx="86" cy="84" r="24" />
      <path className="pk" d="M75 84 L83 92 L98 76" />
    </>
  ),
  // results pending: a work-zone diamond with the barricade stripes
  "/results": (
    <>
      <rect x="27" y="27" width="66" height="66" rx="6" transform="rotate(45 60 60)" />
      <path className="pa" d="M44 76 L76 44 M52 84 L84 52 M36 68 L68 36" />
    </>
  ),
  // a feature flag as a lane-use signal: the head on its gantry arm, the arrow lit
  "/flagsmith": (
    <>
      <path d="M14 14 H106 M60 14 V28" />
      <rect x="32" y="28" width="56" height="56" rx="8" />
      <path className="pa" d="M60 40 V70 M48 58 L60 70 L72 58" />
      <path d="M60 84 V112" />
    </>
  ),
  // the receipt coming out of its printer slot
  "/proof": (
    <>
      <rect x="12" y="10" width="96" height="16" rx="5" className="pf" />
      <path d="M28 26 V104 L36 112 L44 104 L52 112 L60 104 L68 112 L76 104 L84 112 L92 104 V26" />
      <path d="M40 44 H80 M40 58 H80 M40 72 H64" />
      <path className="pa" d="M40 88 H80" />
    </>
  ),
  // your agent joins the road: an on-ramp merging into the main lane
  "/kit": (
    <>
      <path d="M76 112 V10" />
      <path d="M100 112 V10" />
      <path className="pa" d="M22 112 C22 78 56 70 72 46" />
      <path className="pa" d="M58 48 L74 42 L76 58" />
    </>
  ),
  // the road as a timeline: kilometre plates along the edge line
  "/timeline": (
    <>
      <path d="M38 112 V8" />
      <path d="M38 100 H58 M38 64 H58 M38 28 H58" />
      <rect x="58" y="16" width="44" height="24" rx="4" className="paf" />
      <rect x="58" y="52" width="44" height="24" rx="4" />
      <rect x="58" y="88" width="44" height="24" rx="4" />
    </>
  ),
  // the decision log: numbered index plates stacked on one post
  "/decisions": (
    <>
      <path d="M24 112 V8" />
      <rect x="24" y="12" width="78" height="26" rx="4" />
      <rect x="24" y="46" width="78" height="26" rx="4" />
      <rect x="24" y="80" width="78" height="26" rx="4" />
      <path className="pa" d="M36 25 H44 M36 59 H44 M36 93 H44" />
      <path d="M56 25 H90 M56 59 H82 M56 93 H88" />
    </>
  ),
  // a lettered milepost
  "/glossary": (
    <>
      <path d="M60 112 V92" />
      <rect x="30" y="10" width="60" height="82" rx="8" />
      <path d="M42 60 L60 22 L78 60 M48 48 H72" />
      <path className="pa" d="M44 76 H76" />
    </>
  ),
};

export function Picto({ path }: { path: string }) {
  const art = P[path];
  if (!art) return null;
  return (
    <svg className="ph-picto" viewBox="0 0 120 120" aria-hidden="true">
      {art}
    </svg>
  );
}
