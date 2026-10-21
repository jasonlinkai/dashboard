// Car parks near a point, from TDX (off-street car parks + live free spaces), and place search
// via TDX's geocoder. Live spaces exist only for some car parks; anything the source doesn't
// say (or says nonsense, like -1 spaces) is passed on as unknown, never guessed.

import towns from "../src/data/towns.json";
import { BUS_CITY_LIST } from "../src/bus-cities";
import { estimateFare } from "../src/parking-fare";
import type { GeoHit, GeoResponse, ParkingLot, ParkingResponse, ParkingSource } from "../src/shared";
import { type ExtraLot, ntpcLive, ntpcLots, osmLots } from "./parking-extra";
import { tdx } from "./tdx";
import { type Env, cached, rows } from "./util";

const CITY_CODE = new Map<string, string>(BUS_CITY_LIST.map(([code, name]) => [name, code]));
const CITY_NAME = new Map<string, string>(BUS_CITY_LIST);

export const PARKING_RADII = [300, 500, 1000, 2000];

function metres(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r);
  const y = (bLat - aLat) * r;
  return Math.round(Math.sqrt(x * x + y * y) * 6371_000);
}

/**
 * TDX lists car parks per city, so work out which cities the search circle can reach: the city
 * of the nearest township centre, plus a neighbour whose nearest township centre is about as
 * close (a point near a city border). Township centres are only approximate, hence the slack.
 */
function citiesNear(lat: number, lon: number, radius: number): string[] {
  const best = new Map<string, number>();
  for (const t of towns as { county: string; latitude: number; longitude: number }[]) {
    const code = CITY_CODE.get(t.county);
    if (!code) continue;
    const d = metres(lat, lon, t.latitude, t.longitude);
    if (d < (best.get(code) ?? Infinity)) best.set(code, d);
  }
  const sorted = [...best].sort((a, b) => a[1] - b[1]);
  if (!sorted.length) return [];
  const [first, second] = sorted;
  return second && second[1] < first[1] + radius + 4000 ? [first[0], second[0]] : [first[0]];
}

interface StaticLot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address: string;
  fare: string;
  desc: string;
}

/** The city's car parks change rarely (TDX refreshes the list daily): one call per city per day. */
function carParks(env: Env, city: string): Promise<StaticLot[]> {
  return cached(`parking-lots:${city}`, 86400, async () =>
    rows(await tdx(env, `/v1/Parking/OffStreet/CarPark/City/${city}`))
      .map((p: any) => ({
        id: String(p.CarParkID ?? ""),
        name: String(p.CarParkName?.Zh_tw ?? "").trim(),
        lat: Number(p.CarParkPosition?.PositionLat),
        lon: Number(p.CarParkPosition?.PositionLon),
        address: String(p.Address ?? "").trim(),
        fare: String(p.FareDescription ?? "").trim(),
        desc: String(p.Description ?? "").trim().slice(0, 300),
      }))
      .filter((p) => p.id && p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lat !== 0),
  );
}

type Count = { available: number; total: number | null } | null;
interface LiveRow {
  car: Count;
  scooter: Count;
  /** Only TotalSpaces/AvailableSpaces, no breakdown by vehicle type. */
  any: Count;
  serviceStatus: number | null;
  time: string | null;
}
interface LiveFeed {
  /** false: TDX has no live feed for this city */
  exists: boolean;
  srcTime: string | null;
  byId: Record<string, LiveRow>;
}

/** A count we can show: present and not negative (some feeds send -1 / -9 for "no data"). */
function count(available: unknown, total: unknown): Count {
  const a = typeof available === "number" ? available : NaN;
  if (!Number.isFinite(a) || a < 0) return null;
  const t = typeof total === "number" && total > 0 ? total : null;
  // 0 free with no capacity is how e.g. Taichung marks a scooter-only car park's car spaces:
  // it means "no such spaces / not reported", not "full".
  if (a === 0 && t == null) return null;
  // More free than total (seen in Taichung) means one of the two is wrong: keep the free count
  // the feed reports but don't print an impossible "191 / 189".
  return { available: a, total: t != null && a > t ? null : t };
}

/** Free spaces per car park, refreshed at most every 2 minutes (one call per city). */
function liveFeed(env: Env, city: string): Promise<LiveFeed> {
  return cached(`parking-live:${city}`, 120, async () => {
    let body: any;
    try {
      body = await tdx(env, `/v1/Parking/OffStreet/ParkingAvailability/City/${city}`);
    } catch (e) {
      if (e instanceof Error && /TDX 404/.test(e.message)) return { exists: false, srcTime: null, byId: {} };
      throw e;
    }
    const byId: Record<string, LiveRow> = {};
    for (const a of rows(body)) {
      const types: any[] = Array.isArray(a.Availabilities) ? a.Availabilities : [];
      const of = (t: number) => {
        const s = types.find((x) => x?.SpaceType === t);
        return s ? count(s.AvailableSpaces, s.NumberOfSpaces) : null;
      };
      byId[String(a.CarParkID)] = {
        car: of(1),
        scooter: of(2),
        any: types.length ? null : count(a.AvailableSpaces, a.TotalSpaces),
        serviceStatus: typeof a.ServiceStatus === "number" ? a.ServiceStatus : null,
        time: typeof a.DataCollectTime === "string" ? a.DataCollectTime : null,
      };
    }
    return { exists: Object.keys(byId).length > 0, srcTime: body?.SrcUpdateTime ?? body?.UpdateTime ?? null, byId };
  });
}

export async function parking(env: Env, origin: string, lat: number, lon: number, radius: number): Promise<ParkingResponse> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 21 || lat > 27 || lon < 118 || lon > 123)
    throw new Error("位置不在臺灣範圍內");
  if (!PARKING_RADII.includes(radius)) radius = 500;
  const cities = citiesNear(lat, lon, radius);
  const status: ParkingResponse["cities"] = [];
  const extra: ParkingResponse["extra"] = [];
  // The three sources are independent: fetch them side by side, and let one fail alone.
  const [tdxLots, ntpc, osm] = await Promise.all([
    tdxNear(env, cities, lat, lon, radius, status),
    cities.includes("NewTaipei") ? ntpcNear(lat, lon, radius, extra) : Promise.resolve([]),
    osmNear(env, origin, lat, lon, radius, extra),
  ]);
  const ntpcOk = extra.some((e) => e.source === "NTPC" && e.status === "ok");
  for (const c of status) if (c.city === "NewTaipei" && c.lots === "empty" && ntpcOk) c.coveredBy = "新北市政府開放資料";
  const lots = merge([...tdxLots, ...ntpc, ...osm]);
  lots.sort((a, b) => a.distance - b.distance);
  return { center: { lat, lon }, radius, cities: status, extra, lots };
}

async function tdxNear(
  env: Env,
  cities: string[],
  lat: number,
  lon: number,
  radius: number,
  status: ParkingResponse["cities"],
): Promise<ParkingLot[]> {
  const lots: ParkingLot[] = [];
  for (const city of cities) {
    const entry: ParkingResponse["cities"][number] = { city, name: CITY_NAME.get(city) ?? city, lots: "ok", live: "ok", liveTime: null };
    status.push(entry);
    let list: StaticLot[];
    try {
      list = await carParks(env, city);
    } catch (e) {
      entry.lots = "error";
      entry.error = e instanceof Error ? e.message : String(e);
      continue;
    }
    if (!list.length) {
      entry.lots = "empty";
      continue;
    }
    const near = list
      .map((p) => ({ p, d: metres(lat, lon, p.lat, p.lon) }))
      .filter((x) => x.d <= radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, 150);
    if (!near.length) continue; // no live call needed
    let feed: LiveFeed | null = null;
    try {
      feed = await liveFeed(env, city);
      entry.liveTime = feed.srcTime;
      if (!feed.exists) entry.live = "none";
    } catch (e) {
      entry.live = "error";
      entry.error = e instanceof Error ? e.message : String(e);
    }
    for (const { p, d } of near) {
      const row = feed?.byId[p.id];
      lots.push({
        id: p.id,
        source: "TDX",
        sources: ["TDX"],
        city,
        name: p.name,
        lat: p.lat,
        lon: p.lon,
        address: p.address,
        description: p.desc,
        fare: p.fare,
        fareEstimate: estimateFare(p.fare),
        distance: d,
        live: !feed ? "unavailable" : row ? "ok" : "none",
        car: row?.car ?? null,
        scooter: row?.scooter ?? null,
        spaces: row?.any ?? null,
        serviceStatus: row?.serviceStatus ?? null,
        liveTime: row?.time ?? null,
      });
    }
  }
  return lots;
}

function extraLot(p: ExtraLot, source: ParkingSource, city: string, distance: number): ParkingLot {
  return {
    id: p.id,
    source,
    sources: [source],
    city,
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    address: p.address,
    description: p.desc,
    fare: p.fare,
    fareEstimate: estimateFare(p.fare),
    distance,
    live: "none",
    car: null,
    scooter: null,
    spaces: null,
    serviceStatus: null,
    liveTime: null,
    note: p.note,
  };
}

async function ntpcNear(lat: number, lon: number, radius: number, extra: ParkingResponse["extra"]): Promise<ParkingLot[]> {
  const entry: ParkingResponse["extra"][number] = { source: "NTPC", name: "新北市政府開放資料", status: "ok" };
  extra.push(entry);
  let list: ExtraLot[];
  try {
    list = await ntpcLots();
  } catch (e) {
    entry.status = "error";
    entry.error = e instanceof Error ? e.message : String(e);
    return [];
  }
  const near = list.map((p) => ({ p, d: metres(lat, lon, p.lat, p.lon) })).filter((x) => x.d <= radius);
  if (!near.length) return [];
  let live: Awaited<ReturnType<typeof ntpcLive>> | null = null;
  try {
    live = await ntpcLive();
  } catch (e) {
    entry.error = `即時空位暫時無法取得（${e instanceof Error ? e.message : String(e)}）`;
  }
  return near.map(({ p, d }) => {
    const lot = extraLot(p, "NTPC", "NewTaipei", d);
    if (!live) lot.live = "unavailable";
    else if (p.id in live.byId) {
      const n = live.byId[p.id];
      lot.live = n == null ? "none" : "ok";
      lot.car = n == null ? null : count(n, p.total);
      lot.liveTime = n == null ? null : live.fetchedAt;
      lot.liveTimeIsFetch = true;
    }
    return lot;
  });
}

async function osmNear(env: Env, origin: string, lat: number, lon: number, radius: number, extra: ParkingResponse["extra"]): Promise<ParkingLot[]> {
  const entry: ParkingResponse["extra"][number] = { source: "OSM", name: "OpenStreetMap", status: "ok" };
  extra.push(entry);
  try {
    const { lots, osmTime } = await osmLots(env.ASSETS, origin, lat, lon, radius);
    entry.asOf = osmTime ?? undefined;
    return lots
      .map((p) => ({ p, d: metres(lat, lon, p.lat, p.lon) }))
      .filter((x) => x.d <= radius)
      .map(({ p, d }) => extraLot(p, "OSM", "", d));
  } catch (e) {
    entry.status = "error";
    entry.error = e instanceof Error ? e.message : String(e);
    return [];
  }
}

/** Points this close are taken to be the same car park, whatever their names. */
const SAME_PLACE_M = 30;

/** How much a record tells the driver; the richest one of a merged car park is shown. */
function richness(p: ParkingLot): number {
  const named = p.source !== "OSM" || p.name !== "停車場（未命名）";
  return (
    (p.live === "ok" && (p.car || p.spaces) ? 8 : 0) +
    (p.fareEstimate ? 4 : p.fare && !/^依現場/.test(p.fare) ? 2 : 0) +
    (named ? 2 : 0) +
    (p.address ? 1 : 0) +
    (p.description ? 1 : 0) +
    (p.source === "OSM" ? 0 : 0.5) // tie: prefer the official record
  );
}

/**
 * One pin per car park. Records from different sources within 30 m are merged: the richest
 * record is kept and blanks in it are filled from the others. Two records from the same source
 * are never merged (a source lists neighbouring car parks separately on purpose).
 */
function merge(all: ParkingLot[]): ParkingLot[] {
  const ranked = [...all].sort((a, b) => richness(b) - richness(a));
  const out: ParkingLot[] = [];
  for (const p of ranked) {
    const same = out.find((q) => !q.sources.includes(p.source) && metres(q.lat, q.lon, p.lat, p.lon) <= SAME_PLACE_M);
    if (!same) {
      out.push({ ...p, sources: [...p.sources] });
      continue;
    }
    same.sources.push(p.source);
    if (same.source === "OSM" && same.name === "停車場（未命名）" && p.name !== "停車場（未命名）") same.name = p.name;
    if (!same.address && p.address) same.address = p.address;
    if (!same.fare && p.fare) (same.fare = p.fare), (same.fareEstimate = p.fareEstimate);
    if (!same.description && p.description) same.description = p.description;
    if (!same.note && p.note) same.note = p.note;
  }
  return out;
}

// ---------- Place search ----------

const ADDRESS_LIKE = /\d+\s*號|[路街道]\s*\d|段|巷|弄/;

function point(geometry: unknown): { lat: number; lon: number } | null {
  const m = /POINT\s*\(\s*([\d.]+)\s+([\d.]+)\s*\)/.exec(String(geometry ?? ""));
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : null;
}

const HAS_CITY = /^[臺台]?\S{1,2}[市縣]/;

/**
 * TDX's geocoder: good for addresses, stations and landmarks; it has almost no shops. Its
 * address search fails (503) without a city, so `city` (where the map is) is put in front of
 * an address that doesn't name one.
 */
function tdxPlaces(env: Env, q: string, city: string | null): Promise<GeoHit[]> {
  const address = city && !HAS_CITY.test(q) ? city + q : q;
  return cached(`geocode:${q}:${address}`, 7 * 86400, async () => {
    const byAddress = async () =>
      rows(
        await tdx(env, `/api/advanced/V3/Map/GeoCode/Coordinate/Address/${encodeURIComponent(address)}`).catch((e) =>
          // "該API服務失效": what it answers for an address it can't parse.
          e instanceof Error && /TDX 503/.test(e.message) ? [] : notFoundIsEmpty(e),
        ),
      );
    const byName = async () =>
      rows(await tdx(env, `/api/advanced/V3/Map/GeoCode/Coordinate/Markname/${encodeURIComponent(q)}`).catch(notFoundIsEmpty));
    const first = ADDRESS_LIKE.test(q) ? byAddress : byName;
    const second = first === byAddress ? byName : byAddress;
    let found = await first();
    if (!found.length) found = await second();
    const hits: GeoHit[] = [];
    for (const r of found) {
      const pt = point(r.Geometry);
      if (!pt) continue;
      const address = String(r.Address ?? "").trim();
      hits.push({ name: String(r.Name ?? "").trim() || address, address, ...pt, source: "TDX" });
      if (hits.length >= 20) break;
    }
    return hits;
  });
}

// OpenStreetMap's Nominatim, for shops and chains ("麥當勞"). Its usage policy: at most one
// request a second, an identifying User-Agent, cache results, no search-as-you-type. All
// /api/geocode requests go through the single TdxGate object, so this throttle is global.
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_UA = "TaiwanDashboard/1.0 (+https://dashboard.jasonlinkai.workers.dev)";
let nominatimLast = 0;

async function nominatim(params: Record<string, string>): Promise<any[]> {
  const wait = nominatimLast + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  nominatimLast = Date.now();
  const qs = new URLSearchParams({ format: "jsonv2", countrycodes: "tw", addressdetails: "1", "accept-language": "zh-TW", ...params });
  const res = await fetch(`${NOMINATIM}?${qs}`, {
    headers: { "User-Agent": NOMINATIM_UA, Referer: "https://dashboard.jasonlinkai.workers.dev/" },
  });
  if (!res.ok) throw new Error(`OpenStreetMap ${res.status}`);
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

function osmAddress(a: any): string {
  if (!a || typeof a !== "object") return "";
  const no = a.house_number ? (/號$/.test(a.house_number) ? a.house_number : `${a.house_number}號`) : "";
  return [a.city ?? a.county ?? a.state ?? "", a.suburb ?? a.town ?? a.city_district ?? a.village ?? "", a.road ?? "", no].join("");
}

/** Within about 6 km of `near` first (so "麥當勞" means the nearby branches); all Taiwan if none. */
function osmPlaces(q: string, near: { lat: number; lon: number } | null): Promise<GeoHit[]> {
  // OSM rarely has house numbers here: for an address, an all-Taiwan fallback only finds
  // look-alikes far away (e.g. "福祿1號公園" for 市府路1號), so stay near.
  const fallback = !(near && ADDRESS_LIKE.test(q));
  const key = near ? `${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : "tw";
  return cached(`geocode-osm2:${q}:${key}`, 7 * 86400, async () => {
    let found: any[] = [];
    if (near) {
      const box = [near.lon - 0.07, near.lat + 0.06, near.lon + 0.07, near.lat - 0.06].map((v) => v.toFixed(4)).join(",");
      found = await nominatim({ q, limit: "40", viewbox: box, bounded: "1" });
    }
    if (!found.length && fallback) found = await nominatim({ q, limit: "20" });
    return found
      .map((x): GeoHit => ({
        name: String(x.name || String(x.display_name ?? "").split(",")[0]).trim(),
        address: osmAddress(x.address),
        lat: Number(x.lat),
        lon: Number(x.lon),
        source: "OSM",
      }))
      .filter((h) => h.name && Number.isFinite(h.lat) && Number.isFinite(h.lon));
  });
}

/**
 * Text → places to choose from, from TDX and OpenStreetMap together (either may fail or find
 * nothing; that's only an error if both do). With `near` (the map's centre), nearest first.
 */
export async function geocode(env: Env, raw: string, near: { lat: number; lon: number } | null): Promise<GeoResponse> {
  const q = raw.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!q) return { hits: [], nearby: Boolean(near), errors: [] };
  if (near && !(near.lat > 21 && near.lat < 27 && near.lon > 118 && near.lon < 123)) near = null;
  const city = near ? (CITY_NAME.get(citiesNear(near.lat, near.lon, 0)[0] ?? "") ?? null) : null;
  const [tdxRes, osmRes] = await Promise.allSettled([tdxPlaces(env, q, city), osmPlaces(q, near)]);
  const errors: string[] = [];
  const hits: GeoHit[] = [];
  for (const [name, r] of [["TDX", tdxRes], ["OpenStreetMap", osmRes]] as const) {
    // Copies: the cached arrays are shared with later requests, which have their own `near`.
    if (r.status === "fulfilled") hits.push(...r.value.map((h) => ({ ...h })));
    else errors.push(`${name}：${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
  }
  if (!hits.length && errors.length === 2) throw new Error(`地點搜尋失敗（${errors.join("；")}）`);
  if (near) for (const h of hits) h.distance = metres(near.lat, near.lon, h.lat, h.lon);
  // The same place from both sources (or twice from one): keep the first.
  const unique = hits.filter((h, i) => !hits.slice(0, i).some((o) => o.name === h.name && metres(o.lat, o.lon, h.lat, h.lon) < 60));
  if (near) unique.sort((a, b) => a.distance! - b.distance!);
  return { hits: unique.slice(0, 15), nearby: Boolean(near), errors };
}

function notFoundIsEmpty(e: unknown): unknown[] {
  if (e instanceof Error && /TDX 404/.test(e.message)) return [];
  throw e;
}
