// What's on the dashboard: weather places, market tiles, bus stops, train routes and news sources.
// Kept per device in the browser; can be exported / imported as a JSON file (see validate()).

import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
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
}

export interface Settings {
  version: 1;
  weather: WeatherPlace[];
  markets: MarketItem[];
  bus: BusStop[];
  trains: TrainRoute[];
  trainType: TrainType;
  news: Record<Topic, string[]>;
}

// ---------- Catalogs and limits ----------

export { BUS_CITY_LIST as BUS_CITIES, type BusCity } from "./bus-cities";

/** 車種：用車種名稱的關鍵字篩選（「區間」也包含「區間快」） */
export const TRAIN_TYPES = ["區間", "自強", "莒光", "全部"] as const;
export type TrainType = (typeof TRAIN_TYPES)[number];
export const trainTypeKeyword = (t: TrainType) => (t === "全部" ? "" : t);

const price = (decimals: number, prefix?: string) => ({ kind: "price" as const, decimals, ...(prefix ? { prefix } : {}) });
const yieldOf = (symbol: string, name: string): Instrument => ({ symbol, name, subtitle: "殖利率", format: { kind: "yield" }, feedDelayMin: 15 });

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

export const LIMITS = { weather: 10, markets: 12, bus: 10, trains: 8, news: MAX_NEWS_SOURCES };

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
    { from: "汐科", to: "臺北" },
    { from: "臺北", to: "汐科" },
    { from: "松山", to: "汐科" },
  ],
  trainType: "區間",
  news: DEFAULT_NEWS,
};

// ---------- Derived helpers ----------

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

export function validate(raw: unknown): { settings?: Settings; errors: string[] } {
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
        if (typeof m.symbol !== "string" || !SYMBOL.test(m.symbol) || !text(m.name, 10)) {
          return err(`${at}：symbol 只能是 Yahoo 代號（英數與 . ^ = -，20 字內），name 10 字內`);
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
      if (!text(b.route, 12) || !text(b.stop, 24)) return err(`${at}：route、stop 必填（不能含 , 或 :）`);
      const direction = b.direction ?? "auto";
      if (direction !== "auto" && direction !== 0 && direction !== 1) return err(`${at}：direction 只能是 "auto"、0 或 1`);
      if (b.toward !== undefined && !text(b.toward, 24)) return err(`${at}：toward 不能是空字串，也不能含 , 或 :`);
      if (b.headsign !== undefined && !(typeof b.headsign === "string" && b.headsign.length <= 30)) return err(`${at}：headsign 要是 30 字內的文字`);
      bus.push({
        city: b.city,
        route: b.route as string,
        stop: b.stop as string,
        direction,
        ...(b.toward ? { toward: b.toward as string } : {}),
        ...(b.headsign ? { headsign: b.headsign as string } : {}),
      });
    });
    const routes = bus.map((b) => `${b.city}:${b.route}`);
    if (new Set(routes).size !== routes.length) err("bus 的同一條路線只能出現一次");
    const cities = new Set(bus.map((b) => b.city));
    if (cities.size > MAX_BUS_CITIES) err(`bus 最多 ${MAX_BUS_CITIES} 個縣市（每個縣市每分鐘多查一次 TDX）`);
  }

  const trains: TrainRoute[] = [];
  if (!Array.isArray(raw.trains)) err("trains 必須是陣列");
  else {
    if (raw.trains.length > LIMITS.trains) err(`trains 最多 ${LIMITS.trains} 條`);
    raw.trains.forEach((t, i) => {
      if (!isObj(t) || !text(t.from, 8) || !text(t.to, 8)) return err(`trains[${i}]：需要 from 與 to 站名`);
      if (t.from === t.to) return err(`trains[${i}]：上下車站不能相同`);
      trains.push({ from: t.from as string, to: t.to as string });
    });
  }

  const trainType = raw.trainType ?? "區間";
  if (!TRAIN_TYPES.includes(trainType as TrainType)) err(`trainType 只能是 ${TRAIN_TYPES.join("、")}`);

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

  if (errors.length) return { errors };
  return { settings: { version: 1, weather, markets, bus, trains, trainType: trainType as TrainType, news }, errors };
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
  return <Ctx.Provider value={{ settings, setSettings }}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);
