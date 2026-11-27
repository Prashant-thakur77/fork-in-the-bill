import type { ReactNode } from "react";

// One pictogram per page sign, drawn like the symbols on real guide signs: white line work,
// a yellow accent where something moves or is checked.

const P: Record<string, ReactNode> = {
  "/how-it-works": (
    <>
      <path d="M12 34 H108 M12 86 H108" />
      <path className="pa" d="M40 34 C60 34 52 86 72 86" />
      <path d="M86 26 L98 34 L86 42" />
    </>
  ),
  "/why-flagsmith": (
    <>
      <path d="M10 22 H110 M24 22 V36 M96 22 V36" />
      <rect x="38" y="30" width="44" height="16" rx="3" className="paf" />
      <path d="M60 112 V80 C60 64 36 66 36 52 M60 80 C60 64 84 66 84 52" />
    </>
  ),
  "/method": (
    <>
      <rect x="28" y="14" width="64" height="92" rx="6" />
      <path d="M44 14 V8 H76 V14" />
      <path className="pa" d="M42 44 L50 52 L64 36 M42 76 L50 84 L64 68" />
      <path d="M70 48 H82 M70 80 H82" />
    </>
  ),
  "/results": (
    <>
      <rect x="27" y="27" width="66" height="66" rx="6" transform="rotate(45 60 60)" />
      <path className="pa" d="M44 76 L76 44 M52 84 L84 52 M36 68 L68 36" />
    </>
  ),
  "/flagsmith": (
    <>
      <path d="M32 112 V12" />
      <path className="pa" d="M32 16 H92 L80 34 L92 52 H32" />
    </>
  ),
  "/proof": (
    <>
      <path d="M30 8 H90 V104 L80 112 L70 104 L60 112 L50 104 L40 112 L30 104 Z" />
      <path d="M42 30 H78 M42 46 H78 M42 62 H66" />
      <path className="pa" d="M42 82 H78" />
    </>
  ),
  "/kit": (
    <>
      <rect x="14" y="48" width="92" height="56" rx="6" />
      <path d="M44 48 V34 H76 V48 M14 70 H106" />
      <path className="pa" d="M54 64 V78 M66 64 V78" />
    </>
  ),
  "/timeline": (
    <>
      <path d="M60 112 V54" />
      <rect x="34" y="12" width="52" height="40" rx="5" />
      <path className="pa" d="M46 32 H74" />
    </>
  ),
  "/decisions": (
    <>
      <path d="M60 112 V12" />
      <path d="M60 22 H98 L110 34 L98 46 H60" />
      <path className="pa" d="M60 58 H22 L10 70 L22 82 H60" />
    </>
  ),
  "/glossary": (
    <>
      <rect x="16" y="16" width="88" height="88" rx="10" />
      <path d="M38 88 L60 30 L82 88 M46 68 H74" />
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
