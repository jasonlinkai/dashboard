import { useEffect, useRef, useState } from "react";

const RUN_MS = 20_000;

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** One soft light: colour, size (share of the screen) and its own slow path. */
interface Blob {
  color: (a: number) => string;
  r: number;
  sx: number;
  sy: number;
  px: number;
  py: number;
}
const rgba = (r: number, g: number, b: number) => (a: number) => `rgba(${r},${g},${b},${a})`;

// Aurora on the dark theme: lights add up where they meet.
const DARK: Blob[] = [
  { color: rgba(40, 200, 180), r: 0.55, sx: 0.23, sy: 0.17, px: 0, py: 1 }, // teal
  { color: rgba(110, 80, 230), r: 0.6, sx: 0.15, sy: 0.21, px: 2, py: 4 }, // violet
  { color: rgba(230, 70, 140), r: 0.45, sx: 0.19, sy: 0.13, px: 4, py: 2 }, // rose
  { color: rgba(242, 184, 75), r: 0.4, sx: 0.27, sy: 0.24, px: 1, py: 5 }, // the board's amber
  { color: rgba(60, 140, 240), r: 0.5, sx: 0.12, sy: 0.29, px: 5, py: 0 }, // sky
];
// Watercolour on the light theme: soft pastel washes that deepen where they overlap.
const LIGHT: Blob[] = [
  { color: rgba(120, 215, 200), r: 0.55, sx: 0.23, sy: 0.17, px: 0, py: 1 },
  { color: rgba(175, 160, 245), r: 0.6, sx: 0.15, sy: 0.21, px: 2, py: 4 },
  { color: rgba(245, 160, 190), r: 0.45, sx: 0.19, sy: 0.13, px: 4, py: 2 },
  { color: rgba(250, 205, 130), r: 0.4, sx: 0.27, sy: 0.24, px: 1, py: 5 },
  { color: rgba(140, 190, 245), r: 0.5, sx: 0.12, sy: 0.29, px: 5, py: 0 },
];

/**
 * Burn-in protection for a board left on all day. Every `minutes`, soft coloured lights (an
 * aurora on the dark theme, watercolour washes on the light one) drift across the whole screen
 * for 20 s, drawn behind the board (like the weather animation) so it stays readable and usable
 * meanwhile.
 * In between, the whole board shifts by a pixel or two each minute (applied to `.app` via CSS
 * variables), so static text and borders never sit on exactly the same pixels for hours.
 */
export function ScreenSaver({ minutes, preview, onPreviewEnd }: { minutes: number; preview: boolean; onPreviewEnd: () => void }) {
  const [running, setRunning] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Pixel shift between runs.
  useEffect(() => {
    const root = document.documentElement;
    if (!minutes) {
      root.style.removeProperty("--shift-x");
      root.style.removeProperty("--shift-y");
      return;
    }
    const steps = [-2, -1, 0, 1, 2];
    let k = 0;
    const shift = () => {
      k++;
      root.style.setProperty("--shift-x", `${steps[k % 5]}px`);
      root.style.setProperty("--shift-y", `${steps[(k * 2 + 1) % 5]}px`);
    };
    shift();
    const t = setInterval(shift, 60_000);
    return () => {
      clearInterval(t);
      root.style.removeProperty("--shift-x");
      root.style.removeProperty("--shift-y");
    };
  }, [minutes]);

  // Schedule runs (only while the board is actually on screen).
  useEffect(() => {
    if (!minutes) return;
    const t = setInterval(() => document.visibilityState === "visible" && setRunning(true), minutes * 60_000);
    return () => clearInterval(t);
  }, [minutes]);

  useEffect(() => {
    if (preview) setRunning(true);
  }, [preview]);

  // The animation itself.
  useEffect(() => {
    if (!running) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    // The canvas's own size (CSS: the whole screen, incl. under Safari's toolbar), not innerHeight.
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    // The glow is drawn small and stretched to the screen: the scaling blurs it into soft light
    // for free, and a few thousand pixels a frame is nothing even for an old tablet.
    const SCALE = 10;
    const sw = Math.max(16, Math.round(w / SCALE));
    const sh = Math.max(16, Math.round(h / SCALE));
    canvas.width = sw;
    canvas.height = sh;
    const dark =
      document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const blobs = dark ? DARK : LIGHT;
    const t0 = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const p = (t - t0) / RUN_MS;
      if (p >= 1) return end();
      raf = requestAnimationFrame(frame);
      const sec = (t - t0) / 1000;
      // Ease in over the first 3 s and out over the last 3 s.
      const fade = smooth(Math.min(1, sec / 3, (RUN_MS / 1000 - sec) / 3));
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, sw, sh);
      ctx.globalCompositeOperation = dark ? "lighter" : "multiply";
      if (!dark) {
        // Multiply needs a white page to darken; the canvas's own alpha fades it in and out.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, sw, sh);
      }
      const R = Math.max(sw, sh);
      blobs.forEach((b, i) => {
        // Each light drifts on its own slow loop and wanders across most of the screen in 20 s,
        // so every pixel passes through several colours (that's what protects the panel).
        const k = reduce ? 0.15 : 1;
        const x = sw * (0.5 + 0.55 * Math.sin(sec * b.sx * k + b.px));
        const y = sh * (0.5 + 0.55 * Math.cos(sec * b.sy * k + b.py));
        const r = R * (b.r + 0.08 * Math.sin(sec * 0.4 + i));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, b.color(1));
        g.addColorStop(0.45, b.color(0.55));
        g.addColorStop(1, b.color(0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, sw, sh);
      });
      canvas.style.opacity = String(fade * (dark ? 0.85 : 0.75));
    };
    const end = () => {
      cancelAnimationFrame(raf);
      setRunning(false);
      onPreviewEnd();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  if (!running) return null;
  return <canvas ref={canvasRef} className="saver" aria-hidden />;
}
