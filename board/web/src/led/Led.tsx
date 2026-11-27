import { useEffect, useRef } from "react";
import { GLYPH_ROWS, rasterize } from "./font";
import { prefersReducedMotion } from "../motion";

interface Props {
  text: string;
  /** Panel width in dot columns; the text is placed inside it. */
  cols: number;
  align?: "left" | "right" | "center";
  /** Row-scan the panel when the text changes (signs that switch messages). */
  scan?: boolean;
  /** Accessible reading of the panel; defaults to the text. */
  label?: string;
  className?: string;
  tone?: "amber" | "green" | "red";
}

const ROW_SCAN_MS = 18;
const PAD = 1; // blank dot rows/cols around the text

const TONES = {
  amber: { on: "#FFB21A", glow: "rgba(255,178,26,0.28)", off: "rgba(255,178,26,0.09)" },
  green: { on: "#3BD67A", glow: "rgba(59,214,122,0.26)", off: "rgba(59,214,122,0.08)" },
  red: { on: "#FF4A3D", glow: "rgba(255,74,61,0.26)", off: "rgba(255,74,61,0.08)" },
};

/** An LED matrix sign: unlit dots stay visible, lit dots carry the text. */
export function Led({ text, cols, align = "right", scan = false, label, className, tone = "amber" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ revealRows: GLYPH_ROWS + 2 * PAD, prev: "", raf: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = state.current;
    const rows = GLYPH_ROWS + 2 * PAD;
    const colors = TONES[tone];

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pitch = rect.width / cols;
      const h = pitch * rows;
      const W = Math.round(rect.width * dpr);
      const H = Math.round(h * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, h);
      const bitmap = rasterize(text);
      const inner = cols - 2 * PAD;
      const tw = Math.min(bitmap.length, inner);
      const start =
        PAD + (align === "left" ? 0 : align === "center" ? Math.floor((inner - tw) / 2) : inner - tw);
      const r = pitch * 0.36;
      for (let x = 0; x < cols; x++) {
        const col = bitmap[x - start];
        for (let y = 0; y < rows; y++) {
          const lit = !!col && y >= PAD && y < rows - PAD && col[y - PAD] && y < s.revealRows;
          const cx = (x + 0.5) * pitch;
          const cy = (y + 0.5) * pitch;
          if (lit) {
            ctx.fillStyle = colors.glow;
            ctx.beginPath();
            ctx.arc(cx, cy, r * 1.9, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = colors.on;
          } else {
            ctx.fillStyle = colors.off;
          }
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    cancelAnimationFrame(s.raf);
    const changed = s.prev !== text;
    const firstPaint = s.prev === "";
    s.prev = text;
    if ((scan || firstPaint) && changed && !prefersReducedMotion()) {
      const t0 = performance.now();
      const step = (t: number) => {
        s.revealRows = Math.floor((t - t0) / ROW_SCAN_MS);
        draw();
        if (s.revealRows < rows) s.raf = requestAnimationFrame(step);
      };
      s.revealRows = 0;
      s.raf = requestAnimationFrame(step);
    } else {
      s.revealRows = rows;
      draw();
    }

    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(s.raf);
    };
  }, [text, cols, align, scan, tone]);

  return (
    <span className={`led ${className ?? ""}`}>
      <canvas ref={canvasRef} aria-hidden="true" style={{ aspectRatio: `${cols} / ${GLYPH_ROWS + 2 * PAD}` }} />
      <span className="led-fallback" aria-hidden="true">
        {text}
      </span>
      <span className="sr-only">{label ?? text}</span>
    </span>
  );
}
