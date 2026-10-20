import { BUS_ESTIMATE_STALE_MIN, REFRESH_SEC, STALE_AFTER_SEC, TOWARD_TAIPEI, TRAIN_LIMIT, links } from "../config";
import { type BusStop, trainTypeKeyword, useSettings } from "../settings";
import { Fragment, useState } from "react";
import { getJSON, useNow, usePolling, useScrollHint } from "../hooks";
import type { BusArrival, BusResponse, TrainDeparture, TrainResponse } from "../shared";
import { Section } from "./Section";

const NOT_CONFIGURED = <p className="hint">尚未設定 TDX 金鑰，請參考 README。</p>;

/** Keep the configured direction; "auto" keeps whichever direction heads toward Taipei. */
function wanted(a: BusArrival, all: BusArrival[], stops: BusStop[]): boolean {
  const cfg = stops.find((s) => s.route === a.route);
  if (!cfg) return false;
  if (cfg.toward) return true; // the backend already kept only buses heading there
  if (cfg.direction !== "auto") return a.direction === cfg.direction;
  const toward = all.filter((x) => x.route === a.route && TOWARD_TAIPEI.test(x.headsign));
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
  const routes = stops.map((s) => [s.city, s.route, s.stop, ...(s.toward ? [s.toward] : [])].join(":")).join(",");
  const state = usePolling(
    () =>
      routes
        ? getJSON<BusResponse>(`/api/bus?routes=${encodeURIComponent(routes)}`)
        : Promise.resolve({ data: { configured: true, arrivals: [], notFound: [] }, dataTime: Date.now(), stale: false }),
    REFRESH_SEC.bus,
    [routes],
  );
  const listRef = useScrollHint<HTMLUListElement>();
  const all = state.data?.arrivals ?? [];
  const rows = all.filter((a) => wanted(a, all, stops));
  // Groups in config order (往台北 first), soonest bus first within a group.
  const groups = [...new Set(stops.map((s) => s.group))]
    .map((group) => ({
      group,
      rows: rows
        .filter((a) => stops.find((s) => s.route === a.route)?.group === group)
        .sort((a, b) => (a.estimateSec ?? 1e9) - (b.estimateSec ?? 1e9)),
    }))
    .filter((g) => g.rows.length);
  return (
    <Section title="公車" className="bus" state={state} maxAgeSec={STALE_AFTER_SEC.bus}>
      {state.data && !state.data.configured ? (
        NOT_CONFIGURED
      ) : (
        <ul className="list scroll" ref={listRef}>
          {!stops.length && <li className="hint">尚未設定公車，可在右上角「設定」新增。</li>}
          {state.error && !state.data && <li className="hint error">{state.error}</li>}
          {groups.map((g) => (
            <Fragment key={g.group}>
              <li className="list-group">{g.group}</li>
              {g.rows.map((a) => {
                const e = eta(a);
                return (
                  <li key={`${a.route}-${a.direction}-${a.stop}`}>
                    <a className="row link" href={links.bus(a.routeId)} target="_blank" rel="noopener noreferrer">
                      <span className="chip blue-chip">{a.route}</span>
                      <span className="grow">
                        <div>{a.stop}</div>
                        <div className="muted small">
                          {a.headsign}{a.status && a.estimateSec != null && <span>・{a.status}</span>}
                          {a.lastBus && <span className="red">・末班車</span>}
                          {a.estimateSec != null && now - a.asOf > BUS_STALE_MS && (
                            <span className="error">・⚠ 預估已 {Math.floor((now - a.asOf) / 60000)} 分鐘未更新</span>
                          )}
                        </div>
                      </span>
                      <span className={`eta ${e.cls}`}>{e.text}</span>
                    </a>
                  </li>
                );
              })}
            </Fragment>
          ))}
          {state.data?.notFound.map((p) => (
            <li key={p} className="hint error">找不到站牌：{p.replace(":", " ")}</li>
          ))}
        </ul>
      )}
    </Section>
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
              {t.cancelled ? "停駛" : t.left < 60 ? "即將發車" : `${Math.floor(t.left / 60)} 分`}
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
  const [openRaw, setOpen] = useState(0);
  const { settings } = useSettings();
  const routes = settings.trains;
  // The open route may have been removed in settings.
  const open = Math.min(openRaw, Math.max(0, routes.length - 1));
  const route = routes[open] as (typeof routes)[number] | undefined;
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
    <Section title="火車" className="train" state={state} maxAgeSec={STALE_AFTER_SEC.train}>
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
          <div className="acc">
            {routes.map((r, i) => (
              <div key={`${r.from}-${r.to}`} className={`acc-item ${i === open ? "acc-open" : ""}`}>
                <button className="acc-head" aria-expanded={i === open} onClick={() => setOpen(i)}>
                  <span>
                    {station(r.from)} → {station(r.to)}
                  </span>
                  <span className="acc-chev" aria-hidden>
                    ›
                  </span>
                </button>
                {i === open &&
                  (current ? (
                    <TrainList key={i} trains={current.trains} from={r.from} to={r.to} type={trainTypeKeyword(settings.trainType)} now={now} />
                  ) : (
                    <p className="hint">{state.error ?? "載入中…"}</p>
                  ))}
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}
