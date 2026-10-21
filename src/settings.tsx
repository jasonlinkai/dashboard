// What's on the dashboard: weather places, market tiles, bus stops, train routes and news sources.
// Kept per device in the browser; can be exported / imported as a JSON file (see validate()).

import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { toast } from "./toast";
import type { Instrument } from "./config";
import { type BusCity, MAX_BUS_CITIES, isBusCity } from "./bus-cities";
import { DEFAULT_NEWS, MAX_NEWS_SOURCES, NEWS_BY_ID, TOPICS, type Topic } from "./news-sources";

export interface WeatherPlace {
  name: string;
  county: string; // 氣象署縣市名，例如 新北市
  town: string; // 例如 汐止區
  townId: string; // 氣象署鄉鎮預報頁代碼
  latitude: number;
  longitude: number;
  /** 指定氣象署測站；沒有的話用同一行政區的測站 */
  station?: string;
}

/** A catalog symbol, or a custom Yahoo Finance symbol with its own label. */
export type MarketItem = string | { symbol: string; name: string; decimals?: number };

export interface BusStop {
  city: BusCity;
  route: string;
  /** 上車站；空字串＝沒有勾選上車站（看板只列路線，點開看全線） */
  stop: string;
  /** "auto" = 選目的地看起來是往台北的方向；0 = 去程、1 = 返程 */
  direction: 0 | 1 | "auto";
  /** 只看會開往這一站的車（取代 direction）；環狀線同一站經過兩次時，用它選對邊 */
  toward?: string;
  /** 顯示的方向，例如「往 捷運昆陽站」；沒有的話用 TDX 的起訖站 */
  headsign?: string;
  /** 舊版的分組標題；已不使用，匯入時忽略 */
  group?: string;
}

export interface TrainRoute {
  from: string;
  to: string;
  /** Which trains this route lists. */
  type: TrainType;
}

export interface TodoItem {
  text: string;
  done: boolean;
}

export interface Settings {
  version: 1;
  weather: WeatherPlace[];
  markets: MarketItem[];
  bus: BusStop[];
  trains: TrainRoute[];
  news: Record<Topic, string[]>;
  /** Order of the news tabs on the dashboard. */
  newsOrder: Topic[];
  todos: TodoItem[];
  /** The to-do list is locked against changes (ticking, adding, deleting). */
  todoLocked: boolean;
  /** Types whose first card was deleted (or never added): not on the dashboard. Such a type has no extras. */
  absent: Panel[];
  /** Which card sits in which slot of the tablet / desktop layouts. */
  layout: Layout;
  /** More cards of a type, each with its own content (the fields above are each type's first card). */
  extras: Extra[];
  /** Titles the user gave cards (by card id); the others use their type's name (天氣, 天氣 2 …). */
  names: Record<CardId, string>;
}

/** The dashboard's cards. */
export const PANELS = ["markets", "weather", "bus", "train", "news", "todo"] as const;
export type Panel = (typeof PANELS)[number];
export const isPanel = (s: unknown): s is Panel => (PANELS as readonly unknown[]).includes(s);
export const PANEL_NAMES: Record<Panel, string> = { markets: "市場行情", weather: "天氣", bus: "公車", train: "火車", news: "新聞", todo: "待辦事項" };

/** The phone's bottom tabs (parking opens from the header's P, as on every screen). */
export const PHONE_TABS = ["markets", "weather", "bus", "train", "news", "todo"] as const;
export type PhoneTab = (typeof PHONE_TABS)[number];

/** Tablet and desktop: each card is a box on a GRID × GRID board, in cells (x, y from the top left). */
export const GRID = 24;
export const MIN_W = 4;
export const MIN_H = 3;
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** A card: a type's first one (id = the type, its content in the top-level fields) or an extra one. */
export type CardId = string;
export type Boxes = Record<CardId, Rect>;
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** On the board, big enough, and clear of the other (shown) cards. */
export const fits = (boxes: Boxes, p: CardId, r: Rect, hidden: readonly CardId[] = []) =>
  [r.x, r.y, r.w, r.h].every(Number.isInteger) &&
  r.x >= 0 && r.y >= 0 && r.w >= MIN_W && r.h >= MIN_H && r.x + r.w <= GRID && r.y + r.h <= GRID &&
  Object.keys(boxes).every((q) => q === p || hidden.includes(q) || !overlaps(boxes[q], r));

/**
 * Where a card can go: its own box if that is free, else the first free spot (from the top left)
 * of each size tried in turn. Null: no room.
 */
export function findSpot(boxes: Boxes, p: CardId, hidden: readonly CardId[], sizes: { w: number; h: number }[]): Rect | null {
  if (boxes[p] && fits(boxes, p, boxes[p], hidden)) return boxes[p];
  for (const { w, h } of sizes)
    for (let y = 0; y + h <= GRID; y++)
      for (let x = 0; x + w <= GRID; x++) if (fits(boxes, p, { x, y, w, h }, hidden)) return { x, y, w, h };
  return null;
}

/**
 * The fixed slots of the first version (a card per slot), still read from older files:
 * wide "w0 w0 w0" "w1 w2 w4" "w1 w3 w4", tall "t0 t0" "t1 t1" "t2 t4" "t3 t4". Also the default
 * boxes, sized like the original layouts (desktop columns 1.2 : 1 : 1.1, the market row a quarter).
 */
const SLOTS: Record<LayoutMode, Rect[]> = {
  wide: [
    { x: 0, y: 0, w: 24, h: 6 },
    { x: 0, y: 6, w: 9, h: 18 },
    { x: 9, y: 6, w: 7, h: 9 },
    { x: 9, y: 15, w: 7, h: 9 },
    { x: 16, y: 6, w: 8, h: 18 },
  ],
  tall: [
    { x: 0, y: 0, w: 24, h: 7 },
    { x: 0, y: 7, w: 24, h: 7 },
    { x: 0, y: 14, w: 12, h: 5 },
    { x: 0, y: 19, w: 12, h: 5 },
    { x: 12, y: 14, w: 12, h: 10 },
  ],
};
/** The first version's cards, in its slot order (to-do came later). */
const SLOT_PANELS = ["markets", "weather", "bus", "train", "news"] as const satisfies readonly Panel[];
const fromSlots = (m: LayoutMode, slots: readonly Panel[]) => Object.fromEntries(slots.map((p, i) => [p, SLOTS[m][i]])) as Boxes;

export interface Layout {
  wide: Boxes;
  tall: Boxes;
  /** Cards taken off each layout. Their boxes are kept for when they come back. (A phone shows every card.) */
  hidden: Record<LayoutMode, CardId[]>;
}

/** The settings fields each card type shows. An extra card has its own copy of them. */
export const FIELDS = {
  markets: ["markets"],
  weather: ["weather"],
  bus: ["bus"],
  train: ["trains"],
  news: ["news", "newsOrder"],
  todo: ["todos", "todoLocked"],
} as const satisfies Record<Panel, readonly (keyof Settings)[]>;
export type Extra = { id: CardId; type: Panel } & Partial<Pick<Settings, "weather" | "markets" | "bus" | "trains" | "news" | "newsOrder" | "todos" | "todoLocked">>;
/** Cards of one type, the first one included. */
export const MAX_PER_TYPE = 3;
export const cardIds = (s: Settings): CardId[] => [...PANELS.filter((p) => !s.absent.includes(p)), ...s.extras.map((e) => e.id)];
export const typeOf = (s: Settings, id: CardId): Panel => (isPanel(id) ? id : s.extras.find((e) => e.id === id)!.type);
export const MAX_NAME = 12;
/** A card's title: the user's, else its type's name, numbered after the first (天氣 2). */
export function cardName(s: Settings, id: CardId): string {
  if (s.names[id]) return s.names[id];
  const type = typeOf(s, id);
  const n = isPanel(id) ? 1 : s.extras.filter((e) => e.type === type).findIndex((e) => e.id === id) + 2;
  return n > 1 ? `${PANEL_NAMES[type]} ${n}` : PANEL_NAMES[type];
}
/** The settings as a card sees them: an extra card's own content in place of its type's top-level fields. */
export function cardView(s: Settings, id: CardId): Settings {
  const extra = s.extras.find((e) => e.id === id);
  if (!extra) return s;
  const fields: readonly (keyof Settings)[] = FIELDS[extra.type];
  return { ...s, ...Object.fromEntries(fields.map((f) => [f, (extra as Record<string, unknown>)[f] ?? s[f]])) } as Settings;
}

/**
 * All cards of a type share one request, and the server caps its size (and TDX allows a few
 * calls a minute), so the limits count every card of the type together. Null when within them.
 */
export function overLimit(s: Settings): string | null {
  const caps = [
    ["weather", LIMITS.weather, "天氣地點"],
    ["markets", LIMITS.markets, "行情項目"],
    ["bus", LIMITS.bus, "公車站牌"],
    ["trains", LIMITS.trains, "火車路線"],
  ] as const;
  for (const [f, max, label] of caps) {
    const total = s[f].length + s.extras.reduce((n, e) => n + (e[f]?.length ?? 0), 0);
    if (total > max) return `所有板塊的${label}合計最多 ${max} 個（目前 ${total} 個）`;
  }
  return null;
}
export type LayoutMode = "wide" | "tall";
/** The layouts a user arranges: desktop and landscape tablet, portrait tablet. A phone has fixed tabs. */
export const SCREENS: LayoutMode[] = ["wide", "tall"];
/**
 * A preset: the boxes of the cards it puts on each board (by type, each type's first card).
 * Types it leaves out are not added by it. Only the default exists so far.
 */
export type Preset = Record<LayoutMode, Boxes>;
export const DEFAULT_LAYOUT: Layout = {
  wide: fromSlots("wide", SLOT_PANELS),
  tall: fromSlots("tall", SLOT_PANELS),
  hidden: { wide: [], tall: [] },
};
export const PRESETS: Record<string, Preset> = { default: DEFAULT_LAYOUT };

// ---------- Catalogs and limits ----------

export { BUS_CITY_LIST as BUS_CITIES, type BusCity } from "./bus-cities";

/** 車種：用車種名稱的關鍵字篩選（「區間」也包含「區間快」） */
export const TRAIN_TYPES = ["區間", "自強", "莒光", "全部"] as const;
export type TrainType = (typeof TRAIN_TYPES)[number];
export const trainTypeKeyword = (t: TrainType) => (t === "全部" ? "" : t);

const price = (decimals: number, prefix?: string) => ({ kind: "price" as const, decimals, ...(prefix ? { prefix } : {}) });
const yieldOf = (symbol: string, name: string): Instrument => ({
  symbol,
  name,
  subtitle: "殖利率",
  format: { kind: "yield" },
  feedDelayMin: 15,
});

/** Market tiles to choose from. */
export const INSTRUMENT_CATALOG: Instrument[] = [
  { symbol: "^TWII", name: "台股加權", subtitle: "TAIEX", format: price(2) },
  { symbol: "2330.TW", name: "台積電", subtitle: "2330", format: price(2) },
  { symbol: "0050.TW", name: "元大台灣50", subtitle: "0050", format: price(2) },
  { symbol: "^IXIC", name: "那斯達克", subtitle: "NASDAQ", format: price(2) },
  { symbol: "^GSPC", name: "標普 500", subtitle: "S&P 500", format: price(2) },
  { symbol: "^DJI", name: "道瓊工業", subtitle: "DJIA", format: price(2) },
  { symbol: "^SOX", name: "費城半導體", subtitle: "SOX", format: price(2) },
  { symbol: "^N225", name: "日經 225", subtitle: "Nikkei", format: price(2) },
  { symbol: "^HSI", name: "恆生指數", subtitle: "HSI", format: price(2) },
  { symbol: "BTC-USD", name: "比特幣", subtitle: "BTC / USD", format: price(0, "$") },
  { symbol: "ETH-USD", name: "以太幣", subtitle: "ETH / USD", format: price(1, "$") },
  { symbol: "GC=F", name: "黃金", subtitle: "USD / oz", format: price(1, "$") },
  { symbol: "SI=F", name: "白銀", subtitle: "USD / oz", format: price(2, "$") },
  { symbol: "CL=F", name: "原油 WTI", subtitle: "USD / bbl", format: price(2, "$") },
  { symbol: "TWD=X", page: "USDTWD=X", name: "美元 / 台幣", subtitle: "USD / TWD", format: price(3) },
  { symbol: "JPYTWD=X", name: "日圓 / 台幣", subtitle: "JPY / TWD", format: price(4) },
  { symbol: "DX-Y.NYB", name: "美元指數", subtitle: "DXY", format: price(2) },
  yieldOf("^IRX", "美債 13 週"),
  yieldOf("^FVX", "美債 5 年"),
  yieldOf("^TNX", "美債 10 年"),
  yieldOf("^TYX", "美債 30 年"),
];
const CATALOG_BY_SYMBOL = new Map(INSTRUMENT_CATALOG.map((i) => [i.symbol, i]));

export const LIMITS = { weather: 10, markets: 12, bus: 10, trains: 8, news: MAX_NEWS_SOURCES, todos: 30 };
export const MAX_TODO = 60;

// ---------- Defaults (what the dashboard shipped with) ----------

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  weather: [
    { name: "汐止", county: "新北市", town: "汐止區", townId: "6501100", latitude: 25.0629, longitude: 121.658, station: "汐止" },
    { name: "南港", county: "臺北市", town: "南港區", townId: "6300900", latitude: 25.055, longitude: 121.6067 },
    { name: "內湖", county: "臺北市", town: "內湖區", townId: "6301000", latitude: 25.0836, longitude: 121.5944, station: "內湖" },
    { name: "台北", county: "臺北市", town: "中正區", townId: "6300500", latitude: 25.0375, longitude: 121.5637, station: "臺北" },
  ],
  markets: ["^TWII", "^IXIC", "BTC-USD", "GC=F", "TWD=X", "^IRX", "^FVX", "^TNX", "^TYX"],
  bus: [
    { city: "NewTaipei", route: "藍23", stop: "忠孝里", direction: "auto" },
    { city: "NewTaipei", route: "藍39", stop: "樟樹實中", direction: "auto" },
    // 站名可以寫簡稱：TDX 上是「汐科站北站」、「南港行政中心(南港車站)」
    { city: "NewTaipei", route: "F913", stop: "汐科站北站", direction: "auto", toward: "日月光社區" },
    { city: "NewTaipei", route: "590", stop: "南港車站", direction: "auto", toward: "日月光社區" },
  ],
  trains: [
    { from: "汐科", to: "臺北", type: "區間" },
    { from: "臺北", to: "汐科", type: "區間" },
    { from: "松山", to: "汐科", type: "區間" },
  ],
  news: DEFAULT_NEWS,
  newsOrder: TOPICS.map(([id]) => id),
  todos: [],
  todoLocked: false,
  // The default preset has no to-do card; it is added from the settings or the layout bar.
  absent: ["todo"],
  layout: DEFAULT_LAYOUT,
  extras: [],
  names: {},
};

// ---------- Derived helpers ----------

/** News topics as [id, label], in the user's tab order. */
export const orderedTopics = (s: Settings) => s.newsOrder.map((id) => TOPICS.find(([t]) => t === id)!);

export const marketSymbol = (m: MarketItem) => (typeof m === "string" ? m : m.symbol);

export function instrumentOf(m: MarketItem): Instrument {
  if (typeof m === "string") return CATALOG_BY_SYMBOL.get(m)!;
  const known = CATALOG_BY_SYMBOL.get(m.symbol);
  return { ...(known ?? { subtitle: m.symbol, format: price(m.decimals ?? 2) }), symbol: m.symbol, name: m.name } as Instrument;
}

export const placeKey = (p: WeatherPlace) => `${p.county}/${p.town}`;

// ---------- Validation (imports are untrusted) ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Text that ends up in API query strings, where , and : are separators. */
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[,:]/.test(v);
const SYMBOL = /^[A-Za-z0-9.^=\-]{1,20}$/;

/** `preset`: where a type's first card goes when the file gives no box for it (a reset passes the one chosen). */
export function validate(raw: unknown, preset: Preset = DEFAULT_LAYOUT): { settings?: Settings; errors: string[] } {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);
  if (!isObj(raw)) return { errors: ["檔案內容不是設定物件（JSON 物件）"] };
  if (raw.version !== 1) err(`version 必須是 1（目前是 ${JSON.stringify(raw.version)}）`);

  const weather: WeatherPlace[] = [];
  if (!Array.isArray(raw.weather)) err("weather 必須是陣列");
  else {
    if (raw.weather.length < 1 || raw.weather.length > LIMITS.weather) err(`weather 要有 1～${LIMITS.weather} 個地點`);
    raw.weather.forEach((w, i) => {
      const at = `weather[${i}]`;
      if (!isObj(w)) return err(`${at} 必須是物件`);
      const ok =
        text(w.name, 8) &&
        text(w.county, 6) &&
        text(w.town, 8) &&
        typeof w.townId === "string" &&
        /^\d{7}$/.test(w.townId) &&
        typeof w.latitude === "number" &&
        w.latitude > 21 &&
        w.latitude < 27 &&
        typeof w.longitude === "number" &&
        w.longitude > 118 &&
        w.longitude < 123 &&
        (w.station === undefined || text(w.station, 16));
      if (!ok) return err(`${at}：需要 name（8 字內）、county、town、townId（7 位數字）、台灣範圍內的 latitude／longitude，station 可省略`);
      weather.push({
        name: w.name as string,
        county: w.county as string,
        town: w.town as string,
        townId: w.townId as string,
        latitude: w.latitude as number,
        longitude: w.longitude as number,
        ...(w.station ? { station: w.station as string } : {}),
      });
    });
    const keys = weather.map((p) => p.name);
    if (new Set(keys).size !== keys.length) err("weather 的 name 不能重複");
  }

  const markets: MarketItem[] = [];
  if (!Array.isArray(raw.markets)) err("markets 必須是陣列");
  else {
    raw.markets.forEach((m, i) => {
      const at = `markets[${i}]`;
      if (typeof m === "string") {
        if (!CATALOG_BY_SYMBOL.has(m)) return err(`${at}：「${m}」不在可選清單；自訂代號請寫成 {"symbol": "…", "name": "…"}`);
        markets.push(m);
      } else if (isObj(m)) {
        const decimals = m.decimals === undefined ? undefined : m.decimals;
        // The name is only displayed (never sent in a query string), so commas are fine here.
        if (typeof m.symbol !== "string" || !SYMBOL.test(m.symbol) || typeof m.name !== "string" || !m.name.trim() || m.name.length > 24) {
          return err(`${at}：symbol 只能是 Yahoo 代號（英數與 . ^ = -，20 字內），name 1～24 字`);
        }
        if (decimals !== undefined && !(Number.isInteger(decimals) && (decimals as number) >= 0 && (decimals as number) <= 6)) {
          return err(`${at}：decimals 要是 0～6 的整數`);
        }
        markets.push({ symbol: m.symbol, name: m.name as string, ...(decimals !== undefined ? { decimals: decimals as number } : {}) });
      } else err(`${at} 必須是代號字串或物件`);
    });
    const syms = markets.map(marketSymbol);
    if (new Set(syms).size !== syms.length) err("markets 有重複的代號");
    if (markets.length < 1 || markets.length > LIMITS.markets) err(`markets 要有 1～${LIMITS.markets} 個，目前 ${markets.length} 個`);
  }

  const bus: BusStop[] = [];
  if (!Array.isArray(raw.bus)) err("bus 必須是陣列");
  else {
    if (raw.bus.length > LIMITS.bus) err(`bus 最多 ${LIMITS.bus} 筆`);
    raw.bus.forEach((b, i) => {
      const at = `bus[${i}]`;
      if (!isObj(b)) return err(`${at} 必須是物件`);
      if (!isBusCity(b.city)) return err(`${at}：city 要是 TDX 的縣市代碼（例如 Taipei、NewTaipei、Taichung）`);
      if (!text(b.route, 12)) return err(`${at}：route 必填（不能含 , 或 :）`);
      // "" = no boarding stop picked: the board lists the route only.
      if (b.stop !== "" && !text(b.stop, 24)) return err(`${at}：stop 要是 24 字內的站名，或空字串（不指定上車站）`);
      const direction = b.direction ?? "auto";
      if (direction !== "auto" && direction !== 0 && direction !== 1) return err(`${at}：direction 只能是 "auto"、0 或 1`);
      if (b.toward !== undefined && !text(b.toward, 24)) return err(`${at}：toward 不能是空字串，也不能含 , 或 :`);
      if (b.headsign !== undefined && !(typeof b.headsign === "string" && b.headsign.length <= 30))
        return err(`${at}：headsign 要是 30 字內的文字`);
      bus.push({
        city: b.city,
        route: b.route as string,
        stop: b.stop as string,
        direction,
        ...(b.toward ? { toward: b.toward as string } : {}),
        ...(b.headsign ? { headsign: b.headsign as string } : {}),
      });
    });
    // A route may have several boarding stops (e.g. one each way), but not the same one twice,
    // and an entry without a stop only when the route has no stop at all.
    const keys = bus.map((b) => `${b.city}:${b.route}:${b.stop}:${b.toward ?? ""}`);
    if (new Set(keys).size !== keys.length) err("bus 有重複的路線＋上車站");
    for (const b of bus)
      if (!b.stop && bus.some((o) => o.city === b.city && o.route === b.route && o.stop))
        err(`bus：${b.route} 已有上車站，不需要另一筆沒有上車站的`);
    const cities = new Set(bus.map((b) => b.city));
    if (cities.size > MAX_BUS_CITIES) err(`bus 最多 ${MAX_BUS_CITIES} 個縣市（每個縣市每分鐘多查一次 TDX）`);
  }

  // Files from before each route had its own type carry one shared trainType: it applies to all.
  const sharedType = raw.trainType ?? "區間";
  if (!TRAIN_TYPES.includes(sharedType as TrainType)) err(`trainType 只能是 ${TRAIN_TYPES.join("、")}`);
  const trains: TrainRoute[] = [];
  if (!Array.isArray(raw.trains)) err("trains 必須是陣列");
  else {
    if (raw.trains.length > LIMITS.trains) err(`trains 最多 ${LIMITS.trains} 條`);
    raw.trains.forEach((t, i) => {
      if (!isObj(t) || !text(t.from, 8) || !text(t.to, 8)) return err(`trains[${i}]：需要 from 與 to 站名`);
      if (t.from === t.to) return err(`trains[${i}]：上下車站不能相同`);
      const type = t.type ?? sharedType;
      if (!TRAIN_TYPES.includes(type as TrainType)) return err(`trains[${i}]：type 只能是 ${TRAIN_TYPES.join("、")}`);
      if (trains.some((r) => r.from === t.from && r.to === t.to)) return err(`trains[${i}]：${t.from}→${t.to} 重複`);
      trains.push({ from: t.from as string, to: t.to as string, type: type as TrainType });
    });
  }

  const news = {} as Record<Topic, string[]>;
  if (!isObj(raw.news)) err("news 必須是物件");
  else {
    for (const [topic, label] of TOPICS) {
      // A topic added after the file was saved gets the defaults; an empty list hides the tab.
      const ids = raw.news[topic] ?? DEFAULT_NEWS[topic];
      if (!Array.isArray(ids) || ids.length > LIMITS.news) {
        err(`news.${topic}（${label}）要是 0～${LIMITS.news} 個來源（0 個＝不顯示這個分類）`);
        continue;
      }
      const bad = ids.filter((id) => typeof id !== "string" || !NEWS_BY_ID.get(id)?.feeds[topic]);
      if (bad.length) err(`news.${topic}（${label}）：${bad.map((b) => JSON.stringify(b)).join("、")} 不是這個分頁可用的來源代號`);
      if (new Set(ids).size !== ids.length) err(`news.${topic}（${label}）有重複的來源`);
      news[topic] = ids as string[];
    }
  }

  // Older files have no order: catalog order. Topics added later go at the end.
  const newsOrder: Topic[] = [];
  const rawOrder = raw.newsOrder ?? [];
  if (!Array.isArray(rawOrder)) err("newsOrder 必須是分類代號的陣列");
  else {
    for (const id of rawOrder) {
      if (!TOPICS.some(([t]) => t === id)) err(`newsOrder：${JSON.stringify(id)} 不是新聞分類代號`);
      else if (!newsOrder.includes(id as Topic)) newsOrder.push(id as Topic);
    }
    for (const [id] of TOPICS) if (!newsOrder.includes(id)) newsOrder.push(id);
  }

  // Older files have no to-do list.
  const todos: TodoItem[] = [];
  const rawTodos = raw.todos ?? [];
  if (!Array.isArray(rawTodos) || rawTodos.length > LIMITS.todos) err(`todos 要是陣列，最多 ${LIMITS.todos} 項`);
  else
    rawTodos.forEach((t, i) => {
      if (!isObj(t) || typeof t.text !== "string" || !t.text.trim() || t.text.length > MAX_TODO || typeof t.done !== "boolean")
        return err(`todos[${i}]：需要 text（1～${MAX_TODO} 字）與 done（true／false）`);
      todos.push({ text: t.text, done: t.done });
    });

  const todoLocked = raw.todoLocked ?? false;
  if (typeof todoLocked !== "boolean") err("todoLocked 要是 true 或 false");

  // Older files have every type of their time on the board: only the ones added later are absent.
  const rawAbsent = raw.absent ?? DEFAULT_SETTINGS.absent;
  const absent: Panel[] = [];
  if (!Array.isArray(rawAbsent) || !rawAbsent.every(isPanel)) err(`absent 要是板塊種類的陣列（${PANELS.join("、")}）`);
  else absent.push(...new Set(rawAbsent));

  // Extra cards: each one's content is checked like the first card's (the rest of the file as is).
  const extras: Extra[] = [];
  const rawExtras = raw.extras ?? [];
  if (!Array.isArray(rawExtras)) err("extras 必須是陣列");
  else if (!errors.length)
    rawExtras.forEach((e, i) => {
      if (!isObj(e) || typeof e.id !== "string" || !/^[a-z]+-[a-z0-9]{1,12}$/.test(e.id) || !isPanel(e.type))
        return err(`extras[${i}]：需要 id（例如 weather-2）與 type（${PANELS.join("、")}）`);
      if (extras.some((x) => x.id === e.id)) return err(`extras[${i}]：id「${e.id}」重複`);
      if (extras.filter((x) => x.type === e.type).length >= MAX_PER_TYPE - 1) return err(`extras[${i}]：每種板塊最多 ${MAX_PER_TYPE} 個`);
      const fields: readonly (keyof Settings)[] = FIELDS[e.type];
      const own = Object.fromEntries(fields.filter((f) => e[f] !== undefined).map((f) => [f, e[f]]));
      const sub = validate({ ...raw, extras: [], layout: undefined, names: undefined, ...own });
      if (!sub.settings) return sub.errors.forEach((m) => err(`extras[${i}]（${e.id}）：${m}`));
      extras.push({ id: e.id, type: e.type, ...Object.fromEntries(fields.map((f) => [f, sub.settings![f]])) });
    });
  const over = errors.length ? null : overLimit({ ...DEFAULT_SETTINGS, weather, markets, bus, trains, extras });
  if (over) err(over);
  // A type with extras keeps its first card (deleting the first moves an extra into it).
  const present = absent.filter((t) => !extras.some((e) => e.type === t));
  absent.length = 0;
  absent.push(...present);

  // Older files have no layout: the default boxes. Every card needs a box in both layouts.
  const ids = [...PANELS.filter((p) => !absent.includes(p)), ...extras.map((e) => e.id)];
  const layout: Layout = {
    ...DEFAULT_LAYOUT,
    wide: { ...DEFAULT_LAYOUT.wide },
    tall: { ...DEFAULT_LAYOUT.tall },
    hidden: { wide: [], tall: [] },
  };
  const given: Record<LayoutMode, CardId[]> = { wide: [], tall: [] };
  if (raw.layout !== undefined && !isObj(raw.layout)) err("layout 必須是物件");
  else if (isObj(raw.layout)) {
    // One list (before each layout had its own) applies to both. Cards that aren't in this file
    // (a layout imported without its cards) are skipped; older files' phone list is ignored.
    const h = raw.layout.hidden ?? [];
    for (const sc of SCREENS) {
      const list = Array.isArray(h) ? h : isObj(h) ? (h[sc] ?? []) : null;
      const known = Array.isArray(list) ? [...new Set(list.filter((p) => ids.includes(p as string)))] : null;
      // Every card hidden is allowed: the board is then empty, as with every card deleted.
      if (!known) err(`layout.hidden.${sc} 要是板塊 id 的陣列`);
      else layout.hidden[sc] = known as CardId[];
    }
    for (const m of ["wide", "tall"] as const) {
      const v = raw.layout[m];
      if (v === undefined) continue;
      // The first version stored a card per fixed slot.
      if (Array.isArray(v) && v.length === SLOT_PANELS.length && SLOT_PANELS.every((p) => v.includes(p))) {
        layout[m] = fromSlots(m, v as Panel[]);
        given[m] = SLOT_PANELS.filter((p) => ids.includes(p));
        continue;
      }
      given[m] = isObj(v) ? ids.filter((p) => v[p] !== undefined) : [];
      const boxes = Object.fromEntries(given[m].map((p) => [p, (v as Record<string, unknown>)[p]])) as Boxes;
      // A hidden card's box only has to be on the board: other cards may have moved over it.
      const ok =
        isObj(v) &&
        given[m].every(
          (p) => isObj(boxes[p]) && (layout.hidden[m].includes(p) ? fits({ [p]: boxes[p] }, p, boxes[p]) : fits(boxes, p, boxes[p], layout.hidden[m])),
        );
      if (!ok) {
        err(`layout.${m} 要替每個板塊給一個 {x, y, w, h}（0～${GRID} 的整數格，寬至少 ${MIN_W}、高至少 ${MIN_H}，不能重疊）`);
        continue;
      }
      layout[m] = Object.fromEntries(given[m].map((p) => [p, { x: boxes[p].x, y: boxes[p].y, w: boxes[p].w, h: boxes[p].h }]));
    }
    // Older files also have the phone's tab order (layout.tabs, layout.transit): phones now have fixed tabs.
  }
  // A card without a box (an extra, or a type added after the file was saved): its default box or
  // a free spot; with no room it starts hidden (its box then only waits for the card to come back).
  for (const m of ["wide", "tall"] as const) {
    const boxes: Boxes = Object.fromEntries(given[m].map((p) => [p, layout[m][p]]));
    for (const p of ids.filter((q) => !given[m].includes(q))) {
      const own = isPanel(p) ? preset[m][p] : undefined;
      if (own && !given[m].length) boxes[p] = own;
      else {
        // The biggest of these sizes that has room (the smallest can be too small to read on a screen).
        const sizes = [{ w: 8, h: 9 }, { w: 6, h: 6 }, { w: MIN_W, h: MIN_H }];
        const spot = findSpot({ ...boxes, ...(own ? { [p]: own } : {}) }, p, layout.hidden[m], sizes);
        if (spot) boxes[p] = spot;
        else {
          boxes[p] = { x: 0, y: 0, w: MIN_W, h: MIN_H };
          if (!layout.hidden[m].includes(p)) layout.hidden[m].push(p);
        }
      }
    }
    layout[m] = boxes;
  }

  const names: Record<CardId, string> = {};
  if (raw.names !== undefined && !isObj(raw.names)) err("names 必須是物件（板塊 id → 名稱）");
  else if (isObj(raw.names))
    for (const [id, n] of Object.entries(raw.names)) {
      if (!ids.includes(id)) continue; // a removed card's name
      if (typeof n !== "string" || !n.trim() || n.length > MAX_NAME) err(`names.${id} 要是 1～${MAX_NAME} 字的名稱`);
      else names[id] = n.trim();
    }

  if (errors.length) return { errors };
  return { settings: { version: 1, weather, markets, bus, trains, news, newsOrder, todos, todoLocked: todoLocked === true, absent, layout, extras, names }, errors };
}

// ---------- Storage and React context ----------

const KEY = "settings.v1";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const { settings } = validate(JSON.parse(raw));
      if (settings) return settings;
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

const Ctx = createContext<{ settings: Settings; setSettings: (s: Settings) => void }>({
  settings: DEFAULT_SETTINGS,
  setSettings: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);
  useEffect(() => {
    try {
      // Keep storage empty while on the defaults, so later default changes still reach this device.
      if (JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS)) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);
  // Every change goes through the totals check (an editor only sees its own card's lists).
  const set = (s: Settings) => {
    const over = overLimit(s);
    if (over) toast(over, "error");
    else setSettings(s);
  };
  return (
    <RootCtx.Provider value={settings}>
      <Ctx.Provider value={{ settings, setSettings: set }}>{children}</Ctx.Provider>
    </RootCtx.Provider>
  );
}
/** The whole settings, even inside a card (whose useSettings shows that card's content). */
const RootCtx = createContext<Settings>(DEFAULT_SETTINGS);

const LIMITED = { weather: "weather", markets: "markets", bus: "bus", trains: "train" } as const;
/** How many items the card being edited may hold: the type's limit minus what its other cards use. */
export function useLimit(f: keyof typeof LIMITED): number {
  const root = useContext(RootCtx);
  const type = LIMITED[f];
  const own = useContext(CardCtx)?.id ?? type;
  const count = (id: CardId) => (isPanel(id) ? root[f].length : (root.extras.find((e) => e.id === id)?.[f]?.length ?? 0));
  const others = cardIds(root).filter((id) => id !== own && typeOf(root, id) === type);
  return LIMITS[f] - others.reduce((n, id) => n + count(id), 0);
}

export const useSettings = () => useContext(Ctx);

const CardCtx = createContext<{ id: CardId; n: number } | null>(null);
/** The card being rendered: its id, and its number among the cards of its type (1 = the first). */
export const useCard = () => useContext(CardCtx);

/**
 * Renders one card. Inside, an extra card's own content stands in for its type's top-level fields
 * (settings.weather and so on), and writes to those fields go back to the extra card, so the
 * card components and the content editor work on any card unchanged.
 */
export function CardSettings({ id, children }: { id: CardId; children: ReactNode }) {
  const root = useContext(Ctx);
  const s = root.settings;
  const extra = s.extras.find((e) => e.id === id);
  let value = root;
  let n = 1;
  if (extra) {
    n = s.extras.filter((e) => e.type === extra.type).indexOf(extra) + 2;
    const fields: readonly (keyof Settings)[] = FIELDS[extra.type];
    value = {
      settings: cardView(s, id),
      setSettings: (v) => {
        const own = Object.fromEntries(fields.map((f) => [f, v[f]]));
        const back = Object.fromEntries(fields.map((f) => [f, s[f]]));
        root.setSettings({ ...v, ...back, extras: v.extras.map((e) => (e.id === id ? { ...e, ...own } : e)) });
      },
    };
  }
  return (
    <Ctx.Provider value={value}>
      <CardCtx.Provider value={{ id, n }}>{children}</CardCtx.Provider>
    </Ctx.Provider>
  );
}
