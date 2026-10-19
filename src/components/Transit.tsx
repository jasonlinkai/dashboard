import { BUS_ESTIMATE_STALE_MIN, BUS_STOPS, REFRESH_SEC, STALE_AFTER_SEC, TOWARD_TAIPEI, TRAINS, TRAIN_LIMIT, TRAIN_TYPE, links } from "../config";
import { Fragment, useState } from "react";
import { countdown } from "../format";
import { getJSON, useNow, usePolling, useScrollHint } from "../hooks";
import type { BusArrival, BusResponse, TrainDeparture, TrainResponse } from "../shared";
import { Section } from "./Section";

const NOT_CONFIGURED = <p className="hint">尚未設定 TDX 金鑰，請參考 README。</p>;

/** Keep the configured direction; "auto" keeps whichever direction heads toward Taipei. */
function wanted(a: BusArrival, all: BusArrival[]): boolean {
  const cfg = BUS_STOPS.find((s) => s.route === a.route);
  if (!cfg) return false;
  if (cfg.toward) return true; // the backend already kept only buses heading there
  if (cfg.direction !== "auto") return a.direction === cfg.direction;
  const toward = all.filter((x) => x.route === a.route && TOWARD_TAIPEI.test(x.headsign));
  const dirs = new Set(toward.map((x) => x.direction));
  // If both or neither direction looks like Taipei we can't tell, so show both.
  return dirs.size !== 1 || dirs.has(a.direction);
}

// TDX re-estimates about once a minute; older than this and the countdown may be off.
const BUS_STALE_MS = BUS_ESTIMATE_STALE_MIN * 60_000;

/** Seconds left, counted down locally from when TDX made the estimate. */
const busLeft = (a: BusArrival, now: number) => (a.estimateSec == null ? null : a.estimateSec - (now - a.asOf) / 1000);

function eta(left: number | null, status: string | null): { text: string; cls: string } {
  if (left == null) return { text: status ?? "—", cls: "muted" };
  if (left <= 30) return { text: "即將進站", cls: "red" };
  return { text: countdown(left), cls: left < 180 ? "red" : "" };
}

export function Bus() {
  const now = useNow(1000);
  const routes = BUS_STOPS.map((s) => [s.city, s.route, s.stop, ...(s.toward ? [s.toward] : [])].join(":")).join(",");
  const state = usePolling(() => getJSON<BusResponse>(`/api/bus?routes=${encodeURIComponent(routes)}`), REFRESH_SEC.bus);
  const listRef = useScrollHint<HTMLUListElement>();
  const all = state.data?.arrivals ?? [];
  const rows = all.filter((a) => wanted(a, all));
  // Groups in config order (往台北 first), soonest bus first within a group.
  const groups = [...new Set(BUS_STOPS.map((s) => s.group))].map((group) => ({
    group,
    rows: rows
      .filter((a) => BUS_STOPS.find((s) => s.route === a.route)?.group === group)
      .sort((a, b) => (busLeft(a, now) ?? 1e9) - (busLeft(b, now) ?? 1e9)),
  })).filter((g) => g.rows.length);
  return (
    <Section title="公車" className="bus" state={state} maxAgeSec={STALE_AFTER_SEC.bus}>
      {state.data && !state.data.configured ? (
        NOT_CONFIGURED
      ) : (
        <ul className="list scroll" ref={listRef}>
          {groups.map((g) => (
            <Fragment key={g.group}>
              <li className="list-group">{g.group}</li>
              {g.rows.map((a) => {
                const e = eta(busLeft(a, now), a.status);
                return (
                  <li key={`${a.route}-${a.direction}-${a.stop}`}>
                    <a className="row link" href={links.bus(a.routeId)} target="_blank" rel="noopener noreferrer">
                      <span className="chip blue-chip">{a.route}</span>
                      <span className="grow">
                        <div>{a.headsign}</div>
                        <div className="muted small">
                          {a.stop} 站
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

/** One route's departures. Keyed by route so its scroll position and hint start fresh. */
function TrainList({ trains, to, now }: { trains: TrainDeparture[]; to: string; now: number }) {
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
        <li key={t.trainNo}>
          <a className="row link" href={links.train(t.trainNo, today)} target="_blank" rel="noopener noreferrer">
            <span className="time">{t.departure}</span>
            <span className="grow">
              <div>
                {t.type} <span className="muted small">{t.trainNo} 次・往{t.endingStation}</span>
              </div>
              <div className="muted small">
                {t.arrival} 抵達{station(to)}・
                {t.delayMin == null ? "無即時資訊" : t.delayMin > 0 ? <span className="red">晚 {t.delayMin} 分</span> : "準點"}
              </div>
            </span>
            <span className={`eta ${t.left < 300 ? "red" : ""}`}>{t.left <= 30 ? "即將發車" : countdown(t.left)}</span>
          </a>
        </li>
      ))}
      {!rows.length && <li className="hint">今天已經沒有{TRAIN_TYPE}車了</li>}
    </ul>
  );
}

/**
 * Accordion of routes; exactly one is open, and only that one is polled, so the TDX quota
 * (shared with the buses) doesn't grow with the number of routes.
 */
export function Train() {
  const now = useNow(1000);
  const [open, setOpen] = useState(0);
  const route = TRAINS[open];
  const q = new URLSearchParams({ from: route.from, to: route.to, type: TRAIN_TYPE, limit: String(TRAIN_LIMIT) });
  const state = usePolling(() => getJSON<TrainResponse>(`/api/train?${q}`), REFRESH_SEC.train, [open]);
  // Right after switching, the previous route's answer is still in state; don't show it here.
  const current = state.data && state.data.from === route.from && state.data.to === route.to ? state.data : undefined;
  return (
    <Section title="火車" className="train" state={state} maxAgeSec={STALE_AFTER_SEC.train}>
      {state.data && !state.data.configured ? (
        NOT_CONFIGURED
      ) : (
        <div className="acc">
          {TRAINS.map((r, i) => (
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
                  <TrainList key={i} trains={current.trains} to={r.to} now={now} />
                ) : (
                  <p className="hint">{state.error ?? "載入中…"}</p>
                ))}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
