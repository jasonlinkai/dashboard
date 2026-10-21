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
import {
  type Boxes,
  type CardId,
  CardSettings,
  DEFAULT_LAYOUT,
  GRID,
  type LayoutMode,
  SCREENS,
  MAX_PER_TYPE,
  PANEL_NAMES,
  PANELS,
  PHONE_TABS,
  type Panel,
  type PhoneTab,
  type Rect,
  type Settings as SettingsData,
  TRANSIT,
  cardIds,
  findSpot,
  isPanel,
  typeOf,
  useSettings,
  validate,
} from "./settings";
import {
  BOARD_MIN,
  LayoutEditContext,
  type Rects,
  allFit,
  area,
  cardOf,
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
/** Each card type's page in the content settings. */
const SECTION_OF: Record<Panel, ContentSection> = { markets: "markets", weather: "weather", bus: "bus", train: "trains", news: "news" };

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
  // An extra card's gear edits that card's content (the settings show it in place of the first card's).
  const [settingsCard, setSettingsCard] = useState<CardId | undefined>();
  useEffect(() => onOpenSettings((s, card) => (setSettingsSection(s), setSettingsCard(card), setShowSettings(true))), []);
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
  const mode = useLayoutMode();
  // Each layout (desktop, portrait tablet, phone) shows its own choice of cards.
  const hidden = layout.hidden[mode];
  const kind = (id: CardId) => typeOf(settings, id);
  /** 天氣, 天氣 2 … */
  const name = (id: CardId) => {
    const n = isPanel(id) ? 1 : settings.extras.filter((e) => e.type === kind(id)).findIndex((e) => e.id === id) + 2;
    return n > 1 ? `${PANEL_NAMES[kind(id)]} ${n}` : PANEL_NAMES[kind(id)];
  };
  const ids = cardIds(settings);
  const shownIds = ids.filter((id) => !hidden.includes(id));
  const shown = preview ?? (hidden.includes("weather") ? null : scene);
  const [editing, setEditing] = useState(false);
  const [announce, setAnnounce] = useState("");
  const gridRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const layoutBtnRef = useRef<HTMLButtonElement>(null);
  // Phone tabs with something left to show (transit while any bus or train card is shown).
  const shownTypes = new Set(shownIds.map(kind));
  const shownTabs = layout.tabs.filter((t) => (t === "transit" ? TRANSIT.some((q) => shownTypes.has(q)) : shownTypes.has(t)));
  const shownTab = shownTabs.includes(tab) ? tab : shownTabs[0];
  const flip = useFlip(gridRef, JSON.stringify([layout.wide, layout.tall, layout.transit, shownIds]));
  const tabFlip = useFlip(navRef, layout.tabs.join(), true);
  useEffect(() => onEditLayout(() => setEditing(true)), []);
  const boxes = mode === "phone" ? null : layout[mode];
  const setLayout = (next: Partial<typeof layout>, first?: Rects) => {
    flip.capture(first);
    setSettings({ ...settings, layout: { ...layout, ...next } });
  };
  const describe = (r: Rect) => `從第 ${r.y + 1} 列第 ${r.x + 1} 欄起，寬 ${r.w} 格、高 ${r.h} 格（整面 ${GRID}×${GRID} 格）`;
  const where = (p: CardId) => (boxes ? describe(boxes[p]) : `在第 ${layout.transit.indexOf(kind(p)) + 1} 組（共 2 組）`);
  const changes = (next: Boxes) =>
    Object.keys(next)
      .filter((p) => next[p] !== boxes?.[p])
      .map((p) => `${name(p)}現在${describe(next[p])}`)
      .join("；");
  /** Apply a new board if every card still fits at its minimum size on this screen. */
  const setBoxes = (next: Boxes, first?: Rects) => {
    if (!boxes || !gridRef.current || !allFit(gridRef.current, next, hidden, kind)) return false;
    setLayout({ [mode]: next }, first);
    return true;
  };
  /** Two cards trade places (and sizes); on a phone, the bus and train groups trade order. */
  const swap = (a: CardId, b: CardId, first?: Rects) => {
    if (a === b) return;
    if (boxes) {
      if (!setBoxes({ ...boxes, [a]: boxes[b], [b]: boxes[a] }, first)) {
        flip.play(first ?? new Map());
        return toast(`${name(a)}和${name(b)}的大小差太多，交換後會有一個太小，請先調整大小`, "error");
      }
    } else if (kind(a) !== kind(b) && [kind(a), kind(b)].every((t) => (TRANSIT as readonly Panel[]).includes(t)))
      setLayout({ transit: [...layout.transit].reverse() }, first);
    else return;
    setAnnounce(`${name(a)}和${name(b)}交換了位置`);
  };
  usePanelDrag(gridRef, editing, mode, boxes, hidden, kind, swap, (next, first) => {
    const said = changes(next);
    if (setBoxes(next, first)) setAnnounce(said);
  });
  /** From / to are places among the tabs shown. */
  const moveTab = (from: number, to: number) => {
    if (to < 0 || to >= shownTabs.length || from === to) return;
    tabFlip.capture();
    const at = (i: number) => layout.tabs.indexOf(shownTabs[i]);
    setSettings({ ...settings, layout: { ...layout, tabs: moveTo(layout.tabs, at(from), at(to)) } });
    setAnnounce(`${TABS[shownTabs[from]][0]}分頁移到第 ${to + 1} 個`);
  };
  /** On this layout only: a type's first card is hidden (it keeps its content); an extra one is removed everywhere. */
  const hide = (p: CardId) => {
    if (shownIds.length <= 1) return toast("至少要留一個板塊", "error");
    if (isPanel(p)) {
      setLayout({ hidden: { ...layout.hidden, [mode]: [...hidden, p] } });
      setAnnounce(`已隱藏${name(p)}，可以從上方的「＋${name(p)}」顯示回來`);
    } else {
      const { [p]: _w, ...wide } = layout.wide;
      const { [p]: _t, ...tall } = layout.tall;
      const rest = Object.fromEntries(SCREENS.map((sc) => [sc, layout.hidden[sc].filter((q) => q !== p)])) as typeof layout.hidden;
      flip.capture();
      setSettings({ ...settings, extras: settings.extras.filter((e) => e.id !== p), layout: { ...layout, wide, tall, hidden: rest } });
      toast(`已移除${name(p)}`);
    }
    setTimeout(() => document.querySelector<HTMLElement>(".layout-bar .layout-toggle")?.focus()); // its button is gone
  };
  /** Room for a card on a board: its old box if free, else free cells (at least `min`); null if none. */
  const roomOn = (m: LayoutMode, p: CardId, min: { w: number; h: number }, rest = layout.hidden[m]) => {
    const own = layout[m][p];
    return findSpot(layout[m], p, rest, own ? [{ w: own.w, h: own.h }, min] : [min]);
  };
  const here = (type: Panel) => (gridRef.current ? minCells(gridRef.current, type) : BOARD_MIN);
  const unhide = (p: CardId) => {
    const rest = hidden.filter((q) => q !== p);
    const r = mode === "phone" ? null : roomOn(mode, p, here(kind(p)), rest);
    if (mode !== "phone" && !r) return toast(`沒有空位放${name(p)}，請先縮小其他板塊`, "error");
    setLayout({ ...(r && mode !== "phone" ? { [mode]: { ...layout[mode], [p]: r } } : {}), hidden: { ...layout.hidden, [mode]: rest } });
    setAnnounce(`已顯示${name(p)}`);
  };
  /** Another card of a type, starting with a little of the first card's content, then its settings open. */
  const addCard = (type: Panel) => {
    if (ids.filter((id) => kind(id) === type).length >= MAX_PER_TYPE) return toast(`每種板塊最多 ${MAX_PER_TYPE} 個`, "error");
    const id = `${type}-${Date.now().toString(36).slice(-6)}`;
    const start: Partial<SettingsData> = {
      markets: { markets: settings.markets.slice(0, 1) },
      weather: { weather: settings.weather.slice(0, 1) },
      bus: { bus: [] },
      train: { trains: [] },
      news: { news: settings.news, newsOrder: settings.newsOrder },
    }[type];
    // A free spot on each board (this screen's minimum here); none: hidden on that layout.
    const next = { ...layout, hidden: { ...layout.hidden } };
    for (const m of ["wide", "tall"] as const) {
      const r = roomOn(m, id, m === mode ? here(type) : BOARD_MIN);
      next[m] = { ...layout[m], [id]: r ?? { x: 0, y: 0, ...BOARD_MIN } };
      if (!r) next.hidden[m] = [...layout.hidden[m], id];
    }
    flip.capture();
    setSettings({ ...settings, extras: [...settings.extras, { id, type, ...start }], layout: next });
    if (mode !== "phone" && next.hidden[mode].includes(id)) toast("沒有空位，新的板塊先放在上方的「＋」裡；縮小其他板塊後再點它顯示", "error");
    setSettingsCard(id);
    setSettingsSection(SECTION_OF[type]);
    setShowSettings(true);
  };
  useTabDrag(navRef, editing && mode === "phone", moveTab);
  const edit = {
    editing,
    mode,
    where,
    hide,
    style: (p: CardId) => (layout.wide[p] ? ({ "--wide": area(layout.wide[p]), "--tall": area(layout.tall[p]) } as CSSProperties) : {}),
    move: (p: CardId, key: string, how: "move" | "resize" | "line") => {
      const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key] ?? [0, 0];
      if (boxes) {
        const r = boxes[p];
        const next =
          how === "line"
            ? dx
              ? moveLine(boxes, p, "x", r.x + r.w + dx, hidden)
              : moveLine(boxes, p, "y", r.y + r.h + dy, hidden)
            : { ...boxes, [p]: how === "resize" ? { ...r, w: r.w + dx, h: r.h + dy } : { ...r, x: r.x + dx, y: r.y + dy } };
        const said = changes(next);
        if (setBoxes(next)) return setAnnounce(said);
        if (how !== "move") return setAnnounce("已經是最小或沒有空間了");
      }
      // Blocked (or a phone): swap with the card that way.
      const grid = gridRef.current;
      const el = grid && cardOf(grid, p);
      const other = el && neighbor(grid, el, key);
      if (other?.dataset.card) swap(p, other.dataset.card);
    },
  };
  // Phone: --transit-bus / --transit-train order the transit tab. (Each card sets its own --wide / --tall.)
  const areas = Object.fromEntries(layout.transit.map((p, i) => [`--transit-${p}`, i])) as CSSProperties;
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
      const b = layout[mode];
      const first = [...shownIds].sort((a, c) => b[a].y - b[c].y || b[a].x - b[c].x)[0];
      const grid = gridRef.current;
      (grid && cardOf(grid, first))?.querySelector<HTMLElement>(".card-move")?.focus();
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEditing(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Only when edit mode starts or the layout switches, not on every swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, mode]);
  // Everything: hiding is shared by all layouts, so resetting one alone could leave overlaps in
  // another. Extra cards are kept, placed in free cells (or hidden) as when loading a file.
  const resetLayout = () => {
    tabFlip.capture();
    setLayout(validate({ ...settings, layout: undefined }).settings?.layout ?? DEFAULT_LAYOUT);
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
              {/* Left, by the hint: away from the finish button so it isn't tapped by mistake. */}
              <button className="layout-reset" onClick={resetLayout}>
                恢復預設
              </button>
              {hidden.map((p) => (
                <button key={p} className="layout-chip" onClick={() => unhide(p)} aria-label={`顯示${name(p)}`} title={`顯示${name(p)}`}>
                  ＋{name(p)}
                </button>
              ))}
              {mode !== "phone" && (
                <select
                  className="layout-add"
                  aria-label="新增板塊"
                  value=""
                  onChange={(e) => e.target.value && addCard(e.target.value as Panel)}
                >
                  <option value="">新增板塊…</option>
                  {PANELS.map((t) => (
                    <option key={t} value={t} disabled={ids.filter((id) => kind(id) === t).length >= MAX_PER_TYPE}>
                      {PANEL_NAMES[t]}
                    </option>
                  ))}
                </select>
              )}
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
            data-single={shownIds.filter((id) => (TRANSIT as readonly Panel[]).includes(kind(id))).length === 1 || undefined}
            style={areas}
          >
            {shownIds.map((id) => (
              <CardSettings key={id} id={id}>
                {{
                  markets: <Markets />,
                  // The page's weather animation follows the first weather card.
                  weather: <Weather onScene={id === "weather" ? setScene : undefined} />,
                  bus: <Bus />,
                  train: <Train />,
                  news: <News />,
                }[kind(id)]}
              </CardSettings>
            ))}
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
          <CardSettings id={settingsCard ?? ""}>
            <Settings
              card={settingsCard && settingsCard in layout.wide ? name(settingsCard) : undefined}
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
              onClose={() => (setShowSettings(false), setSettingsSection(undefined), setSettingsCard(undefined))}
            />
          </CardSettings>
        )}
      </div>
      <ScreenSaver minutes={saver} preview={saverPreview} onPreviewEnd={() => setSaverPreview(false)} />
    </>
  );
}
