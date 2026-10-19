import type { BusArrival, BusResponse, TrainDeparture, TrainResponse } from "../src/shared";
import { type Env, cached, rows, taipeiNow } from "./util";

const API = "https://tdx.transportdata.tw/api/basic";

// Only settled values are kept across requests: workerd can't resume a request that awaits
// a promise or timer created by a different (possibly finished) request.
let token: { value: string; expires: number } | null = null;

async function accessToken(env: Env): Promise<string> {
  if (token && token.expires > Date.now()) return token.value;
  const res = await fetch("https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.TDX_CLIENT_ID!,
      client_secret: env.TDX_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`TDX 登入失敗 (${res.status})，請檢查金鑰`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expires: Date.now() + (body.expires_in - 300) * 1000 };
  return token.value;
}

// The key is limited to 5 calls per minute across *all* TDX endpoints. Stay under it locally
// so we never burn the minute on 429s; callers fall back to their last cached value.
const BUDGET_PER_MIN = 4;
const recentCalls: number[] = [];

async function tdx(env: Env, path: string, query: Record<string, string> = {}): Promise<unknown> {
  const now = Date.now();
  while (recentCalls.length && now - recentCalls[0] > 60_000) recentCalls.shift();
  if (recentCalls.length >= BUDGET_PER_MIN) throw new Error("TDX 每分鐘查詢額度已滿，稍後自動更新");
  const auth = await accessToken(env);
  recentCalls.push(now);
  const qs = new URLSearchParams({ ...query, $format: "JSON" });
  const res = await fetch(`${API}${path}?${qs}`, {
    headers: { Authorization: `Bearer ${auth}`, "Accept-Encoding": "br, gzip" },
  });
  if (res.status === 429) throw new Error("TDX 每分鐘查詢額度已滿，稍後自動更新");
  if (!res.ok) throw new Error(`TDX ${res.status}`);
  return res.json();
}

export const tdxConfigured = (env: Env) => Boolean(env.TDX_CLIENT_ID && env.TDX_CLIENT_SECRET);

const zh = (v: any): string => v?.Zh_tw ?? "";
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

// ---------- Bus ----------

export interface BusQuery {
  city: string; // TDX city code, e.g. NewTaipei
  route: string;
  stop: string;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

/**
 * Daily lookup (2 calls per city): headsign per direction, and the exact TDX spelling of each
 * configured stop. Stop names on signs often differ (樟樹實中 → 樟樹國際實中), so when there is
 * no exact match we accept a name containing every configured character in order.
 */
function routeInfo(env: Env, city: string, queries: BusQuery[]) {
  const routes = [...new Set(queries.map((q) => q.route))];
  const filter = routes.map((r) => `RouteName/Zh_tw eq ${quote(r)}`).join(" or ");
  return cached(`routes:${city}:${routes.join(",")}`, 86400, async () => {
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
    const stopNames: Record<string, string | null> = {};
    for (const q of queries) {
      const names = new Set<string>();
      for (const r of stopRows) if (zh(r.RouteName) === q.route) for (const s of r.Stops ?? []) names.add(zh(s.StopName));
      const all = [...names];
      stopNames[`${q.route}:${q.stop}`] = all.find((n) => n === q.stop) ?? all.find((n) => isSubsequence(q.stop, n)) ?? null;
    }
    return { headsigns, routeIds, stopNames };
  });
}

const STOP_STATUS: Record<number, string> = { 1: "尚未發車", 2: "交管不停靠", 3: "末班車已過", 4: "今日未營運" };

function hhmm(iso: string | undefined): string | null {
  const m = iso?.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

async function busCity(env: Env, city: string, queries: BusQuery[]) {
  const { headsigns, routeIds, stopNames } = await routeInfo(env, city, queries);
  const found = queries.filter((q) => stopNames[`${q.route}:${q.stop}`]);
  const notFound = queries.filter((q) => !stopNames[`${q.route}:${q.stop}`]).map((q) => `${q.route}:${q.stop}`);
  if (!found.length) return { arrivals: [], notFound };

  // One call covers every configured route/stop pair.
  const filter = found
    .map((q) => `(RouteName/Zh_tw eq ${quote(q.route)} and StopName/Zh_tw eq ${quote(stopNames[`${q.route}:${q.stop}`]!)})`)
    .join(" or ");
  const etas = await cached(`eta:${city}:${filter}`, 50, async () => {
    const fetchedAt = Date.now();
    return rows(await tdx(env, `/v2/Bus/EstimatedTimeOfArrival/City/${city}`, { $filter: filter })).map((e) => ({
      ...e,
      asOf: Date.parse(e.SrcUpdateTime ?? e.UpdateTime ?? "") || fetchedAt,
    }));
  });
  const arrivals = etas.map((e): BusArrival => {
    const route = zh(e.RouteName);
    const next = hhmm(e.NextBusTime);
    const hasEstimate = typeof e.EstimateTime === "number";
    const status = hasEstimate ? null : (STOP_STATUS[e.StopStatus] ?? "暫無資料");
    return {
      route,
      routeId: routeIds[route] ?? String(e.RouteID ?? ""),
      stop: zh(e.StopName),
      direction: e.Direction,
      headsign: headsigns[route]?.[e.Direction] ?? "",
      estimateSec: hasEstimate ? e.EstimateTime : null,
      asOf: e.asOf,
      status: status === "尚未發車" && next ? `${next} 發車` : status,
    };
  });
  return { arrivals, notFound };
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

// ---------- Train (TRA) ----------

const norm = (s: string) => s.replace(/台/g, "臺").replace(/(車?站)$/, "");

async function stationId(env: Env, name: string): Promise<string> {
  const all = await cached("stations", 86400, async () => rows(await tdx(env, "/v3/Rail/TRA/Station")));
  const s = all.find((x) => norm(zh(x.StationName)) === norm(name));
  if (!s) throw new Error(`找不到車站 ${name}`);
  return s.StationID as string;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export async function train(env: Env, from: string, to: string, typeKeyword: string, limit: number): Promise<TrainResponse> {
  const base = { configured: tdxConfigured(env), from, to, trains: [] as TrainDeparture[] };
  if (!base.configured) return base;
  const fromId = await stationId(env, from);
  const toId = await stationId(env, to);
  const { date, minutes } = taipeiNow();

  // The day's timetable doesn't change, so it costs one call per day.
  const timetable = await cached(`tt:${fromId}:${toId}:${date}`, 86400, async () =>
    rows(await tdx(env, `/v3/Rail/TRA/DailyTrainTimetable/OD/${fromId}/to/${toId}/${date}`)),
  );
  // Live delays are best-effort: if they're unavailable the timetable still shows.
  const delays = new Map<string, number>();
  try {
    const live = await cached(`live:${fromId}`, 55, async () => rows(await tdx(env, `/v3/Rail/TRA/StationLiveBoard/Station/${fromId}`)));
    for (const t of live) if (typeof t.DelayTime === "number") delays.set(String(t.TrainNo), t.DelayTime);
  } catch {}

  base.trains = timetable
    .filter((t) => zh(t.TrainInfo?.TrainTypeName).includes(typeKeyword))
    .map((t): TrainDeparture | null => {
      const stops: any[] = t.StopTimes ?? [];
      const dep = stops.find((s) => s.StationID === fromId);
      const arr = stops.find((s) => s.StationID === toId);
      if (!dep || !arr) return null;
      const no = String(t.TrainInfo.TrainNo);
      return {
        trainNo: no,
        type: zh(t.TrainInfo.TrainTypeName).replace(/\(.*\)/, ""),
        departure: dep.DepartureTime,
        arrival: arr.ArrivalTime,
        endingStation: zh(t.TrainInfo.EndingStationName),
        delayMin: delays.get(no) ?? null,
      };
    })
    .filter((t): t is TrainDeparture => t !== null && toMin(t.departure) + (t.delayMin ?? 0) >= minutes)
    .sort((a, b) => toMin(a.departure) - toMin(b.departure))
    .slice(0, limit);
  return base;
}
