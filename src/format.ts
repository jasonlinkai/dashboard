import { RED_IS_UP } from "./config";

export const fmt = (n: number, decimals: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const signed = (n: number, decimals: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n), decimals);

/** CSS class for a price move, honoring the 紅漲綠跌 setting. */
export function moveClass(change: number | null | undefined): string {
  if (!change) return "flat";
  return change > 0 === RED_IS_UP ? "red" : "green";
}

const timeFmt = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" });
export const clock = (ms: number) => timeFmt.format(ms);
const dayFmt = new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", timeZone: "Asia/Taipei" });
/** Time, with the date in front when it isn't today (Taipei): "04:00" or "10/17 04:00". */
export const clockDay = (ms: number, now = Date.now()) => (dayFmt.format(ms) === dayFmt.format(now) ? "" : `${dayFmt.format(ms)} `) + clock(ms);

export function ago(ms: number, now = Date.now()): string {
  const min = Math.floor((now - ms) / 60000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.floor(h / 24)} 天前`;
}

/** Countdown to a bus / train: "45 秒", "8 分 05 秒", "1 時 12 分". */
export function countdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, "0")} 秒`;
  return `${Math.floor(s / 3600)} 時 ${Math.floor((s % 3600) / 60)} 分`;
}

/** Refresh countdown: "0:23", "9:42". */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
