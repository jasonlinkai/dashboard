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
import { type Boxes, DEFAULT_LAYOUT, GRID, PANEL_NAMES, PANELS, PHONE_TABS, type Panel, type PhoneTab, type Rect, TRANSIT, useSettings } from "./settings";
import {
  BOARD_MIN,
  LayoutEditContext,
  type Rects,
  allFit,
  area,
  cardOf,
  findSpot,
  minCells,
  moveLine,
  neighbor,
  onEditLayout,
  useFlip,
  useLayoutMode,
  usePanelDrag,
  useTabDrag,
} from "./layoutEdit";
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
  const { settings, setSettings } = useSettings();
  const { layout } = settings;
  const { hidden } = layout;
  const shown = preview ?? (hidden.includes("weather") ? null : scene);
  const mode = useLayoutMode();
  const [editing, setEditing] = useState(false);
  const [announce, setAnnounce] = useState("");
  const gridRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const layoutBtnRef = useRef<HTMLButtonElement>(null);
  // Phone tabs left once hidden cards are gone (transit stays while bus or train is shown).
  const shownTabs = layout.tabs.filter((t) => (t === "transit" ? !TRANSIT.every((q) => hidden.includes(q)) : !hidden.includes(t)));
  const shownTab = shownTabs.includes(tab) ? tab : shownTabs[0];
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
  /** Apply a new board if every card still fits at its minimum size on this screen. */
  const setBoxes = (next: Boxes, first?: Rects) => {
    if (!boxes || !gridRef.current || !allFit(gridRef.current, next, hidden)) return false;
    setLayout({ [mode]: next }, first);
    return true;
  };
  /** Two cards trade places (and sizes); on a phone, bus and train trade order. */
  const swap = (a: Panel, b: Panel, first?: Rects) => {
    if (a === b) return;
    if (boxes) {
      if (!setBoxes({ ...boxes, [a]: boxes[b], [b]: boxes[a] }, first)) {
        flip.play(first ?? new Map());
        return toast(`${PANEL_NAMES[a]}和${PANEL_NAMES[b]}的大小差太多，交換後會有一個太小，請先調整大小`, "error");
      }
    } else if (layout.transit.includes(a) && layout.transit.includes(b)) setLayout({ transit: [...layout.transit].reverse() }, first);
    else return;
    setAnnounce(`${PANEL_NAMES[a]}和${PANEL_NAMES[b]}交換了位置`);
  };
  usePanelDrag(gridRef, editing, mode, boxes, hidden, swap, (next, first) => {
    const changed = PANELS.filter((p) => next[p] !== boxes?.[p]);
    if (setBoxes(next, first)) setAnnounce(changed.map((p) => `${PANEL_NAMES[p]}現在${describe(next[p])}`).join("；"));
  });
  /** From / to are places among the tabs shown. */
  const moveTab = (from: number, to: number) => {
    if (to < 0 || to >= shownTabs.length || from === to) return;
    tabFlip.capture();
    const at = (i: number) => layout.tabs.indexOf(shownTabs[i]);
    setSettings({ ...settings, layout: { ...layout, tabs: moveTo(layout.tabs, at(from), at(to)) } });
    setAnnounce(`${TABS[shownTabs[from]][0]}分頁移到第 ${to + 1} 個`);
  };
  const hide = (p: Panel) => {
    if (PANELS.length - hidden.length <= 1) return toast("至少要留一個板塊", "error");
    setLayout({ hidden: [...hidden, p] });
    setAnnounce(`已隱藏${PANEL_NAMES[p]}，可以從上方的「＋${PANEL_NAMES[p]}」顯示回來`);
    setTimeout(() => document.querySelector<HTMLElement>(".layout-bar .layout-toggle")?.focus()); // its button is gone
  };
  /** Back on the dashboard, in its old place if free, else in free cells (in each layout). */
  const unhide = (p: Panel) => {
    const rest = hidden.filter((q) => q !== p);
    const next = { ...layout, hidden: rest };
    for (const m of ["wide", "tall"] as const) {
      const min = m === mode && gridRef.current ? minCells(gridRef.current, p) : BOARD_MIN;
      const r = findSpot(layout[m], p, rest, [{ w: layout[m][p].w, h: layout[m][p].h }, min]);
      if (!r)
        return toast(`${m === "wide" ? "桌機與平板橫向" : "平板直向"}的版面沒有空位放${PANEL_NAMES[p]}，請先縮小其他板塊再顯示`, "error");
      next[m] = { ...layout[m], [p]: r };
    }
    setLayout(next);
    setAnnounce(`已顯示${PANEL_NAMES[p]}`);
  };
  useTabDrag(navRef, editing && mode === "phone", moveTab);
  const edit = {
    editing,
    mode,
    where,
    hide,
    move: (p: Panel, key: string, how: "move" | "resize" | "line") => {
      const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key] ?? [0, 0];
      if (boxes) {
        const r = boxes[p];
        const next =
          how === "line"
            ? dx
              ? moveLine(boxes, p, "x", r.x + r.w + dx, hidden)
              : moveLine(boxes, p, "y", r.y + r.h + dy, hidden)
            : { ...boxes, [p]: how === "resize" ? { ...r, w: r.w + dx, h: r.h + dy } : { ...r, x: r.x + dx, y: r.y + dy } };
        const changed = PANELS.filter((q) => next[q] !== boxes[q]);
        if (setBoxes(next)) return setAnnounce(changed.map((q) => `${PANEL_NAMES[q]}現在${describe(next[q])}`).join("；"));
        if (how !== "move") return setAnnounce("已經是最小或沒有空間了");
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
      const first = PANELS.filter((p) => !hidden.includes(p)).sort((a, b) => layout[mode][a].y - layout[mode][b].y || layout[mode][a].x - layout[mode][b].x)[0];
      gridRef.current?.querySelector<HTMLElement>(`.card.${first} .card-move`)?.focus();
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEditing(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Only when edit mode starts or the layout switches, not on every swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, mode]);
  // Everything: hiding is shared by all layouts, so resetting one alone could leave overlaps in another.
  const resetLayout = () => {
    tabFlip.capture();
    setLayout(DEFAULT_LAYOUT);
    setAnnounce("已恢復預設版面，隱藏的板塊也都顯示回來");
    toast("已恢復預設版面（所有版面，隱藏的板塊也會顯示）");
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
                  : shownTab === "transit"
                    ? "拖動卡片或分頁調整位置"
                    : "拖動底部分頁調整順序"}
              </span>
              {hidden.map((p) => (
                <button key={p} className="layout-chip" onClick={() => unhide(p)} aria-label={`顯示${PANEL_NAMES[p]}`} title={`顯示${PANEL_NAMES[p]}`}>
                  ＋{PANEL_NAMES[p]}
                </button>
              ))}
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
          {/* Hidden cards aren't rendered at all, so they don't fetch either. */}
          <main
            ref={gridRef}
            className={`grid ${editing ? "editing" : ""}`}
            data-tab={shownTab}
            data-single={TRANSIT.some((q) => hidden.includes(q)) || undefined}
            style={areas}
          >
            {!hidden.includes("markets") && <Markets />}
            {!hidden.includes("weather") && <Weather onScene={setScene} />}
            {!hidden.includes("bus") && <Bus />}
            {!hidden.includes("train") && <Train />}
            {!hidden.includes("news") && <News />}
          </main>
        </LayoutEditContext.Provider>
        <nav ref={navRef} className={`tabbar ${editing ? "editing" : ""}`}>
          {shownTabs.map((id, i) => (
            <button
              key={id}
              data-tab-id={id}
              aria-selected={shownTab === id}
              onClick={() => choose(id)}
              aria-label={
                editing ? `${TABS[id][0]}分頁，第 ${i + 1} 個（共 ${shownTabs.length} 個）。按左右方向鍵移動位置` : undefined
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
