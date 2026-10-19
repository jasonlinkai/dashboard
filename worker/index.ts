import { observations } from "./cwa";
import { news, quotes } from "./markets";
import { bus, train } from "./tdx";
import { type Env, type Freshness, freshness } from "./util";

function json(body: unknown, status = 200) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  const f = freshness.getStore();
  if (f && Number.isFinite(f.oldest)) headers.set("X-Data-Time", String(f.oldest));
  if (f?.stale) headers.set("X-Data-Stale", "1");
  return new Response(JSON.stringify(body), { status, headers });
}

const list = (v: string | null) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export default {
  fetch(request, env): Promise<Response> {
    const f: Freshness = { oldest: Infinity, stale: false };
    return freshness.run(f, () => handle(request, env));
  },
} satisfies ExportedHandler<Env>;

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams;
  try {
    switch (url.pathname) {
      case "/api/quotes":
        return json(await quotes(list(q.get("symbols")).slice(0, 20)));
      case "/api/news":
        return json(await news(q.get("topic") ?? "top"));
      case "/api/bus": {
        // routes=NewTaipei:藍23:忠孝里,NewTaipei:藍39:樟樹實中
        const queries = list(q.get("routes"))
          .map((p) => p.split(":"))
          .filter((p) => p.length === 3)
          .map(([city, route, stop]) => ({ city, route, stop }));
        return json(await bus(env, queries.slice(0, 6)));
      }
      case "/api/train":
        return json(await train(env, q.get("from") ?? "", q.get("to") ?? "臺北", q.get("type") ?? "區間", Number(q.get("limit") ?? 6)));
      case "/api/observations":
        return json(await observations(env));
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(request);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
}
