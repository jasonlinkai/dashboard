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
import { Todo } from "./components/Todo";
import { Confirm } from "./components/Confirm";
import { LayoutHelp } from "./components/LayoutHelp";
import { type Scene, type SceneKind, WeatherFx } from "./components/WeatherFx";
import { useNow, useWakeLock } from "./hooks";
import { ScreenSaver } from "./components/ScreenSaver";
import { useFx, useSaver, useTheme } from "./theme";
import { type ContentSection, onOpenSettings } from "./openSettings";
import { toast } from "./toast";
import {
  type Boxes,
  FIELDS,
  cardView,
  type CardId,
  CardSettings,
  DEFAULT_SETTINGS,
  GRID,
  type LayoutMode,
  SCREENS,
  MAX_PER_TYPE,
  PANEL_NAMES,
  PANELS,
  PHONE_TABS,
  type Panel,
  type PhoneTab,
  type Preset,
  PRESETS,
  type Rect,
  type Settings as SettingsData,
  cardIds,
  cardName,
  findSpot,
  isPanel,
  overLimit,
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
  minCellsElsewhere,
  moveLine,
  neighbor,
  onEditLayout,
  useFlip,
  useLayoutMode,
  usePanelDrag,
} from "./layoutEdit";

// Leaflet only loads when the parking search is opened.
const Parking = lazy(() => import("./components/Parking"));

const dateFmt = new Intl.DateTimeFormat("zh-TW", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Taipei" });
const timeFmt = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" });

// On a phone everything can't fit on one screen, so sections become tabs (CSS shows them only there).
// Fixed order; a tab with several cards of its type switches between them in the card's title.
const TABS: Record<Tab, [label: string, icon: string]> = {
  markets: ["行情", "📈"],
  weather: ["天氣", "⛅"],
  transit: ["交通", "🚌"],
  news: ["新聞", "📰"],
  todo: ["待辦", "✅"],
};
type Tab = PhoneTab;
/** A type's content as it ships, for a type's first card coming back. */
const defaultsOf = (types: Panel[]) => Object.fromEntries(types.flatMap((t) => FIELDS[t].map((f) => [f, DEFAULT_SETTINGS[f]])));

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
  const phone = mode === "phone";
  // Each arranged layout shows its own choice of cards; a phone shows every card.
  const hidden = phone ? [] : layout.hidden[mode];
  const kind = (id: CardId) => typeOf(settings, id);
  const name = (id: CardId) => cardName(settings, id);
  const ids = cardIds(settings);
  /** A type's cards, its first one first. */
  const sameType = (id: CardId) => ids.filter((q) => kind(q) === kind(id));
  // Phone: one card of each type at a time, picked with the switch in its title (kept on this device).
  const [picked, setPicked] = useState<Record<string, CardId>>(() => {
    try {
      return JSON.parse(localStorage.getItem("phoneCards") ?? "{}");
    } catch {
      return {};
    }
  });
  const pick = (id: CardId) => {
    const next = { ...picked, [kind(id)]: id };
    setPicked(next);
    try {
      localStorage.setItem("phoneCards", JSON.stringify(next));
    } catch {}
  };
  const has = (t: Panel) => ids.some((id) => kind(id) === t);
  const shownIds = phone
    ? PANELS.filter(has).map((t) => (picked[t] && ids.includes(picked[t]) && kind(picked[t]) === t ? picked[t] : t))
    : ids.filter((id) => !hidden.includes(id));
  const [confirmReset, setConfirmReset] = useState(false);
  const [showLayoutHelp, setShowLayoutHelp] = useState(false);
  const shown = preview ?? (shownIds.includes("weather") ? scene : null);
  const [editing, setEditing] = useState(false);
  const [announce, setAnnounce] = useState("");
  const gridRef = useRef<HTMLElement>(null);
  const layoutBtnRef = useRef<HTMLButtonElement>(null);
  const flip = useFlip(gridRef, JSON.stringify([layout.wide, layout.tall, shownIds]));
  // No arranging on a phone (fixed tabs); a window shrunk to phone size ends it too.
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  useEffect(() => onEditLayout(() => (phoneRef.current ? toast("手機版沒有排版功能，請在平板或電腦上調整", "info") : setEditing(true))), []);
  useEffect(() => {
    if (phone) setEditing(false);
  }, [phone]);
  const boxes = mode === "phone" ? null : layout[mode];
  const setLayout = (next: Partial<typeof layout>, first?: Rects) => {
    flip.capture(first);
    setSettings({ ...settings, layout: { ...layout, ...next } });
  };
  const describe = (r: Rect) => `從第 ${r.y + 1} 列第 ${r.x + 1} 欄起，寬 ${r.w} 格、高 ${r.h} 格（整面 ${GRID}×${GRID} 格）`;
  const where = (p: CardId) => (boxes ? describe(boxes[p]) : "");
  const changes = (next: Boxes) =>
    Object.keys(next)
      .filter((p) => next[p] !== boxes?.[p])
      .map((p) => `${name(p)}現在${describe(next[p])}`)
      .join("；");
  /** Apply a new board if every card still fits at its minimum size on this screen. */
  const setBoxes = (next: Boxes, first?: Rects) => {
    if (!boxes || !gridRef.current || !allFit(gridRef.current, next, hidden, boxes)) return false;
    setLayout({ [mode]: next }, first);
    return true;
  };
  /** Two cards trade places (and sizes). */
  const swap = (a: CardId, b: CardId, first?: Rects) => {
    if (a === b || !boxes) return;
    if (!setBoxes({ ...boxes, [a]: boxes[b], [b]: boxes[a] }, first)) {
      flip.play(first ?? new Map());
      // Only a box laid out on a bigger screen can be under this screen's minimum.
      return toast(`${name(a)}或${name(b)}的位置在這個螢幕上太小，請先把它放大再交換`, "error");
    }
    setAnnounce(`${name(a)}和${name(b)}交換了位置`);
  };
  usePanelDrag(gridRef, editing, mode, boxes, hidden, swap, (next, first) => {
    const said = changes(next);
    if (setBoxes(next, first)) setAnnounce(said);
  });
  /**
   * A card, removed everywhere with its content. A type's first card holds the type's top-level
   * content, so the type's next card moves into it (content, name, place); with none left the type
   * becomes absent and its content goes back to the defaults (what it starts with when added again).
   */
  const removeCard = (p: CardId) => {
    const type = kind(p);
    const next = isPanel(p) ? settings.extras.find((e) => e.type === type) : undefined;
    const last = isPanel(p) && !next;
    const gone = next?.id ?? p;
    const take = (boxes: Boxes) => {
      const { [gone]: box, ...rest } = boxes;
      return next ? { ...rest, [p]: box } : rest;
    };
    const rest = Object.fromEntries(
      SCREENS.map((sc) => {
        const h = layout.hidden[sc].filter((q) => q !== p && q !== gone);
        return [sc, next && layout.hidden[sc].includes(gone) ? [...h, p] : h];
      }),
    ) as typeof layout.hidden;
    const { [p]: _n, [gone]: movedName, ...names } = settings.names;
    const content = next ? Object.fromEntries(FIELDS[type].map((f) => [f, cardView(settings, gone)[f]])) : last ? defaultsOf([type]) : {};
    flip.capture();
    setSettings({
      ...settings,
      ...content,
      absent: last ? [...settings.absent, type] : settings.absent,
      extras: settings.extras.filter((e) => e.id !== gone),
      names: next && movedName ? { ...names, [p]: movedName } : names,
      layout: { ...layout, wide: take(layout.wide), tall: take(layout.tall), hidden: rest },
    });
    toast(`已移除${name(p)}`);
  };
  /** On this layout only; the card keeps its content (deleting is in the settings). */
  const hide = (p: CardId) => {
    if (shownIds.length <= 1) return toast("至少要留一個板塊", "error");
    setLayout({ hidden: { ...layout.hidden, [mode]: [...hidden, p] } });
    setAnnounce(`已隱藏${name(p)}，可以從上方的「＋${name(p)}」顯示回來`);
    setTimeout(() => document.querySelector<HTMLElement>(".layout-bar .layout-toggle")?.focus()); // its button is gone
  };
  /**
   * Room for a card on a board, never under `min`: its old box (grown to `min` if it was smaller,
   * e.g. laid out on a bigger screen or parked when there was no room) if free, else free cells of
   * that size or of `min`; null if none.
   */
  const roomOn = (m: LayoutMode, p: CardId, min: { w: number; h: number }, rest = layout.hidden[m]) => {
    const own = layout[m][p];
    if (!own) return findSpot(layout[m], p, rest, [min]);
    const w = Math.max(own.w, min.w);
    const h = Math.max(own.h, min.h);
    const grown = { x: Math.min(own.x, GRID - w), y: Math.min(own.y, GRID - h), w, h };
    return findSpot({ ...layout[m], [p]: grown }, p, rest, [{ w, h }, min]);
  };
  const here = () => (gridRef.current ? minCells(gridRef.current) : BOARD_MIN);
  /** The minimum on a board, measured on this screen or estimated for the other orientation (a phone has neither). */
  const minOn = (m: LayoutMode) =>
    mode === "phone" || !gridRef.current ? BOARD_MIN : m === mode ? minCells(gridRef.current) : minCellsElsewhere(gridRef.current);
  const unhide = (p: CardId) => {
    const rest = hidden.filter((q) => q !== p);
    const r = mode === "phone" ? null : roomOn(mode, p, here(), rest);
    if (mode !== "phone" && !r) return toast(`沒有空位放${name(p)}，請先縮小其他板塊`, "error");
    setLayout({ ...(r && mode !== "phone" ? { [mode]: { ...layout[mode], [p]: r } } : {}), hidden: { ...layout.hidden, [mode]: rest } });
    setAnnounce(`已顯示${name(p)}`);
  };
  /**
   * A card of a type at its minimum size, always starting with a little content: one place / tile
   * (the first card's, or the defaults' when the type is absent and its first card comes back), no
   * stops or routes. Only a reset fills in a preset's full defaults. The settings page opens the new
   * card's page itself; the layout bar doesn't.
   */
  const addCard = (type: Panel): CardId | undefined => {
    if (ids.filter((id) => kind(id) === type).length >= MAX_PER_TYPE) return void toast(`每種板塊最多 ${MAX_PER_TYPE} 個`, "error");
    const back = settings.absent.includes(type);
    const id = back ? type : `${type}-${Date.now().toString(36).slice(-6)}`;
    const from = back ? DEFAULT_SETTINGS : settings;
    const start: Partial<SettingsData> = {
      markets: { markets: from.markets.slice(0, 1) },
      weather: { weather: from.weather.slice(0, 1) },
      bus: { bus: [] },
      train: { trains: [] },
      news: { news: from.news, newsOrder: from.newsOrder },
      todo: { todos: [], todoLocked: false }, // not the first card's lock
    }[type];
    // A free spot on each board (this screen's minimum here). None: hidden on that board until
    // it is made room for in layout mode.
    const next = { ...layout, hidden: { ...layout.hidden } };
    let noRoom = false;
    for (const m of ["wide", "tall"] as const) {
      const r = roomOn(m, id, minOn(m));
      if (!r && m === mode) noRoom = true;
      next[m] = { ...layout[m], [id]: r ?? { x: 0, y: 0, ...BOARD_MIN } };
      if (!r) next.hidden[m] = [...layout.hidden[m], id];
    }
    const added = back
      ? { ...settings, ...start, absent: settings.absent.filter((t) => t !== type), layout: next }
      : { ...settings, extras: [...settings.extras, { id, type, ...start }], layout: next };
    // Checked here too (setSettings would refuse it), so a card that isn't added doesn't open its page.
    const over = overLimit(added);
    if (over) return void toast(`無法新增：${over}`, "error");
    flip.capture();
    setSettings(added);
    if (noRoom) toast(`畫面上沒有空位，新的${PANEL_NAMES[type]}先隱藏；可在排版模式騰出空間後顯示`, "info");
    else setAnnounce(`已新增${cardName(added, id)}`);
    return id;
  };
  const edit = {
    editing,
    mode,
    sameType,
    pick,
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
              ? moveLine(boxes, p, "x", r.x + r.w + dx, hidden, here())
              : moveLine(boxes, p, "y", r.y + r.h + dy, hidden, here())
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
  // Entering edit mode puts focus on the first thing to move, for keyboard users.
  // Leaving edit mode hands focus back to the header's layout button (the bar's one is gone).
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) layoutBtnRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  useEffect(() => {
    if (!editing || mode === "phone") return;
    const b = layout[mode];
    const first = [...shownIds].sort((a, c) => b[a].y - b[c].y || b[a].x - b[c].x)[0];
    const grid = gridRef.current;
    (grid && cardOf(grid, first))?.querySelector<HTMLElement>(".card-move")?.focus();
    // Esc in the reset question closes only the question.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("dialog[open]") && setEditing(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Only when edit mode starts or the layout switches, not on every swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, mode]);
  /**
   * This layout only (each one has its own boxes and hidden list): the preset's boxes, its types
   * that were deleted come back with their default content, and the other cards go in free cells
   * (or are hidden) as when loading a file. A type that came back gets a free spot in the other layout.
   */
  const resetLayout = (preset: Preset = PRESETS.default) => {
    if (mode === "phone") return;
    const back = settings.absent.filter((t) => preset[mode][t]);
    const { [mode]: _, ...keep } = layout;
    const next = validate(
      {
        ...settings,
        ...defaultsOf(back),
        absent: settings.absent.filter((t) => !back.includes(t)),
        layout: { ...keep, hidden: { ...layout.hidden, [mode]: [] } },
      },
      preset,
    ).settings;
    if (!next) return toast("無法恢復預設版面", "error");
    flip.capture();
    setSettings(next);
    const added = back.length ? `，補回${back.map((t) => PANEL_NAMES[t]).join("、")}` : "";
    setAnnounce(`已恢復這個方向的預設版面${added}`);
    toast(`已恢復${mode === "wide" ? "橫向" : "直向"}的預設版面${added}`);
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
              <button className="icon-btn" onClick={() => setShowLayoutHelp(true)} aria-label="排版說明" title="排版說明">
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />
                </svg>
              </button>
              {/* Left, by the help: away from the finish button so it isn't tapped by mistake. */}
              <button className="layout-reset" onClick={() => setConfirmReset(true)}>
                恢復預設
              </button>
              {/* Many hidden cards scroll here instead of pushing the other buttons off the bar. */}
              {hidden.length > 0 && (
                <div className="layout-chips">
                  {hidden.map((p) => (
                    <button key={p} className="layout-chip" onClick={() => unhide(p)} aria-label={`顯示${name(p)}`} title={`顯示${name(p)}`}>
                      ＋{name(p)}
                    </button>
                  ))}
                </div>
              )}
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
              {/* Where the header's gear is, so the finish button sits right over the layout button. */}
              <span className="layout-bar-gap" aria-hidden />
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
          {!phone && (
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
          )}
          {/* Settings stays at the far right. */}
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="設定" title="設定">
            <GearIcon />
          </button>
        </header>
        <LayoutEditContext.Provider value={edit}>
          {/* Hidden cards aren't rendered at all, so they don't fetch either. */}
          <main
            ref={gridRef}
            className={`grid ${editing ? "editing" : ""}`}
            data-tab={tab}
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
                  todo: <Todo />,
                }[kind(id)]}
              </CardSettings>
            ))}
            {/* Phone: a tab whose type has no card offers to add one. */}
            {phone &&
              PANELS.filter((t) => !has(t)).map((t) => (
                <section key={t} className={`card ${t} card-empty`}>
                  <p className="muted">還沒有{PANEL_NAMES[t]}板塊</p>
                  <button className="ed-add-btn" onClick={() => addCard(t)}>
                    ＋ 新增{PANEL_NAMES[t]}
                  </button>
                </section>
              ))}
            {!phone && !shownIds.length && (
              <div className="card-empty grid-empty">
                <p className="muted">看板上沒有板塊</p>
                {!editing && (
                  <button className="ed-add-btn" onClick={() => setEditing(true)}>
                    進入排版模式新增或顯示板塊
                  </button>
                )}
              </div>
            )}
          </main>
        </LayoutEditContext.Provider>
        <nav className="tabbar">
          {PHONE_TABS.map((id) => (
            <button key={id} aria-selected={tab === id} onClick={() => choose(id)}>
              <span className="tab-icon">{TABS[id][1]}</span>
              {TABS[id][0]}
            </button>
          ))}
        </nav>
        {showParking && (
          <Suspense fallback={<div className="parking pk-loading">載入地圖中…</div>}>
            <Parking onClose={() => setShowParking(false)} />
          </Suspense>
        )}
        {showInfo && <Reliability onClose={() => setShowInfo(false)} />}
        {showLayoutHelp && mode !== "phone" && <LayoutHelp mode={mode} onClose={() => setShowLayoutHelp(false)} />}
        {confirmReset && (
          <Confirm
            title="恢復預設版面？"
            ok="恢復預設"
            onOk={() => (setConfirmReset(false), resetLayout())}
            onCancel={() => setConfirmReset(false)}
          >
            {mode === "wide" ? "橫向（桌機、平板橫放）" : "直向（平板直放）"}
            的板塊位置與大小會回到預設，隱藏的板塊也會顯示回來；被刪除的預設板塊會用預設內容補回。另一個方向的版面不受影響。
          </Confirm>
        )}
        {showSettings && (
          <Settings
            card={settingsCard}
            onAddCard={addCard}
            onRemoveCard={removeCard}
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
        )}
      </div>
      <ScreenSaver minutes={saver} preview={saverPreview} onPreviewEnd={() => setSaverPreview(false)} />
    </>
  );
}
