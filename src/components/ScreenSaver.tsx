import { useEffect, useRef, useState } from "react";

const RUN_MS = 20_000;
const timeFmt = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" });

/**
 * Burn-in protection for a board left on all day. Every `minutes`, a full-screen animation runs
 * for 20 s: colour bands sweep across every pixel and a clock drifts around. Tap to end it early.
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
    const w = innerWidth;
    const h = innerHeight;
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
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
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
      // A clock drifting on a slow Lissajous path, so the screen still tells the time.
      const cx = w / 2 + Math.sin(p * Math.PI * 2) * w * 0.3;
      const cy = h / 2 + Math.sin(p * Math.PI * 3) * h * 0.25;
      ctx.font = `700 ${Math.round(Math.min(w, h) / 6)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(timeFmt.format(Date.now()), cx + 3, cy + 3);
      ctx.fillStyle = "#fff";
      ctx.fillText(timeFmt.format(Date.now()), cx, cy);
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
  return (
    <div className="saver" onClick={() => (setRunning(false), onPreviewEnd())} role="button" aria-label="螢幕保護中，點一下結束">
      <canvas ref={canvasRef} />
      <div className="saver-hint">螢幕保護中・點一下結束</div>
    </div>
  );
}
