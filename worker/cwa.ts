import type { Observation, ObservationResponse } from "../src/shared";
import { type Env, cached, fetchJSON } from "./util";

// Without a list, the original two cities (keeps older pages working).
const DEFAULT_TOWNS = ["臺北市/中正區", "臺北市/南港區", "臺北市/內湖區", "新北市/汐止區"];
const MAX_TOWNS = 10;
const DATASETS = ["O-A0003-001", "O-A0001-001"]; // manned stations first, then automatic ones

/** CWA uses -99 / -999 / "-99" style sentinels for missing values. */
function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > -90 ? n : null;
}

function parse(s: any): Observation {
  const w = s.WeatherElement ?? {};
  const weather = typeof w.Weather === "string" && !w.Weather.startsWith("-99") ? w.Weather : null;
  return {
    station: s.StationName,
    county: s.GeoInfo?.CountyName ?? "",
    town: s.GeoInfo?.TownName ?? "",
    time: Date.parse(s.ObsTime?.DateTime ?? "") || 0,
    temperature: num(w.AirTemperature),
    humidity: num(w.RelativeHumidity),
    weather,
    high: num(w.DailyExtreme?.DailyHigh?.TemperatureInfo?.AirTemperature),
    low: num(w.DailyExtreme?.DailyLow?.TemperatureInfo?.AirTemperature),
  };
}

/** `towns` as 縣市/鄉鎮區, e.g. 新北市/汐止區; only those towns' stations are returned. */
export async function observations(env: Env, towns: string[]): Promise<ObservationResponse> {
  if (!env.CWA_API_KEY) return { configured: false, observations: [] };
  const all = await cached("cwa:obs", 300, async () => {
    const sets = await Promise.allSettled(
      DATASETS.map((id) =>
        fetchJSON(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/${id}?Authorization=${env.CWA_API_KEY}&format=JSON`),
      ),
    );
    const out: Observation[] = [];
    for (const r of sets) {
      if (r.status !== "fulfilled") continue;
      for (const s of (r.value as any)?.records?.Station ?? []) {
        out.push(parse(s));
      }
    }
    if (!out.length) throw new Error("氣象署資料讀取失敗，請檢查授權碼");
    return out;
  });
  const wanted = new Set((towns.length ? towns : DEFAULT_TOWNS).slice(0, MAX_TOWNS));
  return { configured: true, observations: all.filter((o) => wanted.has(`${o.county}/${o.town}`)) };
}
