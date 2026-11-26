import type { Fmt } from "./types";

// Display formats for figures from numbers.json. Keep these identical to
// analysis/render_docs.py so analysis/check_consistency.py can compare them.
const MINUS = "−";

const sign = (v: number) => (v < 0 ? MINUS : v > 0 ? "+" : "");

/** toFixed with comma thousands separators; the same rounding as analysis/render_docs.py. */
function grouped(x: number, places: number): string {
  const [whole = "", frac] = x.toFixed(places).split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === undefined ? withCommas : `${withCommas}.${frac}`;
}

export function format(value: number | string, fmt: Fmt): string {
  if (fmt === "hash12") return String(value).slice(0, 12);
  const v = Number(value);
  switch (fmt) {
    case "usd2":
      return `${v < 0 ? MINUS : ""}$${grouped(Math.abs(v), 2)}`;
    case "usd4":
      return `${v < 0 ? MINUS : ""}$${Math.abs(v).toFixed(4)}`;
    case "pct1":
      return `${sign(v)}${Math.abs(v).toFixed(1)}%`;
    case "pp1":
      return `${sign(v)}${Math.abs(v).toFixed(1)} pp`;
    case "int":
      return Math.round(v).toLocaleString("en-US");
    case "f3":
      return `${v < 0 ? MINUS : ""}${Math.abs(v).toFixed(3)}`;
    case "prob1":
      return `${v < 0 ? MINUS : ""}${Math.abs(v * 100).toFixed(1)}%`;
  }
}

/** Live meter money: two decimals with thousands separators. */
export function money(v: number): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
