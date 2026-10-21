import { type CSSProperties, lazy, Suspense, useEffect, useRef, useState } from "react";
import { GearIcon } from "./components/GearIcon";
import { LayoutIcon } from "./components/LayoutIcon";
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
import { type Boxes, DEFAULT_LAYOUT, GRID, PANEL_NAMES, PANELS, PHONE_TABS, type Panel, type PhoneTab, type Rect, fits, useSettings } from "./settings";
import { LayoutEditContext, type Rects, area, cardOf, neighbor, onEditLayout, useFlip, useLayoutMode, usePanelDrag, useTabDrag } from "./layoutEdit";
import { moveTo } from "./hooks";

// Leaflet only loads when the parking search is opened.
const Parking = lazy(() => import("./components/Parking"));

const dateFmt = new Intl.DateTimeFormat("zh-TW", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Taipei" });
const timeFmt = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" });

// On a phone everything can't fit on one screen, so sections become tabs (CSS shows them only there).
// Their order is in the settings (layout.tabs).
const TABS: Record<Tab, [label: string, icon: string]> = {
  markets: ["行情", "📈"],
  weather: ["天氣", "⛅"],
  transit: ["交通", "🚌"],
  news: ["新聞", "📰"],
};
type Tab = PhoneTab;

function loadTab(): Tab {
  try {
    const t = localStorage.getItem("tab");
    if (PHONE_TABS.some((id) => id === t)) return t as Tab;
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
  const navRef = useRef<HTMLElement>(null);
  const layoutBtnRef = useRef<HTMLButtonElement>(null);
  const { layout } = settings;
  const flip = useFlip(gridRef, JSON.stringify([layout.wide, layout.tall, layout.transit]));
  const tabFlip = useFlip(navRef, layout.tabs.join(), true);
  useEffect(() => onEditLayout(() => setEditing(true)), []);
  const boxes = mode === "phone" ? null : layout[mode];
  const setLayout = (next: Partial<typeof layout>, first?: Rects) => {
    flip.capture(first);
    setSettings({ ...settings, layout: { ...layout, ...next } });
  };
  const describe = (r: Rect) => `從第 ${r.y + 1} 列第 ${r.x + 1} 欄起，寬 ${r.w} 格、高 ${r.h} 格（整面 ${GRID}×${GRID} 格）`;
  const where = (p: Panel) => (boxes ? describe(boxes[p]) : `第 ${layout.transit.indexOf(p) + 1} 個（共 2 個）`);
  /** Two cards trade places (and sizes); on a phone, bus and train trade order. */
  const swap = (a: Panel, b: Panel, first?: Rects) => {
    if (a === b) return;
    if (boxes) setLayout({ [mode]: { ...boxes, [a]: boxes[b], [b]: boxes[a] } }, first);
    else if (layout.transit.includes(a) && layout.transit.includes(b)) setLayout({ transit: [...layout.transit].reverse() }, first);
    else return;
    setAnnounce(`${PANEL_NAMES[a]}和${PANEL_NAMES[b]}交換了位置`);
  };
  const place = (p: Panel, r: Rect, first?: Rects) => {
    if (!boxes || !fits(boxes, p, r)) return;
    setLayout({ [mode]: { ...boxes, [p]: r } as Boxes }, first);
    setAnnounce(`${PANEL_NAMES[p]}現在${describe(r)}`);
  };
  usePanelDrag(gridRef, editing, mode, boxes, swap, place);
  const moveTab = (from: number, to: number) => {
    if (to < 0 || to >= layout.tabs.length || from === to) return;
    tabFlip.capture();
    setSettings({ ...settings, layout: { ...layout, tabs: moveTo(layout.tabs, from, to) } });
    setAnnounce(`${TABS[layout.tabs[from]][0]}分頁移到第 ${to + 1} 個`);
  };
  useTabDrag(navRef, editing && mode === "phone", moveTab);
  const edit = {
    editing,
    mode,
    where,
    move: (p: Panel, key: string, resize: boolean) => {
      const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key] ?? [0, 0];
      if (boxes) {
        const r = boxes[p];
        const next = resize ? { ...r, w: r.w + dx, h: r.h + dy } : { ...r, x: r.x + dx, y: r.y + dy };
        if (fits(boxes, p, next)) return place(p, next);
        if (resize) return;
      }
      // Blocked (or a phone): swap with the card that way.
      const grid = gridRef.current;
      const el = grid && cardOf(grid, p);
      const other = el && neighbor(grid, el, key);
      if (other) swap(p, PANELS.find((q) => other.classList.contains(q))!);
    },
  };
  // Where each card goes: --wide-markets: "1 / 1 / span 6 / span 24" and so on (styles.css picks
  // the layout); on a phone, --transit-bus / --transit-train order the transit tab.
  const areas = Object.fromEntries([
    ...(["wide", "tall"] as const).flatMap((m) => PANELS.map((p) => [`--${m}-${p}`, area(layout[m][p])])),
    ...layout.transit.map((p, i) => [`--transit-${p}`, i]),
  ]) as CSSProperties;
  // Entering edit mode puts focus on the first thing to move, for keyboard users.
  // Leaving edit mode hands focus back to the header's layout button (the bar's one is gone).
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) layoutBtnRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  useEffect(() => {
    if (!editing) return;
    if (mode === "phone") navRef.current?.querySelector<HTMLElement>("[data-tab-id]")?.focus();
    else {
      const first = [...PANELS].sort((a, b) => layout[mode][a].y - layout[mode][b].y || layout[mode][a].x - layout[mode][b].x)[0];
      gridRef.current?.querySelector<HTMLElement>(`.card.${first} .card-move`)?.focus();
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEditing(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Only when edit mode starts or the layout switches, not on every swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, mode]);
  const resetLayout = () => {
    if (mode !== "phone") setLayout({ [mode]: DEFAULT_LAYOUT[mode] });
    else {
      tabFlip.capture();
      setLayout({ tabs: DEFAULT_LAYOUT.tabs, transit: DEFAULT_LAYOUT.transit });
    }
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
              <span className="layout-bar-hint">
                {mode !== "phone"
                  ? "拖到另一板塊上交換、拖到空位移動，拖右下角調整大小"
                  : tab === "transit"
                    ? "拖動卡片或分頁調整位置"
                    : "拖動底部分頁調整順序"}
              </span>
              <button onClick={resetLayout}>恢復預設</button>
              {/* Same place as the header's layout button: tap it again to finish. */}
              <button
                className="icon-btn layout-toggle"
                aria-pressed="true"
                onClick={() => setEditing(false)}
                aria-label="結束排版模式"
                title="結束排版模式"
              >
                <LayoutIcon />
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
          <button
            ref={layoutBtnRef}
            className="icon-btn layout-toggle"
            aria-pressed="false"
            onClick={() => setEditing(true)}
            aria-label="排版模式"
            title="排版模式：拖動板塊調整位置"
          >
            <LayoutIcon />
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
        <nav ref={navRef} className={`tabbar ${editing ? "editing" : ""}`}>
          {layout.tabs.map((id, i) => (
            <button
              key={id}
              data-tab-id={id}
              aria-selected={tab === id}
              onClick={() => choose(id)}
              aria-label={
                editing ? `${TABS[id][0]}分頁，第 ${i + 1} 個（共 ${layout.tabs.length} 個）。按左右方向鍵移動位置` : undefined
              }
              aria-keyshortcuts={editing ? "ArrowLeft ArrowRight" : undefined}
              onKeyDown={(e) => {
                if (!editing || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
                e.preventDefault();
                moveTab(i, i + (e.key === "ArrowLeft" ? -1 : 1));
              }}
            >
              <span className="tab-icon">{TABS[id][1]}</span>
              {TABS[id][0]}
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
