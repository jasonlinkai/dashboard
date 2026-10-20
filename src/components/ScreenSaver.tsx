import { useEffect, useRef, useState } from "react";

const RUN_MS = 20_000;

/**
 * Burn-in protection for a board left on all day. Every `minutes`, colour bands sweep across the
 * whole screen for 20 s, drawn behind the board (like the weather animation) so it stays readable
 * and usable meanwhile.
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
    const dpr = Math.min(2, devicePixelRatio || 1);
    // The canvas's own size (CSS: the whole screen, incl. under Safari's toolbar), not innerHeight.
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const p = (t - t0) / RUN_MS;
      if (p >= 1) return end();
      raf = requestAnimationFrame(frame);
      ctx.clearRect(0, 0, w, h);
      // Fade in and out over the first and last two seconds.
      const fade = Math.min(1, p * 10, (1 - p) * 10);
      ctx.globalAlpha = fade;
      // Colour bands sweeping diagonally: every pixel cycles through red, green, blue and white.
      const offset = reduce ? 0 : p * (w + h) * 2;
      const band = Math.max(w, h) / 3;
      for (let x = -band * 2 - h; x < w + h + band; x += band / 4) {
        const i = Math.floor((x + offset) / (band / 4));
        const hue = (i * 37 + t / 40) % 360;
        ctx.fillStyle = `hsla(${hue}, 85%, 55%, ${0.35 + 0.25 * Math.sin(i)})`;
        ctx.beginPath();
        const xx = ((x + offset) % (w + h + band * 2)) - band;
        ctx.moveTo(xx, 0);
        ctx.lineTo(xx + band / 4, 0);
        ctx.lineTo(xx + band / 4 - h, h);
        ctx.lineTo(xx - h, h);
        ctx.fill();
      }
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
