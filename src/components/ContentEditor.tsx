import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BUS_CITY_NAME, type BusRouteInfo, type BusTrip, MAX_BUS_CITIES } from "../bus-cities";
import { NEWS_BY_ID, TOPICS, type Topic, sourcesFor } from "../news-sources";
import { tdxHeaders } from "../tdxKey";
import { toast } from "../toast";
import {
  BUS_CITIES,
  type BusCity,
  type BusStop,
  INSTRUMENT_CATALOG,
  LIMITS,
  type MarketItem,
  type Settings,
  TRAIN_TYPES,
  type WeatherPlace,
  instrumentOf,
  marketSymbol,
  useSettings,
} from "../settings";

// Same order as the board's tabs on a phone: 行情・天氣・交通（公車、火車）・新聞.
const SECTIONS = [
  ["markets", "行情"],
  ["weather", "天氣"],
  ["bus", "公車"],
  ["trains", "火車"],
  ["news", "新聞"],
] as const;
type Section = (typeof SECTIONS)[number][0];

/** Move item i by `by` places (drag can move several at once). */
const move = <T,>(list: T[], i: number, by: number): T[] => {
  const j = Math.max(0, Math.min(list.length - 1, i + by));
  if (j === i) return list;
  const out = [...list];
  const [item] = out.splice(i, 1);
  out.splice(j, 0, item);
  return out;
};
const without = <T,>(list: T[], i: number): T[] => list.filter((_, k) => k !== i);

/**
 * One row of an editable list: drag handle, label, remove. Drag the handle (mouse or touch) to
 * reorder; with the handle focused, the arrow keys move the row too.
 */
function Row({
  children,
  name,
  i,
  count,
  min = 0,
  onMove,
  onRemove,
}: {
  children: ReactNode;
  /** For the confirmation bubbles. */
  name: string;
  i: number;
  count: number;
  min?: number;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const liRef = useRef<HTMLLIElement>(null);
  const [dragging, setDragging] = useState(false);
  // Pointer events can arrive several times before React re-renders with the new order.
  const latest = useRef({ i, onMove });
  const startIndex = useRef(i);
  const grabY = useRef(0); // where in the row it was picked up
  const grabAt = useRef(0); // pointer y when picked up
  latest.current = { i, onMove };

  // Follow the pointer on window, not on the handle: reordering moves this row's DOM node, which
  // drops pointer capture, and the rest of the drag (and the release) would never arrive.
  useEffect(() => {
    if (!dragging) return;
    const li = liRef.current;
    /** Keep the lifted row under the finger, wherever its slot currently is. */
    const follow = (y: number) => {
      if (!liRef.current) return;
      liRef.current.style.transform = "";
      const slot = liRef.current.getBoundingClientRect();
      liRef.current.style.transform = `translateY(${y - grabY.current - slot.top}px) scale(1.03)`;
    };
    follow(grabAt.current);
    const drag = (e: PointerEvent) => {
      if (!liRef.current?.parentElement) return;
      e.preventDefault();
      const rows = [...liRef.current.parentElement.children] as HTMLElement[];
      // The row under the pointer, other than the one being carried.
      const to = rows.findIndex((r) => {
        if (r === liRef.current) return false;
        const b = r.getBoundingClientRect();
        return e.clientY >= b.top && e.clientY <= b.bottom;
      });
      if (to >= 0 && to !== latest.current.i) latest.current.onMove(to - latest.current.i);
      // Near the edge of the scrolling settings page: scroll so rows further away can be reached.
      const scroller = liRef.current.closest<HTMLElement>(".settings-body");
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        if (e.clientY < box.top + 40) scroller.scrollBy(0, -12);
        else if (e.clientY > box.bottom - 40) scroller.scrollBy(0, 12);
      }
      const y = e.clientY;
      requestAnimationFrame(() => follow(y)); // after React has moved the row
    };
    // Once dragging, the finger must not scroll the settings page underneath.
    const touchMove = (e: TouchEvent) => e.preventDefault();
    window.addEventListener("touchmove", touchMove, { passive: false });
    const end = () => {
      if (li) li.style.transform = "";
      setDragging(false);
      if (latest.current.i !== startIndex.current) toast(`已將「${name}」移到第 ${latest.current.i + 1} 個`);
    };
    window.addEventListener("pointermove", drag, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", drag);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("touchmove", touchMove);
    };
  }, [dragging]);

  return (
    <li ref={liRef} className={`ed-row ${dragging ? "ed-dragging" : ""}`}>
      <button
        className="ed-handle"
        aria-label="拖曳排序（也可用上下鍵）"
        disabled={count < 2}
        onPointerDown={(e) => {
          e.preventDefault();
          startIndex.current = i;
          grabAt.current = e.clientY;
          grabY.current = e.clientY - (liRef.current?.getBoundingClientRect().top ?? e.clientY);
          setDragging(true);
          toast("拖到想要的位置後放開", "info");
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onMove(e.key === "ArrowUp" ? -1 : 1);
          }
        }}
      >
        ≡
      </button>
      <span className="ed-label">{children}</span>
      <button
        className="ed-btn ed-del"
        onClick={() => (onRemove(), toast(`已刪除「${name}」`))}
        disabled={count <= min}
        aria-label="刪除"
        title={count <= min ? `至少要保留 ${min} 個` : undefined}
      >
        ✕
      </button>
    </li>
  );
}

// ---------- 天氣 ----------

interface Town {
  county: string;
  town: string;
  townId: string;
  latitude: number;
  longitude: number;
}

/** 汐止區 → 汐止, but keep two-character names like 東區 / 北區 whole. */
const shortName = (town: string) => (town.length > 2 ? town.replace(/[區鎮鄉市]$/, "") : town);

function WeatherEditor({ s, set }: { s: Settings; set: (s: Settings) => void }) {
  const [towns, setTowns] = useState<Town[] | null>(null);
  const [county, setCounty] = useState("新北市");
  const [townId, setTownId] = useState("");
  const [name, setName] = useState("");
  useEffect(() => {
    // ~35 KB, only needed here.
    import("../data/towns.json").then((m) => setTowns(m.default as Town[]));
  }, []);
  const counties = [...new Set(towns?.map((t) => t.county))];
  const inCounty = towns?.filter((t) => t.county === county) ?? [];
  const picked = inCounty.find((t) => t.townId === townId);
  const places = s.weather;
  const update = (weather: WeatherPlace[]) => set({ ...s, weather });
  const full = places.length >= LIMITS.weather;
  const label = name.trim() || (picked ? shortName(picked.town) : "");
  const duplicate = places.some((p) => p.name === label);

  const add = () => {
    if (!picked || !label || duplicate || full) return;
    update([...places, { name: label, county: picked.county, town: picked.town, townId: picked.townId, latitude: picked.latitude, longitude: picked.longitude }]);
    toast(`已新增「${label}」`);
    setName("");
  };

  return (
    <>
      <ul className="ed-list">
        {places.map((p, i) => (
          <Row key={p.name} name={p.name} i={i} count={places.length} min={1} onMove={(by) => update(move(places, i, by))} onRemove={() => update(without(places, i))}>
            {p.name}
            <span className="muted small">
              {" "}
              {p.county}
              {p.town}
              {i === 0 ? "・天氣動畫依此地" : ""}
            </span>
          </Row>
        ))}
      </ul>
      <div className="ed-add">
        <select value={county} onChange={(e) => (setCounty(e.target.value), setTownId(""))} aria-label="縣市">
          {counties.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={townId} onChange={(e) => setTownId(e.target.value)} aria-label="鄉鎮區">
          <option value="">{towns ? "選擇鄉鎮區" : "載入中…"}</option>
          {inCounty.map((t) => (
            <option key={t.townId} value={t.townId}>
              {t.town}
            </option>
          ))}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={picked ? shortName(picked.town) : "顯示名稱"} maxLength={8} aria-label="顯示名稱" />
        <button className="ed-primary" onClick={add} disabled={!picked || !label || duplicate || full}>
          新增
        </button>
      </div>
      <p className="muted small">
        {full ? `最多 ${LIMITS.weather} 個地點。` : duplicate ? "已經有同名的地點，請換個顯示名稱。" : "清單是氣象署有測站的鄉鎮區；第一個地點決定整頁的天氣動畫。"}
      </p>
    </>
  );
}

// ---------- 行情 ----------

function MarketsEditor({ s, set }: { s: Settings; set: (s: Settings) => void }) {
  const items = s.markets;
  const update = (markets: MarketItem[]) => set({ ...s, markets });
  const used = new Set(items.map(marketSymbol));
  const available = INSTRUMENT_CATALOG.filter((i) => !used.has(i.symbol));
  const [pick, setPick] = useState("");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const fits = (_m?: MarketItem) => items.length < LIMITS.markets;
  const customOk = /^[A-Za-z0-9.^=\-]{1,20}$/.test(symbol.trim()) && name.trim().length > 0 && !used.has(symbol.trim());

  return (
    <>
      <ul className="ed-list">
        {items.map((m, i) => {
          const inst = instrumentOf(m);
          return (
            <Row
              key={inst.symbol}
              name={inst.name}
              i={i}
              count={items.length}
              min={1}
              onMove={(by) => update(move(items, i, by))}
              onRemove={() => update(without(items, i))}
            >
              {inst.name}
              <span className="muted small"> {inst.symbol}</span>
            </Row>
          );
        })}
      </ul>
      <div className="ed-add">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="從清單新增">
          <option value="">從清單選擇</option>
          {available.map((i) => (
            <option key={i.symbol} value={i.symbol} disabled={!fits(i.symbol)}>
              {i.name}（{i.symbol}）
            </option>
          ))}
        </select>
        <button className="ed-primary" disabled={!pick || !fits(pick)} onClick={() => (update([...items, pick]), setPick(""), toast(`已新增「${instrumentOf(pick).name}」`))}>
          新增
        </button>
      </div>
      <div className="ed-add">
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Yahoo 代號，如 2317.TW" maxLength={20} aria-label="自訂代號" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="顯示名稱" maxLength={10} aria-label="自訂名稱" />
        <button
          className="ed-primary"
          disabled={!customOk || !fits({ symbol: symbol.trim(), name })}
          onClick={() => (update([...items, { symbol: symbol.trim(), name: name.trim() }]), setSymbol(""), setName(""), toast(`已新增「${name.trim()}」`))}
        >
          新增
        </button>
      </div>
      <p className="muted small">
        目前 {items.length}／{LIMITS.markets} 格。自訂代號以 Yahoo Finance 為準（台股加 .TW、上櫃加 .TWO），找不到時該格會顯示「—」。
      </p>
    </>
  );
}

// ---------- 公車 ----------

const busLabel = (b: BusStop) =>
  `${b.stop}${b.headsign ? `・${b.headsign}` : b.toward ? `・往 ${b.toward}` : ""}${b.city !== "Taipei" && b.city !== "NewTaipei" ? `・${BUS_CITY_NAME.get(b.city)}` : ""}`;

/** GET a TDX-backed API with the visitor's own key (if any); throws the server's message on error. */
async function tdxApi<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: tdxHeaders() });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

/** Where a trip goes: "往 終點", or for a loop (ends where it starts) the next stop's side. */
function tripLabel(t: BusTrip, all: BusTrip[]) {
  const first = t.stops[0];
  const last = t.stops[t.stops.length - 1];
  const base = first === last ? `環狀（${first} 發車）` : `往 ${last}`;
  const twins = all.filter((x) => x !== t && x.stops[x.stops.length - 1] === last && x.stops[0] === first);
  return twins.length && t.subRoute ? `${base}・${t.subRoute}` : base;
}

/**
 * Add a bus by picking, not typing: city → route (search) → direction → the stop to board at.
 * The stop after the chosen one is saved as `toward`, which pins the exact side of the road
 * (loop routes pass a stop name twice, once each way).
 */
function BusEditor({ s, set }: { s: Settings; set: (s: Settings) => void }) {
  const stops = s.bus;
  const update = (bus: BusStop[]) => set({ ...s, bus });
  const [city, setCity] = useState<BusCity>(stops[0]?.city ?? "NewTaipei");
  const [routes, setRoutes] = useState<Partial<Record<BusCity, BusRouteInfo[] | string>>>({});
  const [query, setQuery] = useState("");
  const [route, setRoute] = useState<BusRouteInfo | null>(null);
  const [trips, setTrips] = useState<BusTrip[] | string | null>(null);
  const [tripIndex, setTripIndex] = useState(0);
  const cities = new Set(stops.map((b) => b.city));
  const cityFull = !cities.has(city) && cities.size >= MAX_BUS_CITIES;
  const full = stops.length >= LIMITS.bus;

  // The city's route list (fetched once per city; the server keeps it for a day).
  const list = routes[city];
  useEffect(() => {
    if (list !== undefined) return;
    tdxApi<BusRouteInfo[]>(`/api/bus-routes?city=${city}`)
      .then((r) => setRoutes((m) => ({ ...m, [city]: r })))
      .catch((e: Error) => setRoutes((m) => ({ ...m, [city]: e.message })));
  }, [city, list]);

  const q = query.trim();
  const matches =
    Array.isArray(list) && q
      ? list
          .filter((r) => r.name.includes(q) || r.from.includes(q) || r.to.includes(q))
          .sort((a, b) => Number(!a.name.startsWith(q)) - Number(!b.name.startsWith(q)))
          .slice(0, 30)
      : [];

  const pickRoute = (r: BusRouteInfo) => {
    setRoute(r);
    setTrips(null);
    setTripIndex(0);
    tdxApi<BusTrip[]>(`/api/bus-trips?city=${city}&route=${encodeURIComponent(r.name)}`)
      .then((t) => setTrips(t.length ? t : "這條路線沒有站牌資料"))
      .catch((e: Error) => setTrips(e.message));
  };

  const trip = Array.isArray(trips) ? trips[Math.min(tripIndex, trips.length - 1)] : null;
  const already = route ? stops.some((b) => b.city === city && b.route === route.name) : false;

  const add = (i: number) => {
    if (!route || !trip || full || cityFull || already) return;
    const stop = trip.stops[i];
    update([
      ...stops,
      { city, route: route.name, stop, direction: "auto", toward: trip.stops[i + 1], headsign: tripLabel(trip, trips as BusTrip[]) },
    ]);
    toast(`已新增「${route.name} ${stop}」，公車區塊下次更新時出現`);
    setRoute(null);
    setQuery("");
  };

  return (
    <>
      <ul className="ed-list">
        {stops.map((b, i) => (
          <Row
            key={`${b.city}:${b.route}`}
            name={b.route}
            i={i}
            count={stops.length}
            onMove={(by) => update(move(stops, i, by))}
            onRemove={() => update(without(stops, i))}
          >
            {b.route}
            <span className="muted small">
              {" "}
              {busLabel(b)}
            </span>
          </Row>
        ))}
      </ul>
      {full ? (
        <p className="muted small">最多 {LIMITS.bus} 條，請先刪除一條再新增。</p>
      ) : !route ? (
        <>
          <div className="ed-add">
            <select value={city} onChange={(e) => (setCity(e.target.value as BusCity), setQuery(""))} aria-label="縣市">
              {BUS_CITIES.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋路線，如 藍23、307" maxLength={20} aria-label="搜尋路線" />
          </div>
          {cityFull ? (
            <p className="hint error">最多 {MAX_BUS_CITIES} 個縣市（每個縣市每分鐘要多查一次 TDX）。</p>
          ) : list === undefined ? (
            <p className="muted small">載入路線清單中…</p>
          ) : typeof list === "string" ? (
            <p className="hint error">
              無法載入路線：{list}{" "}
              <button className="link-btn" onClick={() => setRoutes((m) => ({ ...m, [city]: undefined }))}>
                重試
              </button>
            </p>
          ) : !q ? (
            <p className="muted small">輸入路線名稱，或起訖站名（{BUS_CITY_NAME.get(city)}共 {list.length} 條路線）。</p>
          ) : !matches.length ? (
            <p className="muted small">找不到「{q}」。</p>
          ) : (
            <ul className="pick-list">
              {matches.map((r) => (
                <li key={r.name}>
                  <button className="pick-item" onClick={() => pickRoute(r)}>
                    <span className="chip blue-chip">{r.name}</span>
                    <span className="muted small">
                      {r.from} ↔ {r.to}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="pick-route">
          <div className="pick-head">
            <button className="link-btn" onClick={() => setRoute(null)}>
              ‹ 換路線
            </button>
            <span className="chip blue-chip">{route.name}</span>
            <span className="muted small">{BUS_CITY_NAME.get(city)}</span>
          </div>
          {trips === null ? (
            <p className="muted small">載入站牌中…</p>
          ) : typeof trips === "string" ? (
            <p className="hint error">
              無法載入站牌：{trips}{" "}
              <button className="link-btn" onClick={() => pickRoute(route)}>
                重試
              </button>
            </p>
          ) : (
            <>
              <div className="tabs ed-tabs" role="tablist">
                {trips.map((t, i) => (
                  <button key={i} role="tab" aria-selected={t === trip} onClick={() => setTripIndex(i)}>
                    {tripLabel(t, trips)}
                  </button>
                ))}
              </div>
              {already ? (
                <p className="hint error">這條路線已經在清單裡了，要換站牌請先刪除原本那一筆。</p>
              ) : (
                <p className="muted small">點你要上車的站牌（終點站不能上車，所以不列出）：</p>
              )}
              <ul className="pick-list">
                {trip!.stops.slice(0, -1).map((name, i) => (
                  <li key={i}>
                    <button className="pick-item" disabled={already} onClick={() => add(i)}>
                      <span className="pick-seq">{i + 1}</span>
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <p className="muted small">
        資料來自 TDX 的市區公車（公路客運不在內）。雙北的公車點擊後開大台北公車，其他縣市開 Google 地圖搜尋該路線。
      </p>
    </>
  );
}

// ---------- 火車 ----------

function TrainsEditor({ s, set }: { s: Settings; set: (s: Settings) => void }) {
  const routes = s.trains;
  const [stations, setStations] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => {
    fetch("/api/stations", { headers: tdxHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((names: string[]) => setStations(names))
      .catch(() => {});
  }, []);
  const norm = (v: string) => v.trim().replace(/台/g, "臺").replace(/車?站$/, "");
  const known = (v: string) => !stations.length || stations.includes(norm(v));
  const dup = routes.some((r) => r.from === norm(from) && r.to === norm(to));
  const ok = norm(from) && norm(to) && norm(from) !== norm(to) && known(from) && known(to) && !dup && routes.length < LIMITS.trains;
  const update = (trains: Settings["trains"]) => set({ ...s, trains });

  return (
    <>
      <ul className="ed-list">
        {routes.map((r, i) => (
          <Row key={`${r.from}-${r.to}`} name={`${r.from}→${r.to}`} i={i} count={routes.length} onMove={(by) => update(move(routes, i, by))} onRemove={() => update(without(routes, i))}>
            {r.from} → {r.to}
            {i === 0 && <span className="muted small">・預設顯示</span>}
          </Row>
        ))}
      </ul>
      <div className="ed-add">
        <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="上車站" list="tra-stations" maxLength={8} aria-label="上車站" />
        <span className="muted">→</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="下車站" list="tra-stations" maxLength={8} aria-label="下車站" />
        <datalist id="tra-stations">
          {stations.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <button className="ed-primary" disabled={!ok} onClick={() => (update([...routes, { from: norm(from), to: norm(to) }]), setFrom(""), setTo(""), toast(`已新增「${norm(from)}→${norm(to)}」`))}>
          新增
        </button>
      </div>
      <p className="muted small">
        {routes.length >= LIMITS.trains
          ? `最多 ${LIMITS.trains} 條。`
          : (from && !known(from)) || (to && !known(to))
            ? "找不到這個臺鐵車站，請從清單選擇。"
            : dup
              ? "這條路線已經在清單裡了。"
              : "站名用臺鐵的寫法，例如 臺北、汐科。"}
      </p>
      <div className="setting">
        <div className="setting-label">車種</div>
        <div className="segmented" role="radiogroup" aria-label="車種">
          {TRAIN_TYPES.map((t) => (
            <button key={t} role="radio" aria-checked={s.trainType === t} onClick={() => (set({ ...s, trainType: t }), toast(`車種改為「${t}」`))}>
              {t}
            </button>
          ))}
        </div>
        <div className="muted small">「區間」也包含區間快車。</div>
      </div>
    </>
  );
}

// ---------- 新聞 ----------

function NewsEditor({ s, set }: { s: Settings; set: (s: Settings) => void }) {
  const [topic, setTopic] = useState<Topic>("top");
  const ids = s.news[topic];
  const update = (list: string[]) => set({ ...s, news: { ...s.news, [topic]: list } });
  const available = sourcesFor(topic).filter((src) => !ids.includes(src.id));
  const [pick, setPick] = useState("");
  const full = ids.length >= LIMITS.news;

  return (
    <>
      <div className="tabs ed-tabs" role="tablist">
        {TOPICS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={topic === id} onClick={() => (setTopic(id), setPick(""))}>
            {label}
          </button>
        ))}
      </div>
      <ul className="ed-list">
        {ids.map((id, i) => {
          const src = NEWS_BY_ID.get(id);
          return (
            <Row key={id} name={NEWS_BY_ID.get(id)?.name ?? id} i={i} count={ids.length} min={1} onMove={(by) => update(move(ids, i, by))} onRemove={() => update(without(ids, i))}>
              {src?.name ?? id}
              {src?.note && <span className="muted small">・{src.note}</span>}
            </Row>
          );
        })}
      </ul>
      <div className="ed-add">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="新增來源">
          <option value="">{available.length ? "選擇來源" : "沒有其他來源"}</option>
          {available.map((src) => (
            <option key={src.id} value={src.id}>
              {src.name}
              {src.note ? `（${src.note}）` : ""}
            </option>
          ))}
        </select>
        <button className="ed-primary" disabled={!pick || full} onClick={() => (update([...ids, pick]), setPick(""), toast(`已新增「${NEWS_BY_ID.get(pick)?.name ?? pick}」`))}>
          新增
        </button>
      </div>
      <p className="muted small">
        {full ? `每個分頁最多 ${LIMITS.news} 個來源。` : "排在前面的來源，在每一輪都排在前面。來源只能從清單選，不能填任意網址。"}
      </p>
    </>
  );
}

// ---------- Container ----------

/** One-line summary of what a section currently shows, for the list in the main settings page. */
function summary(section: Section, s: Settings): string {
  switch (section) {
    case "weather":
      return s.weather.map((p) => p.name).join("、");
    case "markets":
      return s.markets.map((m) => instrumentOf(m).name).join("、");
    case "bus":
      return s.bus.map((b) => b.route).join("、") || "未設定";
    case "trains":
      return s.trains.map((t) => `${t.from}→${t.to}`).join("、") || "未設定";
    case "news":
      return TOPICS.map(([id, label]) => `${label} ${s.news[id].length}`).join("・") + " 個來源";
  }
}

/** Second-level page over the settings dialog. Esc / 返回 / tapping outside close only this page. */
function SubPage({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus();
    // Capture phase on window runs before the settings dialog's own Esc handler, which would close everything.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop sub-backdrop" onClick={(e) => (e.stopPropagation(), onClose())}>
      <div className="modal modal-settings" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <button ref={backRef} className="sub-back" onClick={onClose}>
            ‹ 返回
          </button>
          <h2>{title}</h2>
        </header>
        <div className="settings-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const TITLES: Record<Section, string> = { weather: "天氣地點", markets: "市場行情", bus: "公車", trains: "火車", news: "新聞來源" };

export function ContentEditor() {
  const { settings, setSettings } = useSettings();
  const [open, setOpen] = useState<Section | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const props = { s: settings, set: setSettings };
  return (
    <div className="setting">
      <div className="setting-label">顯示內容</div>
      <div className="muted small">也可以直接在看板上長按天氣卡片、行情方塊或火車路線，拖到想要的位置。</div>
      <ul className="ed-sections">
        {SECTIONS.map(([id, label]) => (
          <li key={id}>
            <button className="ed-section" onClick={() => setOpen(id)}>
              <span className="ed-section-name">{label}</span>
              <span className="ed-section-sum muted small">{summary(id, settings)}</span>
              <span className="ed-section-chev" aria-hidden>
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <SubPage title={TITLES[open]} onClose={close}>
          {open === "weather" && <WeatherEditor {...props} />}
          {open === "markets" && <MarketsEditor {...props} />}
          {open === "bus" && <BusEditor {...props} />}
          {open === "trains" && <TrainsEditor {...props} />}
          {open === "news" && <NewsEditor {...props} />}
        </SubPage>
      )}
    </div>
  );
}
