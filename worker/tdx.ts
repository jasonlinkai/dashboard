import { type BusRouteInfo, type BusTrip, isBusCity } from "../src/bus-cities";
import type { BusArrival, BusResponse, TrainDeparture, TrainResponse } from "../src/shared";
import { type Env, type TdxCreds, cached, rows, taipeiNow, tdxCreds } from "./util";

const API = "https://tdx.transportdata.tw/api/basic";

// Only settled values are kept across requests: workerd can't resume a request that awaits
// a promise or timer created by a different (possibly finished) request.
// Everything below is per key: the site's own, or a visitor's own key sent with the request.
const tokens = new Map<string, { value: string; expires: number }>();

function credsFor(env: Env): TdxCreds | null {
  const own = tdxCreds.getStore();
  if (own) return own;
  return env.TDX_CLIENT_ID && env.TDX_CLIENT_SECRET ? { id: env.TDX_CLIENT_ID, secret: env.TDX_CLIENT_SECRET } : null;
}

async function accessToken(creds: TdxCreds, own: boolean): Promise<string> {
  const hit = tokens.get(creds.id);
  if (hit && hit.expires > Date.now() && tokens.get(creds.id + "#secret")?.value === creds.secret) return hit.value;
  const res = await fetch("https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: creds.id, client_secret: creds.secret }),
  });
  if (!res.ok) throw new Error(own ? "你的 TDX 金鑰無法登入，請到設定檢查" : `TDX 登入失敗 (${res.status})，請檢查金鑰`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  const expires = Date.now() + (body.expires_in - 300) * 1000;
  tokens.set(creds.id, { value: body.access_token, expires });
  // Remember which secret this token belongs to, so a changed secret is checked again.
  tokens.set(creds.id + "#secret", { value: creds.secret, expires });
  return body.access_token;
}

/** Logs in with the visitor's key without spending any of its per-minute quota. */
export async function checkCreds(env: Env): Promise<{ ok: true }> {
  const creds = tdxCreds.getStore();
  if (!creds) throw new Error("沒有收到金鑰");
  tokens.delete(creds.id); // always really try
  await accessToken(creds, true);
  return { ok: true };
}

// A key is limited to 5 calls per minute across *all* TDX endpoints. Stay under it locally
// so we never burn the minute on 429s; callers fall back to their last cached value.
const BUDGET_PER_MIN = 4;
const recentCalls = new Map<string, number[]>();

/** `path` is under /api/basic unless it starts with /api/ (e.g. /api/advanced/V3/Map/...). */
export async function tdx(env: Env, path: string, query: Record<string, string> = {}): Promise<unknown> {
  const creds = credsFor(env);
  if (!creds) throw new Error("尚未設定 TDX 金鑰");
  const own = Boolean(tdxCreds.getStore());
  const now = Date.now();
  const recent = recentCalls.get(creds.id) ?? [];
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  recentCalls.set(creds.id, recent);
  const full = own ? "你的 TDX 金鑰每分鐘查詢額度已滿，稍後自動更新" : "TDX 每分鐘查詢額度已滿，稍後自動更新";
  if (recent.length >= BUDGET_PER_MIN) throw new Error(full);
  const auth = await accessToken(creds, own);
  recent.push(now);
  const qs = new URLSearchParams({ ...query, $format: "JSON" });
  const res = await fetch(`${path.startsWith("/api/") ? API.replace("/api/basic", "") : API}${path}?${qs}`, {
    headers: { Authorization: `Bearer ${auth}`, "Accept-Encoding": "br, gzip" },
  });
  if (res.status === 429) throw new Error(full);
  if (!res.ok) throw new Error(`TDX ${res.status}`);
  return res.json();
}

export const tdxConfigured = (env: Env) => Boolean(tdxCreds.getStore() || (env.TDX_CLIENT_ID && env.TDX_CLIENT_SECRET));

const zh = (v: any): string => v?.Zh_tw ?? "";
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

// ---------- Bus ----------

export interface BusQuery {
  city: string; // TDX city code, e.g. NewTaipei
  route: string;
  stop: string;
  /** Only boardings heading toward this stop (it must come later on the same trip). */
  toward?: string;
}

const queryKey = (q: BusQuery) => `${q.route}:${q.stop}:${q.toward ?? ""}`;

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

/**
 * Daily lookup (2 calls per city): headsign per direction, and which physical stops (StopUID)
 * each configured stop means. Stop names on signs often differ (樟樹實中 → 樟樹國際實中, 南港車站 →
 * 南港行政中心(南港車站)), so when no stop on the route has the exact name we accept a name
 * containing every configured character in order. With `toward`, a stop only counts where that
 * stop comes later on the same trip: loop routes pass a stop twice, once each way.
 */
function routeInfo(env: Env, city: string, queries: BusQuery[]) {
  const routes = [...new Set(queries.map((q) => q.route))];
  const filter = routes.map((r) => `RouteName/Zh_tw eq ${quote(r)}`).join(" or ");
  return cached(`routes2:${city}:${queries.map(queryKey).join(",")}`, 86400, async () => {
    const routeRows = rows(await tdx(env, `/v2/Bus/Route/City/${city}`, { $filter: filter }));
    const stopRows = rows(await tdx(env, `/v2/Bus/StopOfRoute/City/${city}`, { $filter: filter }));
    const headsigns: Record<string, Record<number, string>> = {};
    const routeIds: Record<string, string> = {};
    for (const r of routeRows) {
      routeIds[zh(r.RouteName)] ??= String(r.RouteID ?? "");
      const h = (headsigns[zh(r.RouteName)] ??= {});
      h[0] ??= `往 ${r.DestinationStopNameZh ?? ""}`;
      h[1] ??= `往 ${r.DepartureStopNameZh ?? ""}`;
    }
    /** queryKey → StopUIDs to ask for */
    const stopUids: Record<string, string[]> = {};
    for (const q of queries) {
      const trips = stopRows.filter((r) => zh(r.RouteName) === q.route).map((r) => (r.Stops ?? []) as any[]);
      // Stops (by UID) that match the name and, with `toward`, still have it ahead on the trip.
      const pick = (matches: (name: string) => boolean) => {
        const uids = new Set<string>();
        for (const stops of trips)
          stops.forEach((s, i) => {
            if (!matches(zh(s.StopName))) return;
            if (q.toward && !stops.slice(i + 1).some((t) => zh(t.StopName) === q.toward)) return;
            uids.add(String(s.StopUID));
          });
        return uids;
      };
      // 590's last stop is literally 南港車站, but buses toward 日月光 leave from 南港行政中心(南港車站).
      let uids = pick((n) => n === q.stop);
      if (!uids.size) uids = pick((n) => isSubsequence(q.stop, n));
      stopUids[queryKey(q)] = [...uids];
    }
    return { headsigns, routeIds, stopUids };
  });
}

const STOP_STATUS: Record<number, string> = { 1: "尚未發車", 2: "交管不停靠", 3: "末班車已過", 4: "今日未營運" };

function hhmm(iso: string | undefined): string | null {
  const m = iso?.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

async function busCity(env: Env, city: string, queries: BusQuery[]) {
  const { headsigns, routeIds, stopUids } = await routeInfo(env, city, queries);
  const found = queries.filter((q) => stopUids[queryKey(q)]?.length);
  const notFound = queries.filter((q) => !stopUids[queryKey(q)]?.length).map((q) => `${q.route}:${q.stop}`);
  if (!found.length) return { arrivals: [], notFound };
  // Which query (for its "toward") each requested stop belongs to.
  const towardOf = new Map<string, string | undefined>();
  for (const q of found) for (const uid of stopUids[queryKey(q)]) towardOf.set(`${q.route}|${uid}`, q.toward);

  // One call covers every configured route/stop pair.
  const filter = found
    .map((q) => `(RouteName/Zh_tw eq ${quote(q.route)} and (${stopUids[queryKey(q)].map((u) => `StopUID eq ${quote(u)}`).join(" or ")}))`)
    .join(" or ");
  const etas = await cached(`eta:${city}:${filter}`, 50, async () => {
    const fetchedAt = Date.now();
    return rows(await tdx(env, `/v2/Bus/EstimatedTimeOfArrival/City/${city}`, { $filter: filter })).map((e) => ({
      ...e,
      asOf: Date.parse(e.SrcUpdateTime ?? e.UpdateTime ?? "") || fetchedAt,
    }));
  });
  const all = etas.map((e): BusArrival => {
    const route = zh(e.RouteName);
    const toward = towardOf.get(`${route}|${e.StopUID}`);
    const next = hhmm(e.NextBusTime);
    const hasEstimate = typeof e.EstimateTime === "number";
    // TDX often sends an estimate together with 尚未發車 (from the timetable): keep both, so the
    // dashboard doesn't count it down as if the bus were on its way.
    const status = STOP_STATUS[e.StopStatus] ?? (hasEstimate ? null : "暫無資料");
    return {
      city,
      route,
      routeId: routeIds[route] ?? String(e.RouteID ?? ""),
      stop: zh(e.StopName),
      direction: e.Direction,
      // A loop route's own terminus says nothing about where this rider is going.
      headsign: toward ? `往 ${toward}` : (headsigns[route]?.[e.Direction] ?? ""),
      toward: toward ?? null,
      estimateSec: hasEstimate ? e.EstimateTime : null,
      asOf: e.asOf,
      status: status === "尚未發車" && next ? `${next} 發車` : status,
      lastBus: e.IsLastBus === true,
    };
  });
  // Loop routes (590, F913 in 日月光社區) pass the same stop twice per trip, and sub-routes
  // add more rows: keep only the soonest bus per route, direction and stop.
  const soonest = new Map<string, BusArrival>();
  for (const a of all) {
    const key = `${a.route}|${a.direction}|${a.stop}`;
    const prev = soonest.get(key);
    if (!prev || (a.estimateSec != null && (prev.estimateSec == null || a.estimateSec < prev.estimateSec))) soonest.set(key, a);
  }
  return { arrivals: [...soonest.values()], notFound };
}

export async function bus(env: Env, queries: BusQuery[]): Promise<BusResponse> {
  if (!tdxConfigured(env)) return { configured: false, arrivals: [], notFound: [] };
  const out: BusResponse = { configured: true, arrivals: [], notFound: [] };
  for (const city of new Set(queries.map((q) => q.city))) {
    const r = await busCity(env, city, queries.filter((q) => q.city === city));
    out.arrivals.push(...r.arrivals);
    out.notFound.push(...r.notFound);
  }
  return out;
}

// ---------- Bus route search (settings screen) ----------

/** Every route in a city, for searching by name. One call per city per day. */
export async function busRoutes(env: Env, city: string): Promise<BusRouteInfo[]> {
  if (!isBusCity(city)) throw new Error("不支援的縣市");
  return cached(`busroutes:${city}`, 86400, async () => {
    const seen = new Set<string>();
    return rows(await tdx(env, `/v2/Bus/Route/City/${city}`, { $select: "RouteName,DepartureStopNameZh,DestinationStopNameZh" }))
      .map((r): BusRouteInfo => ({ name: zh(r.RouteName), from: r.DepartureStopNameZh ?? "", to: r.DestinationStopNameZh ?? "" }))
      .filter((r) => r.name && !seen.has(r.name) && seen.add(r.name))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }));
  });
}

/** A route's trips (each direction / sub-route) with their stops in order. One call per route per day. */
export async function busTrips(env: Env, city: string, route: string): Promise<BusTrip[]> {
  if (!isBusCity(city)) throw new Error("不支援的縣市");
  if (!route || route.length > 20) throw new Error("路線名稱不正確");
  return cached(`bustrips:${city}:${route}`, 86400, async () =>
    rows(await tdx(env, `/v2/Bus/StopOfRoute/City/${city}`, { $filter: `RouteName/Zh_tw eq ${quote(route)}` }))
      .filter((r) => zh(r.RouteName) === route)
      .map(
        (r): BusTrip => ({
          direction: r.Direction,
          subRoute: zh(r.SubRouteName),
          stops: ((r.Stops ?? []) as any[]).map((s) => zh(s.StopName)),
        }),
      )
      .filter((t) => t.stops.length > 1),
  );
}

// ---------- Train (TRA) ----------

const norm = (s: string) => s.replace(/台/g, "臺").replace(/(車?站)$/, "");

// Stored as a small name → id table (it is also persisted, so keep it compact).
const stationIds = (env: Env): Promise<Record<string, string>> =>
  cached("stations", 86400, async () =>
    Object.fromEntries(rows(await tdx(env, "/v3/Rail/TRA/Station")).map((x) => [norm(zh(x.StationName)), String(x.StationID)])),
  );

/** All 臺鐵 station names, for the settings screen's station picker. */
export async function stationNames(env: Env): Promise<string[]> {
  if (!tdxConfigured(env)) return [];
  return Object.keys(await stationIds(env));
}

async function stationId(env: Env, name: string): Promise<string> {
  const ids = await stationIds(env);
  const id = ids[norm(name)];
  if (!id) throw new Error(`找不到車站 ${name}`);
  return id;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

type Scheduled = Omit<TrainDeparture, "delayMin" | "cancelled" | "platform">;

export async function train(env: Env, from: string, to: string, typeKeyword: string, limit: number): Promise<TrainResponse> {
  const base: TrainResponse = { configured: tdxConfigured(env), from, to, trains: [], alerts: null };
  if (!base.configured) return base;
  const fromId = await stationId(env, from);
  const toId = await stationId(env, to);
  const { date, minutes } = taipeiNow();

  // The day's timetable doesn't change: one call per day, reduced to the fields we show.
  const timetable = await cached(`tt:${fromId}:${toId}:${date}`, 86400, async () =>
    rows(await tdx(env, `/v3/Rail/TRA/DailyTrainTimetable/OD/${fromId}/to/${toId}/${date}`)).flatMap((t): Scheduled[] => {
      const stops: any[] = t.StopTimes ?? [];
      const dep = stops.find((s) => s.StationID === fromId);
      const arr = stops.find((s) => s.StationID === toId);
      if (!dep || !arr) return [];
      return [
        {
          trainNo: String(t.TrainInfo.TrainNo),
          type: zh(t.TrainInfo.TrainTypeName).replace(/\(.*\)/, ""),
          departure: dep.DepartureTime,
          arrival: arr.ArrivalTime,
          endingStation: zh(t.TrainInfo.EndingStationName),
        },
      ];
    }),
  );
  // Live data is best-effort: if it's unavailable the timetable still shows (as 無即時資訊).
  // Delays: every running train nationwide in one call, so small stations (汐科 has no station
  // board) are covered too, and all routes share it.
  const delays = new Map<string, number>();
  try {
    const running = await cached("tra:trains", 55, async () =>
      rows(await tdx(env, "/v3/Rail/TRA/TrainLiveBoard")).map((t) => [String(t.TrainNo), t.DelayTime] as const),
    );
    for (const [no, delay] of running) if (typeof delay === "number") delays.set(no, delay);
  } catch {}
  // 停駛 and platforms only exist on station boards, which TDX publishes for larger stations only.
  const board = new Map<string, { cancelled: boolean; platform: string | null }>();
  try {
    const live = await cached(`live:${fromId}`, 55, async () =>
      rows(await tdx(env, `/v3/Rail/TRA/StationLiveBoard/Station/${fromId}`)).map((t) => ({
        trainNo: String(t.TrainNo),
        // RunningStatus: 0 準點, 1 誤點, 2 取消（停駛）
        cancelled: t.RunningStatus === 2,
        platform: t.Platform ? String(t.Platform) : null,
        delay: typeof t.DelayTime === "number" ? t.DelayTime : null,
      })),
    );
    for (const t of live) {
      board.set(t.trainNo, { cancelled: t.cancelled, platform: t.platform });
      if (t.delay != null && !delays.has(t.trainNo)) delays.set(t.trainNo, t.delay);
    }
  } catch {}
  // Line-wide notices (typhoons, accidents, suspended sections). One call covers all of 臺鐵.
  try {
    base.alerts = await cached("tra:alerts", 300, async () =>
      rows(await tdx(env, "/v3/Rail/TRA/Alert"))
        .filter((a) => a.Status !== 1) // 1 = 全線營運正常
        .map((a) => [a.Title, a.Description].filter(Boolean).join("：")),
    );
  } catch {}

  base.trains = timetable
    .filter((t) => t.type.includes(typeKeyword))
    .map((t): TrainDeparture => {
      const b = board.get(t.trainNo);
      return { ...t, delayMin: delays.get(t.trainNo) ?? null, cancelled: b?.cancelled ?? false, platform: b?.platform ?? null };
    })
    .filter((t) => toMin(t.departure) + (t.delayMin ?? 0) >= minutes)
    .sort((a, b) => toMin(a.departure) - toMin(b.departure))
    .slice(0, limit);
  return base;
}
