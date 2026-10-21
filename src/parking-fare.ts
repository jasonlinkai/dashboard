// Reads a car rate out of TDX's free-text FareDescription. The text has no fixed format
// ("10元/半小時", "每小時40元", "30元半小時", "依現場公告"…), so this only picks up phrasings it is
// sure about and returns null otherwise. The page always calls the result an estimate and shows
// the original text next to it.

export interface FareEstimate {
  /** Cheapest and dearest hourly car rate mentioned (元/小時). */
  hourly: { min: number; max: number } | null;
  /** Flat per-entry car rate (元/次), when there is no hourly one. */
  perEntry: { min: number; max: number } | null;
}

// Clauses about something other than a car's short stay: monthly passes, scooters, staff,
// residents' discounts, EV charging…
const NOT_SHORT_STAY = /機車|重機|月|季|年|員工|里民|身障|優惠|大型|大客|大車|貨|遊覽|充電|每度|會員|過夜|夜間包|包時/;

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const HALF = String.raw`(?:半小時|半時|30\s*分鐘?)`;
const HOUR = String.raw`(?:小時|時|hr|HR|Hr|h)`;

const patterns: [RegExp, number][] = [
  [new RegExp(`${NUM}\\s*元\\s*[/／]?\\s*(?:每)?\\s*${HALF}`, "g"), 2], // 10元/半小時, 30元半小時
  [new RegExp(`每\\s*${HALF}\\s*[:：]?\\s*${NUM}\\s*元`, "g"), 2], // 每半小時20元
  [new RegExp(`${NUM}\\s*元\\s*[/／]\\s*(?:每)?\\s*1?\\s*${HOUR}`, "g"), 1], // 40元/時, 40元/小時, 40元/1小時
  [new RegExp(`${NUM}\\s*元\\s*每\\s*${HOUR}`, "g"), 1], // 40元每小時
  [new RegExp(`每\\s*${HOUR}\\s*[:：]?\\s*${NUM}\\s*元`, "g"), 1], // 每小時40元
  [new RegExp(`計時\\s*${NUM}\\s*元(?!\\s*[/／])`, "g"), 1], // 新北市資料：小型車計時80元（每小時）
];
const perEntry = [new RegExp(`${NUM}\\s*元\\s*[/／]\\s*次`, "g"), new RegExp(`每\\s*次\\s*[:：]?\\s*${NUM}\\s*元`, "g")];

const range = (xs: number[]) => (xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : null);

export function estimateFare(text: string | undefined): FareEstimate | null {
  if (!text) return null;
  const hours: number[] = [];
  const entries: number[] = [];
  for (const clause of text.replace(/,(?=\d{3})/g, "").split(/[、，,；;。\n]/)) {
    if (NOT_SHORT_STAY.test(clause)) continue;
    let rest = clause;
    for (const [re, factor] of patterns) {
      rest = rest.replace(re, (_m, n) => {
        const v = Number(n) * factor;
        if (v > 0 && v <= 1000) hours.push(v);
        return " ";
      });
    }
    for (const re of perEntry) for (const m of rest.matchAll(re)) if (Number(m[1]) > 0) entries.push(Number(m[1]));
  }
  const hourly = range(hours);
  const flat = hourly ? null : range(entries);
  return hourly || flat ? { hourly, perEntry: flat } : null;
}
