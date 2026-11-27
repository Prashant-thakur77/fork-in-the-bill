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
  // two lanes with one job each: the left lane reads (an eye), the right lane writes (a pencil)
  "/experiment-2": (
    <>
      <path d="M60 114 V88 C60 72 32 74 32 58 V10 M60 88 C60 72 88 74 88 58 V10" />
      <path d="M16 36 C24 24 40 24 48 36 C40 48 24 48 16 36 Z" />
      <circle cx="32" cy="36" r="5" />
      <path className="pa" d="M76 44 L98 22 L106 30 L84 52 L74 54 Z" />
    </>
  ),
  // one lane closed with an X, traffic merging into the other
  "/rollout": (
    <>
      <path d="M40 114 V74 C40 54 62 54 62 34 V8" />
      <path d="M84 114 V92" />
      <path className="pa" d="M72 62 L96 86 M96 62 L72 86" />
      <path d="M52 20 L62 8 L72 20" />
    </>
  ),
  // a printed page with a small chart on it
  "/paper": (
    <>
      <path d="M26 10 H78 L96 28 V110 H26 Z" />
      <path d="M78 10 V28 H96" />
      <path d="M40 46 H82 M40 60 H70" />
      <path className="paf" d="M40 98 V82 H50 V98 Z M56 98 V74 H66 V98 Z M72 98 V88 H82 V98 Z" />
    </>
  ),
  // three records linked in a chain, the last one checked
  "/verify": (
    <>
      <rect x="10" y="20" width="34" height="24" rx="6" />
      <rect x="43" y="48" width="34" height="24" rx="6" />
      <path d="M34 44 V60 H43 M67 72 V86 H74" />
      <circle className="paf" cx="88" cy="88" r="22" />
      <path className="pk" d="M78 88 L86 96 L99 80" />
    </>
  ),
  // a warning diamond with a question on it
  "/faq": (
    <>
      <path d="M60 8 L112 60 L60 112 L8 60 Z" />
      <path className="pa" d="M46 46 C46 30 74 30 74 46 C74 58 60 56 60 70" />
      <circle className="paf" cx="60" cy="86" r="5" />
    </>
  ),
  // an on-ramp joining the road
  "/use-it": (
    <>
      <path d="M78 114 V8 M54 12 V26 M54 38 V52" />
      <path className="pa" d="M22 114 V86 C22 62 54 66 54 44" />
      <path className="pa" d="M44 52 L54 40 L64 52" />
    </>
  ),
  // a toll ticket, torn off at the perforation
  "/updates": (
    <>
      <path d="M26 10 H94 V98 L85 108 L77 98 L68 108 L60 98 L52 108 L43 98 L35 108 L26 98 Z" />
      <path d="M40 30 H80 M40 46 H66" />
      <path className="pa" d="M40 66 L60 80 L80 66" />
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
