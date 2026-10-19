import { BUS_ESTIMATE_STALE_MIN, BUS_STOPS, REFRESH_SEC, STALE_AFTER_SEC, TOWARD_TAIPEI, TRAIN, links } from "../config";
import { countdown } from "../format";
import { getJSON, useNow, usePolling, useScrollHint } from "../hooks";
import type { BusArrival, BusResponse, TrainResponse } from "../shared";
import { Section } from "./Section";

const NOT_CONFIGURED = <p className="hint">尚未設定 TDX 金鑰，請參考 README。</p>;

/** Keep the configured direction; "auto" keeps whichever direction heads toward Taipei. */
function wanted(a: BusArrival, all: BusArrival[]): boolean {
  const cfg = BUS_STOPS.find((s) => s.route === a.route);
  if (!cfg) return false;
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
  const routes = BUS_STOPS.map((s) => `${s.city}:${s.route}:${s.stop}`).join(",");
  const state = usePolling(() => getJSON<BusResponse>(`/api/bus?routes=${encodeURIComponent(routes)}`), REFRESH_SEC.bus);
  const listRef = useScrollHint<HTMLUListElement>();
  const all = state.data?.arrivals ?? [];
  const rows = all
    .filter((a) => wanted(a, all))
    .sort((a, b) => (busLeft(a, now) ?? 1e9) - (busLeft(b, now) ?? 1e9));
  return (
    <Section title="公車" className="bus" state={state} maxAgeSec={STALE_AFTER_SEC.bus}>
      {state.data && !state.data.configured ? (
        NOT_CONFIGURED
      ) : (
        <ul className="list scroll" ref={listRef}>
          {rows.map((a) => {
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
          {state.data?.notFound.map((p) => (
            <li key={p} className="hint error">找不到站牌：{p.replace(":", " ")}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function Train() {
  const now = useNow(1000);
  const q = new URLSearchParams({ from: TRAIN.from, to: TRAIN.to, type: TRAIN.type, limit: String(TRAIN.limit) });
  const state = usePolling(() => getJSON<TrainResponse>(`/api/train?${q}`), REFRESH_SEC.train);
  const listRef = useScrollHint<HTMLUListElement>();
  const local = new Date(now + 8 * 3600_000);
  const nowSec = local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds();
  const today = local.toISOString().slice(0, 10);
  // Seconds until the train actually leaves (scheduled time + reported delay).
  const trains = (state.data?.trains ?? [])
    .map((t) => ({ ...t, left: (toMin(t.departure) + (t.delayMin ?? 0)) * 60 - nowSec }))
    .filter((t) => t.left > -30); // drop ones that left since the last refresh
  return (
    <Section title={`火車 ${TRAIN.from} → 台北`} className="train" state={state} maxAgeSec={STALE_AFTER_SEC.train}>
      {state.data && !state.data.configured ? (
        NOT_CONFIGURED
      ) : (
        <ul className="list scroll" ref={listRef}>
          {trains.map((t) => {
            return (
              <li key={t.trainNo}>
                <a className="row link" href={links.train(t.trainNo, today)} target="_blank" rel="noopener noreferrer">
                  <span className="time">{t.departure}</span>
                  <span className="grow">
                    <div>
                      {t.type} <span className="muted small">{t.trainNo} 次・往{t.endingStation}</span>
                    </div>
                    <div className="muted small">
                      {t.arrival} 抵達台北・
                      {t.delayMin == null ? "無即時資訊" : t.delayMin > 0 ? <span className="red">晚 {t.delayMin} 分</span> : "準點"}
                    </div>
                  </span>
                  <span className={`eta ${t.left < 300 ? "red" : ""}`}>{t.left <= 30 ? "即將發車" : countdown(t.left)}</span>
                </a>
              </li>
            );
          })}
          {state.data?.configured && !trains.length && <li className="hint">今天已經沒有區間車了</li>}
        </ul>
      )}
    </Section>
  );
}
