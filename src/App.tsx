import { type CSSProperties, lazy, Suspense, useEffect, useRef, useState } from "react";
import { GearIcon } from "./components/GearIcon";
import { Flip } from "./components/Flip";
import { Markets } from "./components/Markets";
import { News } from "./components/News";
import { Reliability } from "./components/Reliability";
import { Settings } from "./components/Settings";
import { Bus, Train } from "./components/Transit";
import { Weather } from "./components/Weather";
import { type Scene, type SceneKind, WeatherFx } from "./components/WeatherFx";
import { useNow, useWakeLock } from "./hooks";
import { ScreenSaver } from "./components/ScreenSaver";
import { useFx, useSaver, useTheme } from "./theme";
import { type ContentSection, onOpenSettings } from "./openSettings";
import { toast } from "./toast";
import { DEFAULT_LAYOUT, type LayoutMode, PANEL_NAMES, PANELS, type Panel, useSettings } from "./settings";
import { LayoutEditContext, type Rects, cardOf, neighbor, onEditLayout, useFlip, useLayoutMode, usePanelDrag } from "./layoutEdit";

// Leaflet only loads when the parking search is opened.
const Parking = lazy(() => import("./components/Parking"));

const dateFmt = new Intl.DateTimeFormat("zh-TW", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Taipei" });
const timeFmt = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" });

// On a phone everything can't fit on one screen, so sections become tabs (CSS shows them only there).
const TABS = [
  ["markets", "行情", "📈"],
  ["weather", "天氣", "⛅"],
  ["transit", "交通", "🚌"],
  ["news", "新聞", "📰"],
] as const;
type Tab = (typeof TABS)[number][0];

function loadTab(): Tab {
  try {
    const t = localStorage.getItem("tab");
    if (TABS.some(([id]) => id === t)) return t as Tab;
  } catch {}
  return "markets";
}

export default function App() {
  const now = useNow(1000);
  const wake = useWakeLock();
  const [tab, setTab] = useState<Tab>(loadTab);
  // "#info" in the URL opens the reliability notes directly (handy for sharing the explanation).
  const [showInfo, setShowInfo] = useState(() => location.hash === "#info");
  const [showSettings, setShowSettings] = useState(() => location.hash === "#settings");
  // Opened from a card's gear: straight to that card's page of the settings.
  const [settingsSection, setSettingsSection] = useState<ContentSection | undefined>();
  useEffect(() => onOpenSettings((s) => (setSettingsSection(s), setShowSettings(true))), []);
  const [showParking, setShowParking] = useState(() => location.hash === "#parking");
  const [theme, setTheme] = useTheme();
  const [fx, setFx] = useFx();
  const [saver, setSaver] = useSaver();
  const [saverPreview, setSaverPreview] = useState(false);
  const [scene, setScene] = useState<Scene | null>(null);
  // "?fx=rain" (or clear, cloudy, overcast, fog, drizzle, heavy, storm, snow; "&night" for night)
  // previews an animation regardless of the real weather.
  const params = new URLSearchParams(location.search);
  const preview: Scene | null = params.get("fx") ? { kind: params.get("fx") as SceneKind, day: !params.has("night") } : null;
  const shown = preview ?? scene;
  const { settings, setSettings } = useSettings();
  const mode = useLayoutMode();
  const [editing, setEditing] = useState(false);
  const [announce, setAnnounce] = useState("");
  const gridRef = useRef<HTMLElement>(null);
  const flip = useFlip(gridRef, JSON.stringify(settings.layout));
  useEffect(() => onEditLayout(() => setEditing(true)), []);
  const setSlots = (m: LayoutMode, slots: Panel[], first?: Rects) => {
    flip.capture(first);
    setSettings({ ...settings, layout: { ...settings.layout, [m]: slots } });
  };
  const swap = (a: Panel, b: Panel, first?: Rects) => {
    if (mode === "phone" || a === b) return;
    const slots = [...settings.layout[mode]];
    const i = slots.indexOf(a);
    const j = slots.indexOf(b);
    [slots[i], slots[j]] = [slots[j], slots[i]];
    setSlots(mode, slots, first);
    setAnnounce(`${PANEL_NAMES[a]}和${PANEL_NAMES[b]}交換了位置，${PANEL_NAMES[a]}現在在第 ${j + 1} 格`);
  };
  usePanelDrag(gridRef, editing, mode, swap);
  const edit = {
    editing,
    mode,
    slot: (p: Panel) => (mode === "phone" ? 0 : settings.layout[mode].indexOf(p)),
    move: (p: Panel, key: string) => {
      const grid = gridRef.current;
      const el = grid && cardOf(grid, p);
      const other = el && neighbor(grid, el, key);
      if (!other) return false;
      swap(p, PANELS.find((q) => other.classList.contains(q))!);
      return true;
    },
  };
  // Grid areas from the slot lists: --wide-markets: w0 and so on (styles.css picks the layout).
  const areas = Object.fromEntries(
    (["wide", "tall"] as const).flatMap((m) => settings.layout[m].map((p, i) => [`--${m}-${p}`, `${m[0]}${i}`])),
  ) as CSSProperties;
  // Entering edit mode puts focus on the first card's move button, for keyboard users.
  useEffect(() => {
    if (!editing) return;
    const first = mode === "phone" ? null : settings.layout[mode][0];
    if (first) gridRef.current?.querySelector<HTMLElement>(`.card.${first} .card-move`)?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEditing(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Only when edit mode starts or the layout switches, not on every swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, mode]);
  const resetLayout = () => {
    if (mode !== "phone") setSlots(mode, DEFAULT_LAYOUT[mode]);
    setAnnounce("已恢復預設版面");
    toast("已恢復預設版面");
  };

  const choose = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem("tab", t);
    } catch {}
  };

  return (
    <>
      {fx && shown && <WeatherFx scene={shown} />}
      <div className="app">
        <header className={`top ${editing ? "top-editing" : ""}`}>
          {editing && (
            <div className="layout-bar" role="toolbar" aria-label="調整版面">
              <span className="layout-bar-hint">{mode === "phone" ? "調整版面" : "拖動板塊，放到另一格就會交換位置"}</span>
              <button onClick={resetLayout}>恢復預設</button>
              <button className="layout-done" onClick={() => setEditing(false)}>
                完成
              </button>
              <span className="sr-only" aria-live="polite">
                {announce}
              </span>
            </div>
          )}
          <Flip className="clock" value={timeFmt.format(now)} />
          <div className="date">{dateFmt.format(now)}</div>
          <button className="icon-btn pk-open" onClick={() => setShowParking(true)} aria-label="停車場搜尋" title="停車場搜尋">
            P
          </button>
          <button className="info-btn" onClick={() => setShowInfo(true)} aria-label="資料可靠度說明" title="資料可靠度說明">
            i
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="設定" title="設定">
            <GearIcon />
          </button>
        </header>
        <LayoutEditContext.Provider value={edit}>
          <main ref={gridRef} className={`grid ${editing ? "editing" : ""}`} data-tab={tab} style={areas}>
            <Markets />
            <Weather onScene={setScene} />
            <Bus />
            <Train />
            <News />
          </main>
        </LayoutEditContext.Provider>
        <nav className="tabbar">
          {TABS.map(([id, label, icon]) => (
            <button key={id} aria-selected={tab === id} onClick={() => choose(id)}>
              <span className="tab-icon">{icon}</span>
              {label}
            </button>
          ))}
          <button onClick={() => setShowParking(true)}>
            <span className="tab-icon">🅿️</span>
            停車
          </button>
        </nav>
        {showParking && (
          <Suspense fallback={<div className="parking pk-loading">載入地圖中…</div>}>
            <Parking onClose={() => setShowParking(false)} />
          </Suspense>
        )}
        {showInfo && <Reliability onClose={() => setShowInfo(false)} />}
        {showSettings && (
          <Settings
            theme={theme}
            onTheme={setTheme}
            fx={fx}
            onFx={setFx}
            wake={wake}
            saver={saver}
            onSaver={setSaver}
            onSaverPreview={() => (setShowSettings(false), setSaverPreview(true), toast("螢幕保護預覽中（20 秒）", "info"))}
            onEditLayout={() => (setShowSettings(false), setSettingsSection(undefined), setEditing(true))}
            section={settingsSection}
            onShowSources={() => (setShowSettings(false), setSettingsSection(undefined), setShowInfo(true))}
            onClose={() => (setShowSettings(false), setSettingsSection(undefined))}
          />
        )}
      </div>
      <ScreenSaver minutes={saver} preview={saverPreview} onPreviewEnd={() => setSaverPreview(false)} />
    </>
  );
}
