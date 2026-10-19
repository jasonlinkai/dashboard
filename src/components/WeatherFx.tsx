import { useEffect, useRef } from "react";

export type SceneKind = "clear" | "cloudy" | "overcast" | "fog" | "drizzle" | "rain" | "heavy" | "storm" | "snow";
export interface Scene {
  kind: SceneKind;
  day: boolean;
}

/** CWA's wording (e.g. 晴, 多雲, 陰有雨, 雷陣雨) wins; otherwise the model's WMO code. */
export function sceneFor(cwaText: string | null | undefined, wmo: number, day: boolean): Scene {
  const t = cwaText ?? "";
  let kind: SceneKind;
  if (t) {
    if (/雷/.test(t)) kind = "storm";
    else if (/大雨|豪雨/.test(t)) kind = "heavy";
    else if (/毛毛雨/.test(t)) kind = "drizzle";
    else if (/雨/.test(t)) kind = "rain";
    else if (/雪/.test(t)) kind = "snow";
    else if (/霧|靄/.test(t)) kind = "fog";
    else if (/陰/.test(t)) kind = "overcast";
    else if (/雲/.test(t)) kind = "cloudy";
    else kind = "clear";
  } else if (wmo >= 95) kind = "storm";
  else if (wmo === 65 || wmo === 67 || wmo === 82) kind = "heavy";
  else if ((wmo >= 71 && wmo <= 77) || wmo === 85 || wmo === 86) kind = "snow";
  else if (wmo >= 61) kind = "rain";
  else if (wmo >= 51) kind = "drizzle";
  else if (wmo === 45 || wmo === 48) kind = "fog";
  else if (wmo === 3) kind = "overcast";
  else if (wmo === 2) kind = "cloudy";
  else kind = "clear";
  return { kind, day };
}

interface Particle {
  x: number;
  y: number;
  v: number; // speed
  s: number; // size / length
  p: number; // phase
}

const RAIN: Partial<Record<SceneKind, number>> = { drizzle: 70, rain: 150, heavy: 280, storm: 260 };
const CLOUDS: Partial<Record<SceneKind, number>> = { cloudy: 4, overcast: 7, drizzle: 6, rain: 7, heavy: 8, storm: 8, snow: 6, fog: 3 };
const FPS = 30;

function isDark() {
  return getComputedStyle(document.documentElement).colorScheme.includes("dark");
}

/**
 * Full-page animated weather behind the cards (pointer-events: none). Drawn on one canvas at
 * ≤30 fps, paused while the page is hidden, and not drawn at all with "reduce motion" on.
 */
export function WeatherFx({ scene }: { scene: Scene }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d")!;
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      w = innerWidth;
      h = innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener("resize", resize);

    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const n = (count: number, make: () => Particle) => Array.from({ length: count }, make);
    const { kind, day } = scene;

    const drops = n(RAIN[kind] ?? 0, () => ({ x: rnd(0, 1), y: rnd(0, 1), v: rnd(0.9, 1.4), s: rnd(10, 22), p: 0 }));
    const flakes = n(kind === "snow" ? 90 : 0, () => ({ x: rnd(0, 1), y: rnd(0, 1), v: rnd(0.3, 0.8), s: rnd(1.5, 3.5), p: rnd(0, 6.28) }));
    const clouds = n(CLOUDS[kind] ?? 0, () => ({ x: rnd(-0.2, 1.1), y: rnd(-0.05, 0.45), v: rnd(0.004, 0.012), s: rnd(140, 280), p: rnd(0.6, 1) }));
    const stars = n(kind === "clear" && !day ? 120 : 0, () => ({ x: rnd(0, 1), y: rnd(0, 0.75), v: rnd(0.5, 2), s: rnd(0.6, 1.6), p: rnd(0, 6.28) }));
    const fog = n(kind === "fog" ? 6 : 0, () => ({ x: rnd(0, 1), y: rnd(0.15, 0.95), v: rnd(0.006, 0.015), s: rnd(120, 220), p: 0 }));
    const speed = kind === "heavy" || kind === "storm" ? 1.6 : kind === "drizzle" ? 0.7 : 1.15;
    let flash = 0;
    let nextFlash = performance.now() + rnd(4000, 10000);
    let dark = isDark();
    const themeTimer = setInterval(() => (dark = isDark()), 1000);

    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 1000 / FPS) return;
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      ctx.clearRect(0, 0, w, h);
      const ink = dark ? "255,255,255" : "40,60,90";

      // Sun: a soft glow and slowly turning rays, top right.
      if (kind === "clear" && day) {
        const cx = w * 0.88;
        const cy = h * 0.06;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.45);
        g.addColorStop(0, "rgba(255,200,90,0.42)");
        g.addColorStop(1, "rgba(255,200,90,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t / 60000);
        ctx.fillStyle = "rgba(255,210,120,0.1)";
        for (let i = 0; i < 12; i++) {
          ctx.rotate((Math.PI * 2) / 12);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.max(w, h), -40);
          ctx.lineTo(Math.max(w, h), 40);
          ctx.fill();
        }
        ctx.restore();
      }

      // Stars twinkle on clear nights.
      for (const s of stars) {
        const a = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(t / 1000 * s.v + s.p));
        ctx.fillStyle = `rgba(${dark ? "255,255,240" : "90,110,150"},${a})`;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.s, 0, Math.PI * 2);
        ctx.fill();
      }

      // Clouds: clusters of soft radial blobs drifting right.
      const heavySky = kind !== "cloudy" && kind !== "fog";
      for (const c of clouds) {
        c.x += c.v * dt;
        if (c.x > 1.25) c.x = -0.3;
        const alpha = (heavySky ? 0.3 : 0.26) * c.p;
        for (let i = 0; i < 4; i++) {
          const bx = c.x * w + (i - 1.5) * c.s * 0.45;
          const by = c.y * h + Math.sin(i * 1.7) * c.s * 0.12;
          const r = c.s * (0.55 + 0.15 * Math.cos(i * 2.3));
          const g = ctx.createRadialGradient(bx, by, 0, bx, by, r);
          const tone = heavySky ? (dark ? "200,210,225" : "110,120,135") : dark ? "235,240,250" : "150,160,175";
          g.addColorStop(0, `rgba(${tone},${alpha})`);
          g.addColorStop(1, `rgba(${tone},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(bx - r, by - r, r * 2, r * 2);
        }
      }

      // Fog: wide horizontal bands sliding slowly.
      for (const f of fog) {
        f.x += f.v * dt;
        if (f.x > 1.5) f.x = -0.5;
        const y = f.y * h;
        const g = ctx.createLinearGradient(0, y - f.s / 2, 0, y + f.s / 2);
        g.addColorStop(0, `rgba(${ink},0)`);
        g.addColorStop(0.5, `rgba(${ink},0.12)`);
        g.addColorStop(1, `rgba(${ink},0)`);
        ctx.fillStyle = g;
        ctx.fillRect((f.x - 0.5) * w, y - f.s / 2, w * 1.2, f.s);
      }

      // Rain: slanted streaks.
      if (drops.length) {
        ctx.strokeStyle = `rgba(${dark ? "170,200,255" : "60,90,140"},${kind === "drizzle" ? 0.35 : 0.48})`;
        ctx.lineWidth = kind === "heavy" || kind === "storm" ? 1.4 : 1;
        ctx.beginPath();
        for (const d of drops) {
          d.y += d.v * speed * dt * 1.2;
          d.x -= d.v * speed * dt * 0.18;
          if (d.y > 1.05) {
            d.y = -0.05;
            d.x = rnd(0, 1.2);
          }
          const x = d.x * w;
          const y = d.y * h;
          ctx.moveTo(x, y);
          ctx.lineTo(x - d.s * 0.18, y + d.s);
        }
        ctx.stroke();
      }

      // Snow: drifting flakes.
      for (const f of flakes) {
        f.y += f.v * dt * 0.12;
        f.x += Math.sin(t / 1500 + f.p) * dt * 0.01;
        if (f.y > 1.03) f.y = -0.03;
        ctx.fillStyle = `rgba(${dark ? "255,255,255" : "120,140,170"},0.8)`;
        ctx.beginPath();
        ctx.arc(f.x * w, f.y * h, f.s, 0, Math.PI * 2);
        ctx.fill();
      }

      // Thunderstorm: an occasional flash that fades out.
      if (kind === "storm") {
        if (t > nextFlash) {
          flash = 1;
          nextFlash = t + rnd(5000, 14000);
        }
        if (flash > 0) {
          ctx.fillStyle = `rgba(${dark ? "220,230,255" : "255,255,255"},${flash * 0.3})`;
          ctx.fillRect(0, 0, w, h);
          flash = Math.max(0, flash - dt * 2.5);
        }
      }
    };

    const start = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      if (document.visibilityState === "visible") raf = requestAnimationFrame(frame);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(themeTimer);
      removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", start);
    };
  }, [scene.kind, scene.day]);

  return <canvas ref={ref} className="weather-fx" aria-hidden />;
}
