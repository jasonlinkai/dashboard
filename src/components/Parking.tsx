// Full-screen car park search: pick a destination (search, my location, or tap the map), see the
// TDX car parks within a radius on a map and in a sortable list, and hand off to Google Maps.
// Loaded on demand (Leaflet is ~150 KB), so the board itself stays light.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { getJSON } from "../hooks";
import type { GeoHit, GeoResponse, ParkingLot, ParkingResponse, ParkingSource, SpaceCount } from "../shared";
import { toast } from "../toast";

const RADII = [300, 500, 1000, 2000] as const;
type Radius = (typeof RADII)[number];
interface Dest {
  lat: number;
  lon: number;
  label: string;
}

const REFRESH_SEC = 120; // the server refreshes live spaces at most every 2 minutes
/** A car park's own count older than this is marked as possibly out of date. */
const LIVE_OLD_MIN = 15;
const STORE = "parking.v1";

const ALL_SOURCES: ParkingSource[] = ["TDX", "NTPC", "OSM"];
/** OpenStreetMap is off by default: many of its car parks turn out to be private or gone. */
const DEFAULT_SOURCES: ParkingSource[] = ["TDX", "NTPC"];

function load(): { dest: Dest | null; radius: Radius; sources: ParkingSource[]; liveOnly: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    const dest =
      v.dest && Number.isFinite(v.dest.lat) && Number.isFinite(v.dest.lon) && typeof v.dest.label === "string" ? (v.dest as Dest) : null;
    const sources = Array.isArray(v.sources) ? ALL_SOURCES.filter((x) => v.sources.includes(x)) : DEFAULT_SOURCES;
    return {
      dest,
      radius: RADII.includes(v.radius) ? v.radius : 500,
      sources,
      liveOnly: v.liveOnly === true,
    };
  } catch {
    return { dest: null, radius: 500, sources: DEFAULT_SOURCES, liveOnly: false };
  }
}

const fmtDistance = (m: number) => (m < 1000 ? `${m} 公尺` : `${(m / 1000).toFixed(1)} 公里`);
const hm = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" });
const coordNavUrl = (p: { lat: number; lon: number }) =>
  `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lon.toFixed(6)}&travelmode=driving`;
/**
 * Navigate by name + address, so Google opens the actual place (entrance, hours) instead of a
 * bare pin. Names alone are often vague ("Times松勤街"), hence the address; without an address
 * fall back to the exact coordinates. The coordinate link stays available as a backup.
 */
const navUrl = (p: { lat: number; lon: number; name: string; address: string }) =>
  p.address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${p.name} ${p.address}`)}&travelmode=driving`
    : coordNavUrl(p);

/** Each source's mark: the letter in the pin's corner badge, the legend, and the list. */
const SOURCE: Record<ParkingSource, { badge: string; short: string; long: string }> = {
  TDX: { badge: "T", short: "TDX", long: "交通部 TDX" },
  NTPC: { badge: "新", short: "新北", long: "新北市政府開放資料" },
  OSM: { badge: "O", short: "OSM", long: "OpenStreetMap（只有位置）" },
};

function SourceTags({ lot }: { lot: ParkingLot }) {
  return (
    <span className="pk-srcs" title={`來源：${lot.sources.map((s) => SOURCE[s].long).join("、")}`}>
      {lot.sources.map((s) => (
        <span key={s} className={`pk-src src-${s.toLowerCase()}`}>
          {SOURCE[s].badge}
        </span>
      ))}
    </span>
  );
}

/** The count to show and compare: cars when broken down, else the undivided total. */
const mainCount = (p: ParkingLot): SpaceCount => p.car ?? p.spaces;

/** old: there is a count, but it is too old to trust, so it isn't coloured as good or bad. */
type Level = "ok" | "low" | "full" | "old" | "unknown";
function level(p: ParkingLot, now = Date.now()): Level {
  const c = mainCount(p);
  if (p.live !== "ok" || !c) return "unknown";
  const age = liveAgeMin(p, now);
  if (age == null || age > LIVE_OLD_MIN) return "old";
  if (c.available === 0) return "full";
  if (c.available <= 5 || (c.total && c.available / c.total < 0.1)) return "low";
  return "ok";
}

function liveAgeMin(p: ParkingLot, now: number): number | null {
  const t = p.liveTime ? Date.parse(p.liveTime) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60000)) : null;
}

function fareText(p: ParkingLot): string {
  const e = p.fareEstimate;
  const r = (x: { min: number; max: number }) => (x.min === x.max ? `${x.min}` : `${x.min}–${x.max}`);
  if (e?.hourly) return `約 ${r(e.hourly)} 元/時`;
  if (e?.perEntry) return `約 ${r(e.perEntry)} 元/次`;
  if (!p.fare) return "未提供費率";
  if (/現場/.test(p.fare) && p.fare.length < 12) return "費率依現場公告";
  if (p.fare.length <= 16 && !p.fare.includes("\n")) return p.fare; // e.g. 免費（OpenStreetMap 標示）
  return "費率見說明";
}



export default function Parking({ onClose }: { onClose: () => void }) {
  const saved = useMemo(load, []);
  const [dest, setDest] = useState<Dest | null>(saved.dest);
  const [radius, setRadius] = useState<Radius>(saved.radius);
  /** Sources to show (a car park found by several sources shows if any of them is on). */
  const [sources, setSources] = useState<ParkingSource[]>(saved.sources);
  const [liveOnly, setLiveOnly] = useState(saved.liveOnly);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeoResponse | null>(null);
  /** Where the map is looking, so a search like "麥當勞" finds the branches around there. */
  const view = useRef<{ lat: number; lon: number; zoom: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [data, setData] = useState<ParkingResponse | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ dest, radius, sources, liveOnly }));
    } catch {}
  }, [dest, radius, sources, liveOnly]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    // iOS Safari can still pinch-zoom the page despite touch-action; its gesture events can be
    // cancelled. Leaflet zooms the map from touch events, so the map keeps its pinch.
    const noZoom = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", onKey);
    document.addEventListener("gesturestart", noZoom);
    document.addEventListener("gesturechange", noZoom);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("gesturestart", noZoom);
      document.removeEventListener("gesturechange", noZoom);
    };
  }, []);

  // Fetch for the current destination, then refresh live spaces every 2 minutes while visible.
  useEffect(() => {
    if (!dest) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async (first: boolean) => {
      if (!first && document.visibilityState !== "visible") {
        timer = setTimeout(() => run(false), 10_000);
        return;
      }
      setLoading(true);
      try {
        const res = await getJSON<ParkingResponse>(`/api/parking?lat=${dest.lat.toFixed(6)}&lon=${dest.lon.toFixed(6)}&r=${radius}`);
        if (!active) return;
        setData(res.data);
        setStale(res.stale);
        setError(null);
        setNow(Date.now());
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
        if (first) setData(null);
      } finally {
        if (active) setLoading(false);
        if (active) timer = setTimeout(() => run(false), REFRESH_SEC * 1000);
      }
    };
    setSelected(null);
    run(true);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [dest, radius]);

  const lots = useMemo(
    () =>
      // The server sends them nearest first.
      (data?.lots ?? []).filter((p) => p.sources.some((x) => sources.includes(x)) && (!liveOnly || (p.live === "ok" && mainCount(p)))),
    [data, sources, liveOnly],
  );
  const hiddenCount = (data?.lots.length ?? 0) - lots.length;
  const toggleSource = (x: ParkingSource) => {
    const next = sources.includes(x) ? sources.filter((y) => y !== x) : ALL_SOURCES.filter((y) => y === x || sources.includes(y));
    setSources(next);
    toast(`${sources.includes(x) ? "隱藏" : "顯示"}${SOURCE[x].long.replace("（只有位置）", "")}的停車場`, "info");
  };

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      // Search around the map's centre once it shows a town-sized area (not all of Taiwan).
      const v = view.current;
      const near = v && v.zoom >= 11 ? `&lat=${v.lat.toFixed(4)}&lon=${v.lon.toFixed(4)}` : "";
      const res = await getJSON<GeoResponse>(`/api/geocode?q=${encodeURIComponent(q)}${near}`);
      const found = res.data.hits;
      if (!found.length) {
        setHits(null);
        toast(
          res.data.errors.length ? `找不到這個地點（${res.data.errors.join("；")}）` : "找不到這個地點，換個說法，或直接在地圖上點選位置",
          "error",
        );
      } else if (found.length === 1 && !res.data.errors.length) {
        choose(found[0]);
      } else setHits(res.data);
    } catch (err) {
      toast(`搜尋失敗：${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setSearching(false);
    }
  };

  const choose = (h: GeoHit) => {
    setHits(null);
    setDest({ lat: h.lat, lon: h.lon, label: h.name || h.address });
    toast(`目的地：${h.name || h.address}`, "info");
  };

  const locate = () => {
    if (!("geolocation" in navigator)) return toast("這個瀏覽器無法取得位置", "error");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setHits(null);
        setDest({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: "目前位置" });
        toast("已改用目前位置", "info");
      },
      (err) => {
        setLocating(false);
        toast(err.code === err.PERMISSION_DENIED ? "沒有位置權限，請在瀏覽器設定允許，或改用搜尋" : "無法取得目前位置", "error");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  const pickOnMap = (lat: number, lon: number) => {
    setHits(null);
    setDest({ lat, lon, label: "地圖上選的位置" });
    toast("已設為目的地", "info");
  };

  const select = (id: string, from: "map" | "list") => {
    setSelected(id);
    if (from === "map") document.getElementById(`lot-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  // "No live feed" only matters for a city that has car parks in range.
  const problems = (data?.cities ?? []).filter(
    (c) => c.lots !== "ok" || (c.live !== "ok" && data!.lots.some((p) => p.city === c.city)),
  );
  const osmAsOf = data?.extra.find((x) => x.source === "OSM")?.asOf;
  const osmDate = osmAsOf ? osmAsOf.slice(0, 10) : null;
  // Only when the sources have no live data here, not when it just failed to load (that has its own note).
  const noLiveAtAll = lots.length > 0 && lots.every((p) => p.live === "none");

  return (
    <div className="parking" role="dialog" aria-modal="true" aria-labelledby="parking-title">
      <header className="pk-head">
        <h2 id="parking-title">停車場搜尋</h2>
        <button className="modal-close" onClick={onClose} aria-label="關閉">
          ✕
        </button>
      </header>

      <form className="pk-search" onSubmit={search}>
        <input
          type="search"
          enterKeyHint="search"
          placeholder="目的地：地址或地標，例如 台北101"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="目的地"
        />
        <button type="submit" className="pk-btn primary" disabled={searching || !query.trim()}>
          {searching ? "搜尋中…" : "搜尋"}
        </button>
        <button type="button" className="pk-btn" onClick={locate} disabled={locating} title="用目前位置">
          {locating ? "定位中…" : "📍 目前位置"}
        </button>
      </form>

      {hits && (
        <ul className="pk-hits" aria-label="搜尋結果">
          <li className="muted small">
            {hits.nearby ? "地圖目前位置附近的結果（近到遠），請選擇：" : "全台的搜尋結果，請選擇："}
          </li>
          {!hits.nearby && (
            <li className="muted tiny pk-hits-tip">想找附近的分店？先把地圖移到大概的位置（或按「目前位置」），再搜尋一次。</li>
          )}
          {hits.errors.map((e) => (
            <li key={e} className="tiny pk-hits-tip warn">⚠ {e}，以下只有另一個來源的結果</li>
          ))}
          {hits.hits.map((h, i) => (
            <li key={i}>
              <button onClick={() => choose(h)}>
                <span className="pk-hit-top">
                  <b>{h.name}</b>
                  {h.distance != null && <span className="muted small">{fmtDistance(h.distance)}</span>}
                </span>
                <span className="muted small">
                  {h.address && h.address !== h.name ? `${h.address}・` : ""}
                  {h.source === "OSM" ? "OpenStreetMap" : "TDX"}
                </span>
              </button>
            </li>
          ))}
          <li>
            <button className="muted small" onClick={() => setHits(null)}>
              都不是，關閉（也可以直接在地圖上點選位置）
            </button>
          </li>
        </ul>
      )}

      <div className="pk-controls">
        <div className="pk-control">
          <span className="muted small">範圍</span>
          <div className="segmented" role="radiogroup" aria-label="搜尋半徑">
            {RADII.map((r) => (
              <button key={r} role="radio" aria-checked={radius === r} onClick={() => setRadius(r)}>
                {r < 1000 ? `${r}m` : `${r / 1000}km`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="pk-filters" role="group" aria-label="篩選">
        <span className="muted small">顯示</span>
        {ALL_SOURCES.map((x) => (
          <button key={x} className="pk-filter" aria-pressed={sources.includes(x)} onClick={() => toggleSource(x)}>
            <span className={`pk-src src-${x.toLowerCase()}`}>{SOURCE[x].badge}</span>
            {SOURCE[x].short}
          </button>
        ))}
        <button
          className="pk-filter"
          aria-pressed={liveOnly}
          onClick={() => (setLiveOnly(!liveOnly), toast(liveOnly ? "顯示所有停車場" : "只顯示有即時空位的停車場", "info"))}
        >
          只看有即時空位
        </button>
      </div>

      <div className="pk-body">
        <ParkingMap dest={dest} radius={radius} lots={lots} selected={selected} onSelect={(id) => select(id, "map")} onPick={pickOnMap} onView={(v) => (view.current = v)} />

        <div className="pk-list">
          {!dest && <p className="pk-note">輸入目的地、按「目前位置」，或直接在地圖上點一下，就會列出附近的停車場。</p>}
          {dest && (
            <div className="pk-summary">
              <span>
                <b>{dest.label}</b> 半徑 {fmtDistance(radius)}內
                {data && !loading && (
                  <>
                    {" "}
                    ・{lots.length} 個停車場{hiddenCount > 0 && <span className="muted">（篩選隱藏 {hiddenCount} 個）</span>}
                  </>
                )}
                {loading && " ・載入中…"}
                <span className="pk-dist-note muted small">
                  每個停車場右側的距離，是從目的地（地圖上的紅色圖釘）到停車場的直線距離，實際行車距離會更長。
                </span>
              </span>
              {data && (
                <span className="muted tiny">
                  更新於 {hm.format(now)}
                  {stale && <span className="red">・即時資料延遲</span>}
                </span>
              )}
            </div>
          )}
          {error && (
            <p className="pk-note red">
              ⚠ {error}
              {data ? "（顯示上次結果）" : ""}
            </p>
          )}
          {problems.map((c) => (
            <p key={c.city} className={`pk-note ${c.coveredBy ? "" : "warn"}`}>
              {c.coveredBy
                ? `TDX 沒有${c.name}的停車場資料，${c.name}改用${c.coveredBy}`
                : c.lots === "empty"
                ? `⚠ TDX 目前沒有${c.name}的停車場資料，${c.name}的官方停車場不會出現（可在上方「顯示」打開 OSM 來源看 OpenStreetMap 上的停車場）`
                : c.lots === "error"
                ? `⚠ ${c.name}停車場資料暫時無法取得（${c.error ?? ""}）`
                : c.live === "error"
                  ? `⚠ ${c.name}即時空位暫時無法取得，以下不顯示空位（${c.error ?? ""}）`
                  : `${c.name}目前沒有提供即時空位資料`}
            </p>
          ))}
          {(data?.extra ?? [])
            .filter((x) => x.error)
            .map((x) => (
              <p key={x.source} className="pk-note warn">
                ⚠ {x.name}
                {x.status === "error" ? "暫時無法取得，這個來源的停車場不會出現" : ""}（{x.error}）
              </p>
            ))}
          {data && !loading && data.lots.length > 0 && lots.length === 0 && (
            <p className="pk-note">
              附近的 {data.lots.length} 個停車場都被篩選隱藏了，可以在上方「顯示」打開其他來源
              {!sources.includes("OSM") && "（OSM 預設關閉：OpenStreetMap 的停車場常是私人或已不存在，只有位置）"}。
            </p>
          )}
          {data && !loading && data.lots.length === 0 && !error && (
            <p className="pk-note">
              這個範圍內沒有找到停車場。可以加大半徑。
              {" 注意：各資料來源都沒有涵蓋所有停車場，沒列出不代表附近沒有停車場。"}
            </p>
          )}
          {noLiveAtAll && <p className="pk-note">這附近的停車場都沒有即時空位資料，空位請以現場為準。</p>}

          <ol className="pk-lots">
            {lots.map((p) => (
              <LotItem key={p.id} lot={p} now={now} destLabel={dest?.label ?? ""} open={selected === p.id} onToggle={() => setSelected(selected === p.id ? null : p.id)} />
            ))}
          </ol>

          <p className="pk-source">
            停車場與即時空位：交通部 TDX 運輸資料流通服務、新北市政府資料開放平臺（政府資料開放授權條款－第1版）、© OpenStreetMap 貢獻者（ODbL，只有位置{osmDate ? `，${osmDate} 的資料` : ""}）・地圖：內政部國土測繪中心・地點搜尋：TDX、© OpenStreetMap 貢獻者（ODbL）・距離為直線距離・費率由業者公告文字推估，實際以現場為準
          </p>
        </div>
      </div>
    </div>
  );
}

function SpaceLine({ lot, now }: { lot: ParkingLot; now: number }) {
  if (lot.live === "unavailable") return <span className="pk-live unknown">即時空位暫時無法取得</span>;
  if (lot.live === "none")
    return <span className="pk-live unknown">{lot.source === "OSM" ? "無即時空位（OpenStreetMap 只有位置）" : "無即時空位資料"}</span>;
  const c = mainCount(lot);
  const age = liveAgeMin(lot, now);
  const time = lot.liveTime ? hm.format(new Date(lot.liveTime)) : null;
  const old = age != null && age > LIVE_OLD_MIN;
  const closed = lot.serviceStatus != null && lot.serviceStatus !== 1;
  return (
    <span className={`pk-live ${level(lot, now)}`}>
      {c ? (
        <>
          {lot.car ? "汽車" : "空位"} {c.available === 0 ? "已滿" : <>剩 <b>{c.available}</b></>}
          {c.total != null && <span className="muted"> / {c.total}</span>}
        </>
      ) : (
        "汽車空位未提供"
      )}
      {lot.scooter && <span className="muted">・機車剩 {lot.scooter.available}</span>}
      {time && (
        <span
          className={old ? "red" : "muted"}
          title={lot.liveTimeIsFetch ? "這個來源沒有提供停車場的回報時間，這是伺服器取得資料的時間（來源約每 3 分鐘更新）" : undefined}
        >
          ・{time}
          {lot.liveTimeIsFetch && " 取得"}
          {old && `（${age! >= 120 ? `${Math.round(age! / 60)} 小時` : `${age} 分鐘`}前，可能已過時）`}
        </span>
      )}
      {closed && <span className="red">・來源標示非營業中</span>}
    </span>
  );
}

function LotItem({
  lot,
  now,
  open,
  onToggle,
  destLabel,
}: {
  lot: ParkingLot;
  now: number;
  open: boolean;
  onToggle: () => void;
  destLabel: string;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);
  return (
    <li id={`lot-${lot.id}`} ref={ref} className={`pk-lot ${open ? "open" : ""}`}>
      <button className="pk-lot-main" onClick={onToggle} aria-expanded={open}>
        <span className={`pk-dot ${level(lot, now)}`} aria-hidden />

        <span className="pk-lot-text">
          <span className="pk-lot-name">
            {lot.name}
            {/機車/.test(lot.name) && !/汽車/.test(lot.name) && <span className="pk-tag">機車</span>}
            {lot.note && <span className="pk-tag">{lot.note}</span>}
            <SourceTags lot={lot} />
          </span>
          <SpaceLine lot={lot} now={now} />
          <span className="pk-fare">{fareText(lot)}</span>
        </span>
        <span className="pk-dist" title="從目的地（地圖上的紅色圖釘）到這個停車場的直線距離">
          {fmtDistance(lot.distance)}
          <small>距目的地</small>
        </span>
      </button>
      {open && (
        <div className="pk-detail">
          {lot.address && (
            <p>
              <b>地址</b>
              {lot.address}
            </p>
          )}
          <p>
            <b>費率</b>
            <span className="pk-fare-full">{lot.fare || "資料來源未提供"}</span>
          </p>
          {lot.fareEstimate && <p className="muted tiny">「{fareText(lot)}」是從上面的文字推估的小型車臨停費率，實際以現場公告為準。</p>}
          {lot.description && (
            <p>
              <b>說明</b>
              {lot.description}
            </p>
          )}
          <p>
            <b>距離</b>
            距目的地「{destLabel}」直線 {fmtDistance(lot.distance)}（實際行車距離會更長）
          </p>
          <p>
            <b>來源</b>
            {lot.sources.map((s, i) => `${SOURCE[s].long}${i === 0 && lot.sources.length > 1 ? "（主要）" : ""}`).join("、")}
          </p>
          {lot.sources.length > 1 && (
            <p className="muted tiny">
              這些來源視為同一個停車場（{[...new Set(lot.mergedBecause ?? [])].join("、")}）；顯示資訊最多的那筆，缺的欄位由其他來源補上。
            </p>
          )}
          <a className="pk-btn primary pk-nav" href={navUrl(lot)} target="_blank" rel="noopener noreferrer">
            用 Google 地圖導航
          </a>
          {lot.address && (
            <a className="pk-coord-nav" href={coordNavUrl(lot)} target="_blank" rel="noopener noreferrer">
              Google 找錯地方？改用座標導航（顯示為圖釘，位置精確）
            </a>
          )}
        </div>
      )}
    </li>
  );
}

// ---------- Map ----------

const TILE_URL = "https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}";
const TILE_ATTR = '<a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">© 內政部國土測繪中心</a>';
const TAIWAN: L.LatLngExpression = [23.7, 120.95];

function lotIcon(p: ParkingLot, selected: boolean) {
  const c = mainCount(p);
  const text = p.live === "ok" && c ? (c.available > 999 ? "999+" : String(c.available)) : "P";
  return L.divIcon({
    className: "",
    html: `<div class="pk-pin ${level(p)} src-${p.source.toLowerCase()}${selected ? " sel" : ""}"><i>${SOURCE[p.source].badge}</i>${text}</div>`,
    iconSize: [0, 0],
  });
}

function ParkingMap({
  dest,
  radius,
  lots,
  selected,
  onSelect,
  onPick,
  onView,
}: {
  dest: Dest | null;
  radius: number;
  lots: ParkingLot[];
  selected: string | null;
  onSelect: (id: string) => void;
  onPick: (lat: number, lon: number) => void;
  onView: (v: { lat: number; lon: number; zoom: number }) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const fitted = useRef("");
  /** The circle to keep in view until the user moves the map themselves. */
  const fitTo = useRef<L.LatLngBounds | null>(null);
  const cb = useRef({ onSelect, onPick, onView });
  cb.current = { onSelect, onPick, onView };

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: true, attributionControl: true }).setView(TAIWAN, 7);
    L.tileLayer(TILE_URL, { maxZoom: 19, maxNativeZoom: 19, attribution: TILE_ATTR }).addTo(m);
    m.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    m.on("click", (e: L.LeafletMouseEvent) => cb.current.onPick(e.latlng.lat, e.latlng.lng));
    m.on("dragstart", () => (fitTo.current = null));
    m.on("moveend", () => {
      const c = m.getCenter();
      cb.current.onView({ lat: c.lat, lon: c.lng, zoom: m.getZoom() });
    });
    layer.current = L.layerGroup().addTo(m);
    // Legend: which source each pin's corner letter means.
    const legend = new L.Control({ position: "topright" });
    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "pk-legend");
      div.innerHTML = (Object.keys(SOURCE) as ParkingSource[])
        .map((k) => `<span><i class="pk-src src-${k.toLowerCase()}">${SOURCE[k].badge}</i>${SOURCE[k].short}</span>`)
        .join("");
      L.DomEvent.disableClickPropagation(div);
      return div;
    };
    legend.addTo(m);
    map.current = m;
    // The panel lays out after mount (and the phone rotates): tell Leaflet its real size, and
    // re-zoom to the search circle, which may have been fitted while the map was still 0×0.
    const ro = new ResizeObserver(() => {
      m.invalidateSize();
      if (fitTo.current) m.fitBounds(fitTo.current, { padding: [12, 12], animate: false });
    });
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  // Destination, radius and car parks.
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    markers.current.clear();
    if (!dest) return;
    const circle = L.circle([dest.lat, dest.lon], { radius, color: "#5aa9ff", weight: 1.5, fillOpacity: 0.06, interactive: false }).addTo(g);
    L.marker([dest.lat, dest.lon], {
      // A red map pin whose tip is on the point (the icon's anchor is its bottom middle).
      icon: L.divIcon({
        className: "",
        html: `<svg class="pk-dest" viewBox="0 0 30 42" aria-label="目的地"><path d="M15 41C15 41 28 25.5 28 15A13 13 0 0 0 2 15C2 25.5 15 41 15 41Z" fill="#e5322d" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>`,
        iconSize: [30, 42],
        iconAnchor: [15, 41],
      }),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(g);
    for (const p of lots) {
      // Tapping a pin selects it (highlighted here, opened in the list); no popup bubble.
      const mk = L.marker([p.lat, p.lon], { icon: lotIcon(p, false), title: p.name, riseOnHover: true })
        .on("click", () => cb.current.onSelect(p.id))
        .addTo(g);
      markers.current.set(p.id, mk);
    }
    // Zoom to the circle only when the search changes, not on every 2-minute refresh.
    const key = `${dest.lat},${dest.lon},${radius}`;
    if (fitted.current !== key) {
      fitted.current = key;
      fitTo.current = circle.getBounds();
      m.invalidateSize();
      m.fitBounds(fitTo.current, { padding: [12, 12] });
    }
  }, [dest, radius, lots]);

  useEffect(() => {
    for (const [id, mk] of markers.current) {
      const p = lots.find((x) => x.id === id);
      if (!p) continue;
      mk.setIcon(lotIcon(p, id === selected));
      mk.setZIndexOffset(id === selected ? 900 : 0);
      // Picked in the list: make sure its pin is on screen.
      if (id === selected && map.current && !map.current.getBounds().contains(mk.getLatLng())) map.current.panTo(mk.getLatLng());
    }
  }, [selected, lots]);

  return <div ref={el} className="pk-map" aria-label="停車場地圖，點地圖可設定目的地" />;
}
