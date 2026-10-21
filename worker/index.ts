import { DurableObject } from "cloudflare:workers";
import { observations } from "./cwa";
import { news, quotes, searchSymbols } from "./markets";
import { geocode, parking } from "./parking";
import { MAX_BUS_CITIES, isBusCity } from "../src/bus-cities";
import { bus, busRoute, busRoutes, busTrips, checkCreds, stationNames, train } from "./tdx";
import { type Env, type Freshness, freshness, setPersistentStore, type TdxCreds, tdxCreds } from "./util";

function json(body: unknown, status = 200) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  const f = freshness.getStore();
  if (f && Number.isFinite(f.oldest)) headers.set("X-Data-Time", String(f.oldest));
  if (f?.stale) headers.set("X-Data-Stale", "1");
  return new Response(JSON.stringify(body), { status, headers });
}

const list = (v: string | null) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function serve(request: Request, env: Env): Promise<Response> {
  const f: Freshness = { oldest: Infinity, stale: false };
  return freshness.run(f, () => handle(request, env));
}

// TDX allows 5 calls a minute per key. Cloudflare runs many short-lived copies of this Worker,
// each with its own cache and counter, which together blow through that. So every TDX request goes
// through one Durable Object: a single shared cache and rate counter, plus durable storage for the
// daily timetable / station list / route info.
const TDX_PATHS = new Set(["/api/bus", "/api/bus-routes", "/api/bus-trips", "/api/bus-route", "/api/train", "/api/stations", "/api/tdx-check", "/api/parking", "/api/geocode"]);

/**
 * A visitor's own TDX keys from the request headers (used for this request only, never stored):
 * X-TDX-Id / X-TDX-Secret, and optionally -2 and -3 (TDX lets a member create three keys).
 */
function ownCreds(request: Request): TdxCreds[] | null {
  const keys: TdxCreds[] = [];
  for (const suffix of ["", "-2", "-3"]) {
    const id = request.headers.get(`X-TDX-Id${suffix}`)?.trim();
    const secret = request.headers.get(`X-TDX-Secret${suffix}`)?.trim();
    if (!id || !secret || id.length > 200 || secret.length > 200 || keys.some((k) => k.id === id)) continue;
    keys.push({ id, secret });
  }
  return keys.length ? keys : null;
}

export class TdxGate extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    setPersistentStore(ctx.storage);
  }
  fetch(request: Request): Promise<Response> {
    return tdxCreds.run(ownCreds(request), () => serve(request, this.env));
  }
}

export default {
  fetch(request, env): Promise<Response> {
    if (TDX_PATHS.has(new URL(request.url).pathname)) {
      return env.TDX.get(env.TDX.idFromName("tdx")).fetch(request);
    }
    return serve(request, env);
  },
} satisfies ExportedHandler<Env>;

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams;
  try {
    switch (url.pathname) {
      case "/api/quotes":
        return json(await quotes(list(q.get("symbols")).slice(0, 20)));
      case "/api/symbol-search":
        return json(await searchSymbols(q.get("q") ?? ""));
      case "/api/news":
        return json(await news(q.get("topic") ?? "top", list(q.get("sources"))));
      case "/api/bus": {
        // routes=NewTaipei:藍23:忠孝里,NewTaipei:F913:汐科站北:日月光社區 (optional 4th: heading toward)
        const queries = list(q.get("routes"))
          .map((p) => p.split(":"))
          .filter((p) => p.length === 3 || p.length === 4)
          .map(([city, route, stop, toward]) => ({ city, route, stop, toward: toward || undefined }))
          .filter((x) => isBusCity(x.city));
        // Each city is one more TDX call a minute: only the first few cities are queried.
        const cities = [...new Set(queries.map((x) => x.city))].slice(0, MAX_BUS_CITIES);
        return json(await bus(env, queries.filter((x) => cities.includes(x.city)).slice(0, 10)));
      }
      case "/api/bus-routes":
        return json(await busRoutes(env, q.get("city") ?? ""));
      case "/api/bus-route":
        return json(await busRoute(env, q.get("city") ?? "", q.get("route") ?? ""));
      case "/api/bus-trips":
        return json(await busTrips(env, q.get("city") ?? "", q.get("route") ?? ""));
      case "/api/train":
        return json(await train(env, q.get("from") ?? "", q.get("to") ?? "臺北", q.get("type") ?? "區間", Number(q.get("limit") ?? 6)));
      case "/api/parking":
        return json(await parking(env, url.origin, Number(q.get("lat")), Number(q.get("lon")), Number(q.get("r") ?? 500)));
      case "/api/geocode":
        return json(
          await geocode(env, q.get("q") ?? "", q.has("lat") ? { lat: Number(q.get("lat")), lon: Number(q.get("lon")) } : null),
        );
      case "/api/tdx-check":
        return json(await checkCreds(env));
      case "/api/stations":
        return json(await stationNames(env));
      case "/api/observations":
        return json(await observations(env, list(q.get("towns"))));
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(request);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
}
