import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Scene, sceneFor } from "./WeatherFx";
import type React from "react";
import { REFRESH_SEC, STALE_AFTER_SEC, STATION_MAX_AGE_MIN, links } from "../config";
import { type WeatherPlace, placeKey, useSettings } from "../settings";
import { clock } from "../format";
import { type Loaded, getBatched, getJSON, moveTo, usePolling, useReorder } from "../hooks";
import type { Observation, ObservationResponse } from "../shared";
import { Flip } from "./Flip";
import { Section } from "./Section";
import { SkeletonBar } from "./Skeleton";

interface Forecast {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    is_day: number;
    wind_speed_10m: number;
  };
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

/** Above this a station is up a mountain (汐止區's 五指山 is ~650 m, often 6° colder than town). */
const MOUNTAIN_M = 300;
const mountain = (o: Observation) => o.altitude != null && o.altitude > MOUNTAIN_M;

function pickStation(loc: WeatherPlace, obs: Observation[]): Observation | undefined {
  // A station that hasn't reported for a while (or reports no temperature, e.g. a broken
  // sensor) can't be used; better to show the model (and say so) than an old reading.
  const usable = obs.filter((o) => o.temperature != null && Date.now() - o.time < STATION_MAX_AGE_MIN * 60_000);
  const inTown = usable.filter((o) => o.county === loc.county && o.town === loc.town);
  return (
    (loc.station && usable.find((o) => o.station === loc.station)) ||
    // Then a regular station in town, then a freeway one (國一N013K …: on viaducts, but at town
    // level), and a mountain station only if nothing else exists.
    inTown.find((o) => !HIGHWAY.test(o.station) && !mountain(o)) ||
    inTown.find((o) => HIGHWAY.test(o.station) && !mountain(o)) ||
    inTown[0]
  );
}

async function loadForecasts(places: WeatherPlace[]): Promise<Loaded<Forecast[]>> {
  const p = new URLSearchParams({
    latitude: places.map((l) => l.latitude).join(","),
    longitude: places.map((l) => l.longitude).join(","),
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

// After the user scrolls the hourly strips away, bring "now" back to the centre after this long.
const RECENTER_AFTER_MS = 8000;

/**
 * Keeps the four hourly strips moving together. All strips list the same hours with the same
 * cell width, so syncing scrollLeft lines them up. Scroll events we cause ourselves (syncing or
 * re-centring) are ignored for a moment so they aren't mistaken for the user scrolling.
 */
class StripGroup {
  private strips = new Set<HTMLDivElement>();
  private ignoreUntil = new WeakMap<HTMLDivElement, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private resize = new ResizeObserver((entries) => {
    if (entries.some((e) => e.contentRect.width > 0)) this.centerAll(false);
  });

  add(el: HTMLDivElement) {
    this.strips.add(el);
    el.addEventListener("scroll", this.onScroll, { passive: true });
    this.resize.observe(el);
    this.center(el, false);
  }

  remove(el: HTMLDivElement) {
    this.strips.delete(el);
    el.removeEventListener("scroll", this.onScroll);
    this.resize.unobserve(el);
  }

  dispose() {
    clearTimeout(this.timer);
    this.resize.disconnect();
  }

  private quiet(el: HTMLDivElement, ms: number) {
    this.ignoreUntil.set(el, performance.now() + ms);
  }

  private onScroll = (e: Event) => {
    const src = e.currentTarget as HTMLDivElement;
    if (performance.now() < (this.ignoreUntil.get(src) ?? 0)) return;
    // The user is scrolling this strip: drag the others along.
    for (const el of this.strips) {
      if (el === src || Math.abs(el.scrollLeft - src.scrollLeft) < 1) continue;
      this.quiet(el, 150);
      el.scrollLeft = src.scrollLeft;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.centerAll(true), RECENTER_AFTER_MS);
  };

  private center(el: HTMLDivElement, smooth: boolean) {
    const cell = el.querySelector<HTMLElement>(".wx-now");
    if (!cell || el.clientWidth === 0) return;
    // Measure on screen: offsetLeft is relative to the page, not to this strip. A card being
    // dragged is scaled up, so convert screen pixels back to the strip's own pixels.
    const box = el.getBoundingClientRect();
    const scale = box.width / el.offsetWidth || 1;
    const delta = (cell.getBoundingClientRect().left - box.left) / scale;
    this.quiet(el, smooth ? 800 : 100);
    el.scrollTo({ left: el.scrollLeft + delta - (el.clientWidth - cell.offsetWidth) / 2, behavior: smooth ? "smooth" : "auto" });
  }

  centerAll(smooth: boolean) {
    for (const el of this.strips) this.center(el, smooth);
  }
}

/**
 * One scrollable row: the past 12 hours (dimmed), the current hour (highlighted) and the next 23.
 * The current hour is kept centred (see StripGroup), and re-centred when the hour changes.
 */
function Hourly({ f, group, nowTemp, nowIcon }: { f: Forecast; group: StripGroup; nowTemp: number; nowIcon: string }) {
  // Open-Meteo hourly times are local (Asia/Taipei) without an offset.
  const nowKey = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 13);
  const now = f.hourly.time.findIndex((t) => t.slice(0, 13) === nowKey);
  const strip = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    group.add(el);
    return () => group.remove(el);
  }, [group, nowKey]);

  return (
    <div className="wx-strip" ref={strip}>
      {f.hourly.time.map((t, i) => (
        <div key={t} className={i === now ? "wx-now" : i < now ? "wx-past" : ""}>
          <div className="wx-h">{i === now ? "現在" : t.slice(11, 13)}</div>
          {/* "現在" shows what the big number shows (the station reading when there is one), so the
              card never says two different temperatures for now; other hours are the forecast. */}
          <div>{i === now ? nowIcon : wmo(f.hourly.weather_code[i], f.hourly.is_day[i] === 1)[1]}</div>
          <div>{Math.round(i === now ? nowTemp : f.hourly.temperature_2m[i])}°</div>
          <div className="blue">{f.hourly.precipitation_probability[i] ?? 0}%</div>
        </div>
      ))}
    </div>
  );
}

function WeatherCard({ loc, f, obs, group }: { loc: WeatherPlace; f?: Forecast; obs?: Observation; group: StripGroup }) {
  if (!f)
    return (
      <div className="wx" data-reorder>
        <div className="wx-name">{loc.name}</div>
        <SkeletonBar className="sk-wx" />
        <SkeletonBar className="sk-sub" />
      </div>
    );
  const day = f.current.is_day === 1;
  const [mText, mIcon] = wmo(f.current.weather_code, day);
  const text = obs?.weather ?? mText;
  const icon = obs?.weather ? cwaEmoji(obs.weather, day) : mIcon;
  const temp = obs?.temperature ?? f.current.temperature_2m;
  const humidity = obs?.humidity ?? f.current.relative_humidity_2m;

  return (
    <a className="wx link" data-reorder href={links.weather(loc)} target="_blank" rel="noopener noreferrer">
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
          <Flip value={`${Math.round(temp)}°`} />
          <span className="wx-range">
            {/* The forecast range, widened to include the current reading so it never contradicts it. */}
            <span className="red">↑{Math.round(Math.max(f.daily.temperature_2m_max[0], temp))}°</span>
            <span className="blue">↓{Math.round(Math.min(f.daily.temperature_2m_min[0], temp))}°</span>
          </span>
        </div>
        <div className="wx-meta small">體感 {Math.round(f.current.apparent_temperature)}°</div>
        <div className="wx-src muted tiny">
          {obs ? `實測 ${obs.station}站 ${clock(obs.time)}` : "Open-Meteo 模型"}
          {obs && loc.station && obs.station !== loc.station && `（${loc.station}站暫無資料）`}
          {obs && mountain(obs) && `・山區測站 ${Math.round(obs.altitude!)}m`}
        </div>
      </div>
      <Hourly f={f} group={group} nowTemp={temp} nowIcon={icon} />
    </a>
  );
}

export function Weather({ onScene }: { onScene?: (s: Scene) => void }) {
  const { settings, setSettings } = useSettings();
  const places = settings.weather;
  const gridRef = useReorder<HTMLDivElement>((from, to) => setSettings({ ...settings, weather: moveTo(places, from, to) }));
  const key = places.map((p) => `${p.latitude},${p.longitude}`).join(";");
  const towns = [...new Set(places.map(placeKey))].join(",");
  const forecasts = usePolling(() => loadForecasts(places), REFRESH_SEC.weather, [key]);
  // Station data is optional: without a CWA key (or if it fails) the cards fall back to the model.
  const obs = usePolling(() => getBatched<ObservationResponse>("/api/observations", "towns", towns.split(",")), REFRESH_SEC.weather, [
    towns,
  ]);
  const stations = obs.data?.observations ?? [];
  const [group] = useState(() => new StripGroup());
  useEffect(() => () => group.dispose(), [group]);
  // Moving a card in the DOM (drag to reorder) resets its strip's scroll: bring "now" back.
  const order = places.map((p) => p.name).join();
  useEffect(() => {
    requestAnimationFrame(() => group.centerAll(false));
  }, [group, order]);
  // Right after the places change, the previous forecasts are still in state; don't mix them up.
  const fresh = forecasts.data?.length === places.length ? forecasts.data : undefined;

  // The full-page animation follows the first place's weather.
  const fxPlace = places[0];
  const fxForecast = fresh?.[0];
  const fxText = fxPlace ? pickStation(fxPlace, stations)?.weather : null;
  const fxKind = fxForecast ? sceneFor(fxText, fxForecast.current.weather_code, fxForecast.current.is_day === 1) : null;
  useEffect(() => {
    if (fxKind && onScene) onScene(fxKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxKind?.kind, fxKind?.day]);
  return (
    <Section
      title="天氣"
      edit="weather"
      className="weather"
      state={forecasts}
      maxAgeSec={STALE_AFTER_SEC.weather}
      source={
        <>
          <a href="https://www.cwa.gov.tw/" target="_blank" rel="noopener noreferrer">
            中央氣象署
          </a>
          （實測）、Weather data by{" "}
          <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
            Open-Meteo.com
          </a>
          （預報，CC BY 4.0）
        </>
      }
    >
      <div
        className="wx-grid"
        ref={gridRef}
        style={{ "--wx": places.length, "--wx-rows-2": Math.ceil(places.length / 2) } as React.CSSProperties}
      >
        {places.map((loc, i) => (
          <WeatherCard key={loc.name} loc={loc} f={fresh?.[i]} obs={pickStation(loc, stations)} group={group} />
        ))}
      </div>
      {obs.data && !obs.data.configured && <p className="hint">設定氣象署授權碼後，會改用各區測站的實測資料。</p>}
      {obs.error && <p className="hint error">氣象署：{obs.error}</p>}
    </Section>
  );
}
