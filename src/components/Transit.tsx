import { BUS_CITY_NAME } from "../bus-cities";
import { BUS_ESTIMATE_STALE_MIN, REFRESH_SEC, STALE_AFTER_SEC, TOWARD_TAIPEI, TRAIN_LIMIT, links } from "../config";
import { type BusStop, LIMITS, trainTypeKeyword, useSettings } from "../settings";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getJSON, moveTo, useNow, usePolling, useReorder, useScrollHint } from "../hooks";
import type { BusArrival, BusResponse, BusRouteDetail, TrainDeparture, TrainResponse } from "../shared";
import { Flip } from "./Flip";
import { Section } from "./Section";
import { SkeletonBar, SkeletonRows } from "./Skeleton";
import { toast } from "../toast";

const NOT_CONFIGURED = <p className="hint">網站尚未設定 TDX 金鑰，可在右上角「設定」填入你自己的金鑰。</p>;

const sameRoute = (a: BusArrival, s: BusStop) => a.route === s.route && (a.city ?? s.city) === s.city;

/**
 * This arrival belongs to this board entry: same route, the entry's stop (names may be spelled
 * a little differently on the signs) and, when set, heading toward the same next stop. A route
 * can have several entries (e.g. one stop each way).
 */
const belongs = (a: BusArrival, s: BusStop) =>
  sameRoute(a, s) && (a.toward ?? null) === (s.toward ?? null) && (a.stop === s.stop || isSubsequence(s.stop, a.stop));

/** Keep the configured direction; "auto" keeps whichever direction heads toward Taipei. */
function wanted(a: BusArrival, all: BusArrival[], cfg: BusStop): boolean {
  if (cfg.toward) return true; // the backend already kept only buses heading there
  if (cfg.direction !== "auto") return a.direction === cfg.direction;
  const toward = all.filter((x) => belongs(x, cfg) && TOWARD_TAIPEI.test(x.headsign));
  const dirs = new Set(toward.map((x) => x.direction));
  // If both or neither direction looks like Taipei we can't tell, so show both.
  return dirs.size !== 1 || dirs.has(a.direction);
}

// TDX re-estimates about once a minute; older than this and the estimate may be off.
const BUS_STALE_MS = BUS_ESTIMATE_STALE_MIN * 60_000;

// Shown as TDX reports it, refreshed every minute: no local per-second countdown, which only
// looked precise and jumped back whenever a new estimate arrived.
const ARRIVING_SEC = 60; // 進站中
const NEAR_SEC = 180; // 將到站

function eta(a: BusArrival): { text: string; cls: string } {
  const sec = a.estimateSec;
  if (sec == null) return { text: a.status ?? "—", cls: "muted" };
  // Not departed yet: the estimate comes from the timetable.
  if (a.status) return { text: `約 ${Math.max(1, Math.floor(sec / 60))} 分`, cls: "muted" };
  if (sec < ARRIVING_SEC) return { text: "進站中", cls: "red" };
  if (sec < NEAR_SEC) return { text: "將到站", cls: "red" };
  // Rounded down, so the bus is never later than it says.
  return { text: `${Math.floor(sec / 60)} 分`, cls: "" };
}

export function Bus() {
  const now = useNow(1000);
  const { settings } = useSettings();
  const stops = settings.bus;
  // Routes without a picked stop have no arrivals to ask for: the board just lists them.
  const routes = stops
    .filter((s) => s.stop)
    .map((s) => [s.city, s.route, s.stop, ...(s.toward ? [s.toward] : [])].join(":"))
    .join(",");
  const state = usePolling(
    () =>
      routes
        ? getJSON<BusResponse>(`/api/bus?routes=${encodeURIComponent(routes)}`)
        : Promise.resolve({ data: { configured: true, arrivals: [], notFound: [] }, dataTime: Date.now(), stale: false }),
    REFRESH_SEC.bus,
    [routes],
  );
  const { setSettings } = useSettings();
  const listRef = useScrollHint<HTMLUListElement>();
  // Long-press a stop to drag it; the list is in the order set by the user.
  const dragRef = useReorder<HTMLUListElement>((from, to) => setSettings({ ...settings, bus: moveTo(stops, from, to) }));
  const all = state.data?.arrivals ?? [];
  const [open, setOpen] = useState<{ city: string; route: string; direction: number; routeId: string } | null>(null);
  const notFound = new Set(state.data?.notFound ?? []);
  return (
    <Section
      title="公車"
      className="bus"
      state={state}
      maxAgeSec={STALE_AFTER_SEC.bus}
      source={<>交通部 <a href="https://tdx.transportdata.tw/" target="_blank" rel="noopener noreferrer">TDX</a> 運輸資料流通服務</>}
    >
      {state.data && !state.data.configured ? (
        NOT_CONFIGURED
      ) : (
        <ul
          className="list scroll"
          ref={(el) => {
            listRef.current = el;
            dragRef.current = el;
          }}
        >
          {!stops.length && <li className="hint">尚未設定公車，可在右上角「設定」新增。</li>}
          {state.error && !state.data && <li className="hint error">{state.error}</li>}
          {/* One item per configured stop (it can show both directions), in the user's order. */}
          {stops.map((cfg) => {
            // No boarding stop picked: list the route only (ignore arrivals still on screen from before).
            const rows = all
              .filter((a) => cfg.stop && belongs(a, cfg) && wanted(a, all, cfg))
              .sort((a, b) => (a.estimateSec ?? 1e9) - (b.estimateSec ?? 1e9));
            return (
              <li key={`${cfg.city}:${cfg.route}:${cfg.stop}:${cfg.toward ?? ""}`} data-reorder className="bus-stop">
                {notFound.has(`${cfg.route}:${cfg.stop}`) ? (
                  <div className="row">
                    <span className="chip blue-chip">{cfg.route}</span>
                    <span className="grow hint error">找不到站牌：{cfg.stop}</span>
                  </div>
                ) : !rows.length ? (
                  <a
                    className="row link"
                    href={links.bus(cfg.city, cfg.route)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(ev) => {
                      if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
                      ev.preventDefault();
                      setOpen({ city: cfg.city, route: cfg.route, direction: typeof cfg.direction === "number" ? cfg.direction : 0, routeId: "" });
                    }}
                  >
                    <span className="chip blue-chip">{cfg.route}</span>
                    <span className="grow">
                      {cfg.stop ? <div>{cfg.stop}</div> : <div className="muted">未勾選上車站・點開看全線</div>}
                    </span>
                    {!cfg.stop ? (
                      <span className="eta muted">›</span>
                    ) : state.data ? (
                      <span className="eta muted">暫無資料</span>
                    ) : state.error ? (
                      <span className="eta muted">—</span>
                    ) : (
                      <SkeletonBar className="sk-eta" />
                    )}
                  </a>
                ) : (
                  rows.map((a) => {
                    const e = eta(a);
                    return (
                      <a
                        key={`${a.direction}-${a.stop}`}
                        className="row link"
                        href={links.bus(cfg.city, cfg.route)}
                        target="_blank"
                        rel="noopener noreferrer"
                        // Tap: the whole route in a sheet. (The link stays for open-in-new-tab.)
                        onClick={(ev) => {
                          if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
                          ev.preventDefault();
                          setOpen({ city: cfg.city, route: cfg.route, direction: a.direction, routeId: a.routeId });
                        }}
                      >
                        <span className="chip blue-chip">{a.route}</span>
                        <span className="grow">
                          <div>{a.stop}</div>
                          <div className="muted small">
                            {cfg.headsign ?? a.headsign}
                            {cfg.city !== "Taipei" && cfg.city !== "NewTaipei" && <span>・{BUS_CITY_NAME.get(cfg.city)}</span>}
                            {a.status && a.estimateSec != null && <span>・{a.status}</span>}
                            {a.lastBus && <span className="red">・末班車</span>}
                            {a.estimateSec != null && now - a.asOf > BUS_STALE_MS && (
                              <span className="error">・⚠ 預估已 {Math.floor((now - a.asOf) / 60000)} 分鐘未更新</span>
                            )}
                          </div>
                        </span>
                        <Flip className={`eta ${e.cls}`} value={e.text} />
                      </a>
                    );
                  })
                )}
              </li>
            );
          })}
        </ul>
      )}
      {open && <BusRouteSheet {...open} onClose={() => setOpen(null)} />}
    </Section>
  );
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

/** One stop's estimate on the route sheet, worded like the board. */
function stopEta(s: BusRouteDetail["trips"][number]["stops"][number]): { text: string; cls: string } {
  return eta({ estimateSec: s.estimateSec, status: s.status } as BusArrival);
}

/**
 * The whole route (every stop's estimate and where the buses are), like the operator sites, for
 * any city. Opens on the trip and stop the board row is for.
 */
function BusRouteSheet({
  city,
  route,
  direction,
  routeId,
  onClose,
}: {
  city: string;
  route: string;
  direction: number;
  routeId: string;
  onClose: () => void;
}) {
  const { settings, setSettings } = useSettings();
  const isThis = (b: BusStop) => b.city === city && b.route === route;
  /** This route's boarding stops (a route can have several, e.g. one each way). */
  const picks = settings.bus.filter((b) => isThis(b) && b.stop);
  const state = usePolling(
    () => getJSON<BusRouteDetail>(`/api/bus-route?city=${city}&route=${encodeURIComponent(route)}`),
    REFRESH_SEC.bus,
    [city, route],
  );
  const trips = state.data?.trips ?? [];
  type Trip = (typeof trips)[number];

  /**
   * Where a saved boarding stop is on a trip (-1: not on it). A loop route passes a stop twice:
   * with "toward", it's the pass that still has that stop ahead (as on the board), otherwise the
   * first. Names may differ slightly (樟樹實中 vs 樟樹國際實中). A stop saved without "toward"
   * (direction "auto") counts on the trip the board shows: the one heading toward Taipei.
   */
  const indexOn = (cfg: BusStop, t: Trip): number => {
    if (typeof cfg.direction === "number" && !cfg.toward && t.direction !== cfg.direction) return -1;
    if (cfg.direction === "auto" && !cfg.toward) {
      const taipei = new Set(trips.filter((x) => TOWARD_TAIPEI.test(x.headsign)).map((x) => x.direction));
      if (taipei.size === 1 && !taipei.has(t.direction)) return -1;
    }
    for (const match of [(n: string) => n === cfg.stop, (n: string) => isSubsequence(cfg.stop, n)]) {
      const hits = t.stops.flatMap((s, i) => (match(s.name) ? [i] : []));
      const ok = cfg.toward ? hits.filter((i) => t.stops.slice(i + 1).some((x) => x.name === cfg.toward)) : hits;
      if (ok.length) return ok[0];
    }
    return -1;
  };

  // Start on the board row's direction, a trip with a boarding stop, main route before sub-routes.
  const score = (t: Trip) =>
    (t.direction === direction ? 4 : 0) + (picks.some((c) => indexOn(c, t) >= 0) ? 2 : 0) + (t.subRoute === route ? 1 : 0);
  const initial = trips.length ? [...trips.keys()].sort((a, b) => score(trips[b]) - score(trips[a]) || a - b)[0] : 0;
  const [picked, setPicked] = useState<number | null>(null);
  const tab = picked ?? initial;
  const trip = trips[tab];
  /** Stop index on the shown trip → the saved boarding stop there. */
  const mine = new Map<number, BusStop>();
  if (trip) for (const c of picks) {
    const i = indexOn(c, trip);
    if (i >= 0 && !mine.has(i)) mine.set(i, c);
  }
  const firstMine = mine.size ? Math.min(...mine.keys()) : -1;
  const mineRef = useRef<HTMLLIElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Bring the boarding stop into view when the trip is shown.
  useEffect(() => {
    mineRef.current?.scrollIntoView({ block: "center" });
  }, [tab, Boolean(state.data)]);

  /**
   * Tick a stop to add it as a boarding stop (the board gets a row for it); untick to remove it.
   * Like the settings picker, the next stop is saved as `toward`, which pins the side of the road
   * (and the pass, on a loop). With no stop left the route stays on the board, listed only.
   */
  const pick = (i: number) => {
    if (!trip) return;
    const s = trip.stops[i];
    const existing = mine.get(i);
    const at = settings.bus.findIndex(isThis);
    let bus: BusStop[];
    if (existing) {
      bus = settings.bus.filter((b) => b !== existing);
      if (!bus.some(isThis)) bus.splice(Math.max(0, at), 0, { city: city as BusStop["city"], route, stop: "", direction: "auto" });
      setSettings({ ...settings, bus });
      toast(`已取消「${route} ${existing.stop}」這個上車站`);
      return;
    }
    const next = trip.stops[i + 1]?.name;
    const loop = trip.stops[0].name === trip.stops.at(-1)!.name;
    const entry: BusStop = {
      city: city as BusStop["city"],
      route,
      stop: s.name,
      direction: next ? "auto" : (trip.direction as 0 | 1),
      ...(next ? { toward: next } : {}),
      headsign: loop ? `環狀・下一站 ${next ?? s.name}` : trip.headsign,
    };
    // A route listed without a stop is replaced; otherwise the new stop goes after this route's others.
    const routeOnly = settings.bus.find((b) => isThis(b) && !b.stop);
    if (!routeOnly && settings.bus.length >= LIMITS.bus) {
      toast(`公車最多 ${LIMITS.bus} 筆，請先取消其他上車站`, "error");
      return;
    }
    bus = settings.bus.filter((b) => b !== routeOnly);
    const last = bus.reduce((acc, b, j) => (isThis(b) ? j : acc), -1);
    bus.splice(last >= 0 ? last + 1 : Math.max(0, at), 0, entry);
    setSettings({ ...settings, bus });
    toast(`已加入「${route} ${s.name}（${entry.headsign}）」，看板會顯示這站的到站時間`);
  };
  const label = (t: Trip) => (t.subRoute !== route ? `${t.subRoute} ${t.headsign}` : t.headsign);
  const twoCities = city === "Taipei" || city === "NewTaipei";
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal bus-sheet" role="dialog" aria-modal="true" aria-label={`${route} 全線動態`} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <span className="chip blue-chip">{route}</span> 全線動態
          </h2>
          <span className="muted small bus-sheet-status">
            {state.loading && !state.data ? "載入中…" : state.error ? <span className="error">⚠ {state.error}</span> : null}
          </span>
          <button className="modal-close" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </header>
        {trips.length > 1 && (
          <div className="route-tabs bus-sheet-tabs" role="tablist">
            {trips.map((t, i) => (
              <button key={i} className="route-tab" role="tab" aria-selected={i === tab} onClick={() => setPicked(i)}>
                {label(t)}
              </button>
            ))}
          </div>
        )}
        <p className="bus-sheet-hint muted small">
          勾選上車站，看板就會顯示那一站的到站時間；可以勾多站，例如去程、回程各一站（切換上方方向）。
          {picks.length > 0 && `目前 ${picks.length} 站：${picks.map((c) => c.stop).join("、")}`}
        </p>
        <ol className="bus-stops">
          {trip?.stops.map((s, i) => {
            const e = stopEta(s);
            const isMine = mine.has(i);
            return (
              <li key={i} ref={i === firstMine ? mineRef : undefined} className={isMine ? "mine" : ""}>
                <input
                  type="checkbox"
                  className="bus-stop-pick"
                  checked={isMine}
                  onChange={() => pick(i)}
                  aria-label={`把 ${s.name} 設為上車站`}
                  title="勾選後，看板顯示這一站的到站時間"
                />
                <span className={`bus-stop-eta ${e.cls}`}>{e.text}</span>
                <span className="bus-stop-name">
                  {s.name}
                  {isMine && <span className="pk-tag">上車站</span>}
                  {s.lastBus && <span className="red small">・末班車</span>}
                </span>
                {s.buses.map((b) => (
                  <span key={b.plate} className={`bus-plate ${b.arriving ? "at" : ""}`} title={b.arriving ? "進站中" : "已離站"}>
                    🚌 {b.plate}
                  </span>
                ))}
              </li>
            );
          })}
        </ol>
        <footer className="bus-sheet-foot muted small">
          <span>
            資料：交通部 TDX・每分鐘更新
            {state.data && !state.data.busesOk && "・公車位置暫時無法取得"}
          </span>
          <span className="bus-sheet-links">
            {twoCities && (routeId || state.data?.routeId) && (
              <a href={links.bus5284(routeId || state.data!.routeId)} target="_blank" rel="noopener noreferrer">
                5284 大台北公車 ›
              </a>
            )}
            <a href={links.bus(city, route)} target="_blank" rel="noopener noreferrer">
              Google 地圖 ›
            </a>
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const station = (name: string) => name.replace(/臺/g, "台");
const addMin = (hhmm: string, min: number) => {
  const m = (toMin(hhmm) + min) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** One route's departures. Keyed by route so its scroll position and hint start fresh. */
function TrainList({ trains, from, to, type, now }: { trains: TrainDeparture[]; from: string; to: string; type: string; now: number }) {
  const listRef = useScrollHint<HTMLUListElement>();
  const local = new Date(now + 8 * 3600_000);
  const nowSec = local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds();
  const today = local.toISOString().slice(0, 10);
  // Seconds until the train actually leaves (scheduled time + reported delay).
  const rows = trains
    .map((t) => ({ ...t, left: (toMin(t.departure) + (t.delayMin ?? 0)) * 60 - nowSec }))
    .filter((t) => t.left > -30); // drop ones that left since the last refresh
  return (
    <ul className="list scroll" ref={listRef}>
      {rows.map((t) => (
        <li key={t.trainNo} className={t.cancelled ? "cancelled" : ""}>
          <a className="row link" href={links.train(t.trainNo, today)} target="_blank" rel="noopener noreferrer">
            <span className="time">
              {t.departure}
              <span className="time-sub">{station(from)}發車</span>
            </span>
            <span className="grow">
              <div>
                {t.type}{" "}
                <span className="muted small">
                  {t.trainNo} 次・往{t.endingStation}
                </span>
              </div>
              <div className="muted small">
                {t.cancelled ? (
                  <span className="red">停駛</span>
                ) : (
                  <>
                    {/* With a known delay, the arrival moves by the same amount (best estimate). */}
                    {t.delayMin ? `約 ${addMin(t.arrival, t.delayMin)}` : t.arrival} 抵達{station(to)}・
                    {t.delayMin == null ? "無即時資訊" : t.delayMin > 0 ? <span className="red">晚 {t.delayMin} 分</span> : "準點"}
                  </>
                )}
              </div>
            </span>
            <span className={`eta ${t.cancelled ? "red" : t.left < 300 ? "red" : ""}`}>
              <Flip value={t.cancelled ? "停駛" : t.left < 60 ? "即將發車" : `${Math.floor(t.left / 60)} 分`} />
              {t.platform && !t.cancelled && <span className="eta-sub">{t.platform} 月台</span>}
            </span>
          </a>
        </li>
      ))}
      {!rows.length && <li className="hint">今天已經沒有{type}車了</li>}
    </ul>
  );
}

/**
 * Accordion of routes; exactly one is open, and only that one is polled, so the TDX quota
 * (shared with the buses) doesn't grow with the number of routes.
 */
export function Train() {
  const now = useNow(1000);
  const { settings, setSettings } = useSettings();
  const routes = settings.trains;
  const keyOf = (r: { from: string; to: string }) => `${r.from}-${r.to}`;
  // Remember the open route itself (not its position), so reordering keeps it open.
  const [openKey, setOpenKey] = useState<string | null>(() => (routes[0] ? keyOf(routes[0]) : null));
  const [collapsed, setCollapsed] = useState(false);
  const found = routes.findIndex((r) => keyOf(r) === openKey);
  // -1 = all folded (by tapping the open route); otherwise default / removed route → the first one.
  const open = collapsed ? -1 : found >= 0 ? found : 0;
  const setOpen = (i: number) => {
    if (i === open) return setCollapsed(true); // tap the open route again to fold it
    setCollapsed(false);
    setOpenKey(keyOf(routes[i]));
  };
  // Keep the selected route's chip in view (the row scrolls sideways).
  useEffect(() => {
    accRef.current?.querySelector(".route-tab[aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [open]);
  // Long-press a route to drag it sideways.
  const accRef = useReorder<HTMLDivElement>((from, to) => setSettings({ ...settings, trains: moveTo(routes, from, to) }));
  // Nothing is fetched while every route is folded.
  const route = open >= 0 ? (routes[open] as (typeof routes)[number] | undefined) : undefined;
  const q = new URLSearchParams({
    from: route?.from ?? "",
    to: route?.to ?? "",
    type: trainTypeKeyword(settings.trainType),
    limit: String(TRAIN_LIMIT),
  }).toString();
  const state = usePolling(
    () =>
      route
        ? getJSON<TrainResponse>(`/api/train?${q}`)
        : Promise.resolve({ data: { configured: true, from: "", to: "", trains: [], alerts: [] }, dataTime: Date.now(), stale: false }),
    REFRESH_SEC.train,
    [q],
  );
  // Right after switching, the previous route's answer is still in state; don't show it here.
  const current = route && state.data && state.data.from === route.from && state.data.to === route.to ? state.data : undefined;
  return (
    <Section
      title="火車"
      className="train"
      state={state}
      maxAgeSec={STALE_AFTER_SEC.train}
      source={<>交通部 <a href="https://tdx.transportdata.tw/" target="_blank" rel="noopener noreferrer">TDX</a>（臺鐵時刻、即時與營運公告）</>}
    >
      {state.data && !state.data.configured ? (
        NOT_CONFIGURED
      ) : (
        <>
          {current?.alerts?.map((a) => (
            <a key={a} className="alert" href={links.traAlerts} target="_blank" rel="noopener noreferrer">
              ⚠ 臺鐵公告：{a}
            </a>
          ))}
          {current && current.alerts == null && <p className="hint error">⚠ 暫時無法確認臺鐵營運公告（停駛、通阻），請以臺鐵官網為準</p>}
          {!routes.length && <p className="hint">尚未設定火車路線，可在右上角「設定」新增。</p>}
          {/* Routes as one sideways-scrolling row; the trains below are the only vertical list, so the
              two never fight over the same swipe. Tap the selected route again to fold the list. */}
          <div className="route-tabs-wrap">
            <div className="route-tabs" ref={accRef} role="tablist">
              {routes.map((r, i) => (
                <button key={keyOf(r)} data-reorder role="tab" className="route-tab" aria-selected={i === open} onClick={() => setOpen(i)}>
                  {station(r.from)} → {station(r.to)}
                </button>
              ))}
            </div>
          </div>
          {route &&
            (current ? (
              <TrainList key={open} trains={current.trains} from={route.from} to={route.to} type={trainTypeKeyword(settings.trainType)} now={now} />
            ) : (
              state.error ? <p className="hint error">{state.error}</p> : <SkeletonRows rows={5} />
            ))}
          {routes.length > 0 && open < 0 && <p className="hint">點上方的路線查看班次。</p>}
        </>
      )}
    </Section>
  );
}
