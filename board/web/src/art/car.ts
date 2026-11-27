// Plan-view vehicles for the junction, drawn like an engineering plate: flat sheeting colours,
// crisp panel lines, no gradients. The nose points to -y. Every vehicle carries an amber toll
// transponder behind the windscreen: each car is a task, and every task is billed.

export type CarKind = "sedan" | "hatch" | "van" | "estate";

export const CAR_KINDS: CarKind[] = ["sedan", "estate", "hatch", "sedan", "van", "hatch"];
export const CAR_TONES = ["sheet", "concrete", "steel", "sheet", "graphite", "concrete"] as const;

interface Spec {
  w: number;
  h: number;
  hood: number; // nose to windscreen
  screen: number; // windscreen depth
  roof: number; // roof length
  rear: number; // rear window depth
}

const SPECS: Record<CarKind, Spec> = {
  sedan: { w: 40, h: 72, hood: 17, screen: 11, roof: 19, rear: 8 },
  estate: { w: 40, h: 74, hood: 16, screen: 11, roof: 28, rear: 6 },
  hatch: { w: 38, h: 62, hood: 14, screen: 11, roof: 21, rear: 6 },
  van: { w: 42, h: 80, hood: 9, screen: 9, roof: 52, rear: 0 },
};

const f = (n: number) => +n.toFixed(1);

/** Body outline: a rounded box whose nose and tail are pulled in a little, like a real car seen from above. */
function bodyPath(w: number, h: number, pinch: number, r: number): string {
  const x = w / 2;
  const y = h / 2;
  return [
    `M${f(-x + pinch + r)} ${f(-y)}`,
    `L${f(x - pinch - r)} ${f(-y)}`,
    `Q${f(x - pinch)} ${f(-y)} ${f(x - pinch * 0.4)} ${f(-y + r)}`,
    `L${f(x)} ${f(-y + r * 2.2)}`,
    `L${f(x)} ${f(y - r * 2)}`,
    `L${f(x - pinch * 0.4)} ${f(y - r * 0.8)}`,
    `Q${f(x - pinch)} ${f(y)} ${f(x - pinch - r)} ${f(y)}`,
    `L${f(-x + pinch + r)} ${f(y)}`,
    `Q${f(-x + pinch)} ${f(y)} ${f(-x + pinch * 0.4)} ${f(y - r * 0.8)}`,
    `L${f(-x)} ${f(y - r * 2)}`,
    `L${f(-x)} ${f(-y + r * 2.2)}`,
    `L${f(-x + pinch * 0.4)} ${f(-y + r)}`,
    `Q${f(-x + pinch)} ${f(-y)} ${f(-x + pinch + r)} ${f(-y)}`,
    "Z",
  ].join(" ");
}

/** A trapezoid between two y values, `top` and `bottom` wide. */
function trap(y0: number, y1: number, top: number, bottom: number, r = 1.5): string {
  return `M${f(-top / 2 + r)} ${f(y0)} L${f(top / 2 - r)} ${f(y0)} L${f(bottom / 2)} ${f(y1)} L${f(-bottom / 2)} ${f(y1)} Z`;
}

/** SVG markup for one vehicle, centred on 0,0. Colours come from CSS classes, so tokens recolour it. */
export function carMarkup(kind: CarKind, tone: string): string {
  const s = SPECS[kind];
  const x = s.w / 2;
  const y = s.h / 2;
  const van = kind === "van";
  const top = -y;
  const screenTop = top + s.hood;
  const roofTop = screenTop + s.screen;
  const roofEnd = roofTop + s.roof;
  const rearEnd = roofEnd + s.rear;
  const cabinW = s.w - 8;
  const parts: string[] = [];
  // ground shadow: a flat offset plate, the sun high and to the left
  parts.push(`<path class="car-shadow" d="${bodyPath(s.w, s.h, van ? 1 : 3, van ? 4 : 6)}" transform="translate(3.5 4)"/>`);
  parts.push(`<path class="car-body tone-${tone}" d="${bodyPath(s.w, s.h, van ? 1 : 3, van ? 4 : 6)}"/>`);
  // wing mirrors at the windscreen pillars
  parts.push(`<rect class="car-body tone-${tone}" x="${f(-x - 4)}" y="${f(screenTop + 1)}" width="5" height="4" rx="1.5"/>`);
  parts.push(`<rect class="car-body tone-${tone}" x="${f(x - 1)}" y="${f(screenTop + 1)}" width="5" height="4" rx="1.5"/>`);
  // panel line around the cabin (doors and pillars)
  parts.push(`<rect class="car-line" x="${f(-x + 2.5)}" y="${f(screenTop - 1)}" width="${f(s.w - 5)}" height="${f(rearEnd - screenTop + 2 + (van ? 6 : 0))}" rx="4"/>`);
  if (!van) {
    // bonnet creases
    parts.push(`<path class="car-line" d="M${f(-x * 0.42)} ${f(top + 4)} L${f(-x * 0.5)} ${f(screenTop - 2)} M${f(x * 0.42)} ${f(top + 4)} L${f(x * 0.5)} ${f(screenTop - 2)}"/>`);
  }
  // glass: windscreen, side windows, rear window
  parts.push(`<path class="car-glass" d="${trap(screenTop, roofTop, cabinW - 8, cabinW)}"/>`);
  parts.push(`<rect class="car-glass" x="${f(-x + 2)}" y="${f(roofTop + 1)}" width="2.6" height="${f(s.roof - 2)}" rx="1"/>`);
  parts.push(`<rect class="car-glass" x="${f(x - 4.6)}" y="${f(roofTop + 1)}" width="2.6" height="${f(s.roof - 2)}" rx="1"/>`);
  parts.push(`<rect class="car-roof tone-${tone}" x="${f(-cabinW / 2 + 1.5)}" y="${f(roofTop)}" width="${f(cabinW - 3)}" height="${f(s.roof)}" rx="2.5"/>`);
  if (van) {
    // roof ribs on the load box
    for (let i = 1; i < 4; i++) {
      const yy = roofTop + (s.roof * i) / 4;
      parts.push(`<path class="car-line" d="M${f(-cabinW / 2 + 4)} ${f(yy)} L${f(cabinW / 2 - 4)} ${f(yy)}"/>`);
    }
  } else {
    parts.push(`<path class="car-glass" d="${trap(roofEnd, rearEnd, cabinW, cabinW - 6)}"/>`);
    parts.push(`<path class="car-line" d="M${f(-x * 0.55)} ${f(rearEnd + 3)} L${f(x * 0.55)} ${f(rearEnd + 3)}"/>`);
  }
  // toll transponder behind the windscreen: amber, the colour of money on this site
  parts.push(`<rect class="car-tag" x="-3.5" y="${f(screenTop + 3)}" width="7" height="3.6" rx="1"/>`);
  // head and tail lights
  parts.push(`<path class="car-head" d="M${f(-x + 3)} ${f(top + 2.5)} l7 -1.2 l0.6 3.4 l-7.4 1.3 Z M${f(x - 3)} ${f(top + 2.5)} l-7 -1.2 l-0.6 3.4 l7.4 1.3 Z"/>`);
  parts.push(`<rect class="car-tail" x="${f(-x + 2)}" y="${f(y - 4.5)}" width="8" height="3.2" rx="1"/>`);
  parts.push(`<rect class="car-tail" x="${f(x - 10)}" y="${f(y - 4.5)}" width="8" height="3.2" rx="1"/>`);
  return parts.join("");
}

/** The length of a vehicle along the road, for spacing. */
export function carLength(kind: CarKind): number {
  return SPECS[kind].h;
}
