// Car parks near a point, from TDX (off-street car parks + live free spaces), and place search
// via TDX's geocoder. Live spaces exist only for some car parks; anything the source doesn't
// say (or says nonsense, like -1 spaces) is passed on as unknown, never guessed.

import towns from "../src/data/towns.json";
import { BUS_CITY_LIST } from "../src/bus-cities";
import { estimateFare } from "../src/parking-fare";
import type { GeoHit, ParkingLot, ParkingResponse } from "../src/shared";
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

export async function parking(env: Env, lat: number, lon: number, radius: number): Promise<ParkingResponse> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 21 || lat > 27 || lon < 118 || lon > 123)
    throw new Error("位置不在臺灣範圍內");
  if (!PARKING_RADII.includes(radius)) radius = 500;
  const cities = citiesNear(lat, lon, radius);
  const lots: ParkingLot[] = [];
  const status: ParkingResponse["cities"] = [];
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
  lots.sort((a, b) => a.distance - b.distance);
  return { center: { lat, lon }, radius, cities: status, lots };
}

// ---------- Place search ----------

const ADDRESS_LIKE = /\d+\s*號|[路街道]\s*\d|段|巷|弄/;

function point(geometry: unknown): { lat: number; lon: number } | null {
  const m = /POINT\s*\(\s*([\d.]+)\s+([\d.]+)\s*\)/.exec(String(geometry ?? ""));
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : null;
}

/**
 * Address ("市府路1號") or landmark name ("台北101") → candidates. Landmark search returns many
 * places containing the words, so the page lets the user pick instead of assuming the first.
 */
export async function geocode(env: Env, raw: string): Promise<GeoHit[]> {
  const q = raw.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!q) return [];
  return cached(`geocode:${q}`, 7 * 86400, async () => {
    const byAddress = async () =>
      rows(await tdx(env, `/api/advanced/V3/Map/GeoCode/Coordinate/Address/${encodeURIComponent(q)}`).catch(notFoundIsEmpty));
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
      hits.push({ name: String(r.Name ?? "").trim() || address, address, ...pt });
      if (hits.length >= 12) break;
    }
    return hits;
  });
}

function notFoundIsEmpty(e: unknown): unknown[] {
  if (e instanceof Error && /TDX 404/.test(e.message)) return [];
  throw e;
}
