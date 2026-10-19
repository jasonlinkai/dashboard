import { useLayoutEffect, useRef } from "react";
import { LOCATIONS, type Location, REFRESH_SEC, STALE_AFTER_SEC, STATION_MAX_AGE_MIN, links } from "../config";
import { clock } from "../format";
import { type Loaded, getJSON, usePolling } from "../hooks";
import type { Observation, ObservationResponse } from "../shared";
import { Section } from "./Section";

interface Forecast {
  current: { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; weather_code: number; is_day: number; wind_speed_10m: number };
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; weather_code: number[]; is_day: number[] };
  daily: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
}

// WMO weather codes → text + emoji (emoji render the same on iOS, Android and desktop).
function wmo(code: number, day = true): [string, string] {
  if (code === 0) return ["晴", day ? "☀️" : "🌙"];
  if (code === 1) return ["晴時多雲", day ? "🌤️" : "🌙"];
  if (code === 2) return ["多雲", "⛅"];
  if (code === 3) return ["陰", "☁️"];
  if (code === 45 || code === 48) return ["霧", "🌫️"];
  if (code >= 51 && code <= 57) return ["毛毛雨", "🌦️"];
  if (code === 61 || code === 80) return ["短暫雨", "🌦️"];
  if (code === 63 || code === 81 || code === 66) return ["雨", "🌧️"];
  if (code === 65 || code === 82 || code === 67) return ["大雨", "🌧️"];
  if (code >= 71 && code <= 86) return ["雪", "🌨️"];
  if (code >= 95) return ["雷雨", "⛈️"];
  return ["—", "🌡️"];
}

/** CWA's own description is more accurate locally; map its wording to an emoji. */
function cwaEmoji(text: string, day: boolean): string {
  if (/雷/.test(text)) return "⛈️";
  if (/雨/.test(text)) return "🌧️";
  if (/霧|靄/.test(text)) return "🌫️";
  if (/陰/.test(text)) return "☁️";
  if (/多雲/.test(text)) return "⛅";
  if (/晴/.test(text)) return day ? "☀️" : "🌙";
  return "🌡️";
}

const HIGHWAY = /^國[一二三五]/;

function pickStation(loc: Location, obs: Observation[]): Observation | undefined {
  // A station that hasn't reported for a while is broken or offline; better to show the model
  // (and say so) than an old reading presented as current.
  const usable = obs.filter((o) => o.temperature != null && Date.now() - o.time < STATION_MAX_AGE_MIN * 60_000);
  const inTown = usable.filter((o) => o.county === loc.cwa.county && o.town === loc.cwa.town);
  return (
    (loc.cwa.station && usable.find((o) => o.station === loc.cwa.station)) ||
    // Freeway stations (國一N013K …) sit on viaducts and in valleys; use them only if nothing else exists.
    inTown.find((o) => !HIGHWAY.test(o.station)) ||
    inTown[0]
  );
}

async function loadForecasts(): Promise<Loaded<Forecast[]>> {
  const p = new URLSearchParams({
    latitude: LOCATIONS.map((l) => l.latitude).join(","),
    longitude: LOCATIONS.map((l) => l.longitude).join(","),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m",
    hourly: "temperature_2m,precipitation_probability,weather_code,is_day",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "Asia/Taipei",
    // Hourly: 12 h of history + the current hour + 23 h ahead, so "now" can sit in the middle.
    past_hours: "12",
    forecast_hours: "24",
  });
  const { data } = await getJSON<Forecast | Forecast[]>(`https://api.open-meteo.com/v1/forecast?${p}`);
  // Called straight from the browser (no Worker cache), so the data is as of now.
  return { data: Array.isArray(data) ? data : [data], dataTime: Date.now(), stale: false };
}

// After the user scrolls the hourly strip away, bring "now" back to the centre after this long.
const RECENTER_AFTER_MS = 8000;

/**
 * One scrollable row: the past 12 hours (dimmed), the current hour (highlighted) and the next 23.
 * The current hour is kept centred: on load, when the hour changes, whenever the strip changes size
 * (rotation, or the phone's weather tab being shown — it has no width while hidden), and a few
 * seconds after the user scrolls it away.
 */
function Hourly({ f }: { f: Forecast }) {
  // Open-Meteo hourly times are local (Asia/Taipei) without an offset.
  const nowKey = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 13);
  const now = f.hourly.time.findIndex((t) => t.slice(0, 13) === nowKey);
  const strip = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let programmatic = false;
    const center = (smooth: boolean) => {
      const cell = current.current;
      if (!cell) return;
      programmatic = true;
      // Measure on screen: offsetLeft is relative to the page, not to this strip.
      const delta = cell.getBoundingClientRect().left - el.getBoundingClientRect().left;
      el.scrollTo({ left: el.scrollLeft + delta - (el.clientWidth - cell.offsetWidth) / 2, behavior: smooth ? "smooth" : "auto" });
      setTimeout(() => (programmatic = false), smooth ? 600 : 0);
    };
    const onScroll = () => {
      if (programmatic) return;
      clearTimeout(timer);
      timer = setTimeout(() => center(true), RECENTER_AFTER_MS);
    };
    const resize = new ResizeObserver(() => el.clientWidth > 0 && center(false));
    resize.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      resize.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [nowKey]);

  return (
    <div className="wx-strip" ref={strip}>
      {f.hourly.time.map((t, i) => (
        <div key={t} ref={i === now ? current : undefined} className={i === now ? "wx-now" : i < now ? "wx-past" : ""}>
          <div className="wx-h">{i === now ? "現在" : t.slice(11, 13)}</div>
          <div>{wmo(f.hourly.weather_code[i], f.hourly.is_day[i] === 1)[1]}</div>
          <div>{Math.round(f.hourly.temperature_2m[i])}°</div>
          <div className="blue">{f.hourly.precipitation_probability[i] ?? 0}%</div>
        </div>
      ))}
    </div>
  );
}

function WeatherCard({ loc, f, obs }: { loc: Location; f?: Forecast; obs?: Observation }) {
  if (!f) return <div className="wx"><div className="wx-name">{loc.name}</div></div>;
  const day = f.current.is_day === 1;
  const [mText, mIcon] = wmo(f.current.weather_code, day);
  const text = obs?.weather ?? mText;
  const icon = obs?.weather ? cwaEmoji(obs.weather, day) : mIcon;
  const temp = obs?.temperature ?? f.current.temperature_2m;
  const humidity = obs?.humidity ?? f.current.relative_humidity_2m;

  return (
    <a className="wx link" href={links.weather(loc)} target="_blank" rel="noopener noreferrer">
      <div className="wx-head">
        <span className="wx-name">{loc.name}</span>
        <span className="wx-icon">{icon}</span>
        <span className="muted small">{text}</span>
        <span className="wx-corner small">
          <span title="今日最高降雨機率">☔ {f.daily.precipitation_probability_max[0] ?? 0}%</span>
          <span title="相對濕度">💧 {Math.round(humidity)}%</span>
        </span>
      </div>
      <div className="wx-main">
        <div className="wx-temp">
          {Math.round(temp)}°
          <span className="wx-range">
            <span className="red">↑{Math.round(f.daily.temperature_2m_max[0])}°</span>
            <span className="blue">↓{Math.round(f.daily.temperature_2m_min[0])}°</span>
          </span>
        </div>
        <div className="wx-meta small">體感 {Math.round(f.current.apparent_temperature)}°</div>
        <div className="wx-src muted tiny">{obs ? `實測 ${obs.station}站 ${clock(obs.time)}` : "Open-Meteo 模型"}</div>
      </div>
      <Hourly f={f} />
    </a>
  );
}

export function Weather() {
  const forecasts = usePolling(loadForecasts, REFRESH_SEC.weather);
  // Station data is optional: without a CWA key (or if it fails) the cards fall back to the model.
  const obs = usePolling(() => getJSON<ObservationResponse>("/api/observations"), REFRESH_SEC.weather);
  const stations = obs.data?.observations ?? [];
  return (
    <Section title="天氣" className="weather" state={forecasts} maxAgeSec={STALE_AFTER_SEC.weather}>
      <div className="wx-grid">
        {LOCATIONS.map((loc, i) => (
          <WeatherCard key={loc.name} loc={loc} f={forecasts.data?.[i]} obs={pickStation(loc, stations)} />
        ))}
      </div>
      {obs.data && !obs.data.configured && <p className="hint">設定氣象署授權碼後，會改用各區測站的實測資料。</p>}
      {obs.error && <p className="hint error">氣象署：{obs.error}</p>}
    </Section>
  );
}
