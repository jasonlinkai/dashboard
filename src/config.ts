// 固定的設定與連結。畫面上要顯示哪些地點、行情、公車、火車、新聞來源，在 src/settings.tsx（使用者可在設定畫面調整）。

import type { WeatherPlace } from "./settings";

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

/** 台灣習慣紅漲綠跌；改成 false 就是美式綠漲紅跌 */
export const RED_IS_UP = true;

/** "auto" 判斷「往台北」的關鍵字（比對路線的往 XX 方向） */
export const TOWARD_TAIPEI = /捷運|臺北|台北|市政府|南港|昆陽|松山/;

export const TRAIN_LIMIT = 10; // 列表可捲動，螢幕高的時候能多顯示幾班

export const links = {
  /** 臺鐵營運資訊（停駛、通阻公告） */
  traAlerts: "https://www.railway.gov.tw/tra-tip-web/tip",
  quote: (i: Instrument) => `https://tw.stock.yahoo.com/quote/${encodeURIComponent(i.page ?? i.symbol)}`,
  weather: (p: WeatherPlace) => `https://www.cwa.gov.tw/V8/C/W/Town/Town.html?TID=${p.townId}`,
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

