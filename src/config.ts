// 所有可以調整的項目都在這個檔案。

export interface Location {
  name: string;
  latitude: number;
  longitude: number;
  /** 氣象署測站：先找指定站名，沒有的話用同一行政區的任一測站。townId 是氣象署鄉鎮預報頁的代碼 */
  cwa: { county: string; town: string; townId: string; station?: string };
}

export const LOCATIONS: Location[] = [
  { name: "汐止", latitude: 25.0629, longitude: 121.658, cwa: { county: "新北市", town: "汐止區", townId: "6501100", station: "汐止" } },
  { name: "南港", latitude: 25.055, longitude: 121.6067, cwa: { county: "臺北市", town: "南港區", townId: "6300900" } },
  { name: "內湖", latitude: 25.0836, longitude: 121.5944, cwa: { county: "臺北市", town: "內湖區", townId: "6301000", station: "內湖" } },
  { name: "台北", latitude: 25.0375, longitude: 121.5637, cwa: { county: "臺北市", town: "中正區", townId: "6300500", station: "臺北" } },
];

export type QuoteFormat = { kind: "price"; decimals: number; prefix?: string } | { kind: "yield" };

export interface Instrument {
  symbol: string; // Yahoo Finance 代號（點擊後開 Yahoo股市 的報價頁）
  page?: string; // Yahoo股市 頁面代號，和 symbol 不同時才需要
  /** 資料來源本身固定延遲的分鐘數（例如 Yahoo 的美債殖利率約晚 15 分鐘），畫面會標示「延遲報價」 */
  feedDelayMin?: number;
  name: string;
  subtitle: string;
  format: QuoteFormat;
}

export const INSTRUMENTS: Instrument[] = [
  { symbol: "^TWII", name: "台股加權", subtitle: "TAIEX", format: { kind: "price", decimals: 2 } },
  { symbol: "^IXIC", name: "那斯達克", subtitle: "NASDAQ", format: { kind: "price", decimals: 2 } },
  { symbol: "BTC-USD", name: "比特幣", subtitle: "BTC / USD", format: { kind: "price", decimals: 0, prefix: "$" } },
  { symbol: "GC=F", name: "黃金", subtitle: "USD / oz", format: { kind: "price", decimals: 1, prefix: "$" } },
  { symbol: "TWD=X", page: "USDTWD=X", name: "美元 / 台幣", subtitle: "USD / TWD", format: { kind: "price", decimals: 3 } },
  { symbol: "^IRX", name: "美債 13 週", subtitle: "殖利率", format: { kind: "yield" }, feedDelayMin: 15 },
  { symbol: "^FVX", name: "美債 5 年", subtitle: "殖利率", format: { kind: "yield" }, feedDelayMin: 15 },
  { symbol: "^TNX", name: "美債 10 年", subtitle: "殖利率", format: { kind: "yield" }, feedDelayMin: 15 },
  { symbol: "^TYX", name: "美債 30 年", subtitle: "殖利率", format: { kind: "yield" }, feedDelayMin: 15 },
];

/** 台灣習慣紅漲綠跌；改成 false 就是美式綠漲紅跌 */
export const RED_IS_UP = true;

export interface BusStop {
  city: string; // TDX 縣市代碼：NewTaipei、Taipei…
  route: string;
  stop: string;
  /** 0 = 去程, 1 = 返程, "auto" = 選目的地看起來是往台北的方向 */
  direction: 0 | 1 | "auto";
}

export const BUS_STOPS: BusStop[] = [
  { city: "NewTaipei", route: "藍23", stop: "忠孝里", direction: "auto" },
  { city: "NewTaipei", route: "藍39", stop: "樟樹實中", direction: "auto" },
];

/** "auto" 判斷「往台北」的關鍵字（比對路線的往 XX 方向） */
export const TOWARD_TAIPEI = /捷運|臺北|台北|市政府|南港|昆陽|松山/;

export const TRAIN = {
  from: "汐科", // 上車站
  to: "臺北",
  type: "區間", // 也會包含「區間快」
  limit: 6,
};

export const links = {
  quote: (i: Instrument) => `https://tw.stock.yahoo.com/quote/${encodeURIComponent(i.page ?? i.symbol)}`,
  weather: (l: Location) => `https://www.cwa.gov.tw/V8/C/W/Town/Town.html?TID=${l.cwa.townId}`,
  bus: (routeId: string) => `https://pda5284.gov.taipei/MQS/route.jsp?rid=${routeId}`,
  /** 臺鐵車次查詢，含停靠站與即時誤點 */
  train: (trainNo: string, date: string) =>
    `https://tip.railway.gov.tw/tra-tip-web/tip/tip001/tip112/querybytrainno?rideDate=${date.replace(/-/g, "/")}&trainNo=${trainNo}`,
};

export const REFRESH_SEC = {
  quotes: 30,
  bus: 60, // TDX 每分鐘只能查 5 次，後端每分鐘只向 TDX 查一次，調低也不會更即時
  train: 60,
  weather: 600,
  news: 600,
};

/** 資料超過這個秒數沒從來源更新，卡片會變紅並顯示「資料延遲」 */
export const STALE_AFTER_SEC = {
  quotes: 120,
  bus: 180,
  train: 180,
  weather: 1800,
  news: 1800,
};

/** 開盤中超過這麼多分鐘沒有新成交（扣掉 feedDelayMin 之後），顯示「停在 HH:MM」 */
export const QUOTE_LAG_MIN = 15;
/** 氣象署測站資料超過這麼多分鐘就不用，改用 Open-Meteo 模型 */
export const STATION_MAX_AGE_MIN = 90;
/** 單一公車預估超過這麼多分鐘沒更新，該列顯示警告 */
export const BUS_ESTIMATE_STALE_MIN = 3;

