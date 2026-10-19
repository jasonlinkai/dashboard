import { AsyncLocalStorage } from "node:async_hooks";

export interface Env {
  ASSETS: Fetcher;
  TDX_CLIENT_ID?: string;
  TDX_CLIENT_SECRET?: string;
  CWA_API_KEY?: string;
}

export const UA = "Mozilla/5.0 (compatible; dashboard/1.0)";

/**
 * Freshness of the live data one API request used, sent to the page as response headers so a
 * card can say how old its data really is instead of implying it is current.
 */
export interface Freshness {
  oldest: number; // unix ms of the oldest upstream fetch used (Infinity = none)
  stale: boolean; // true if any value was a fallback after a failed refresh
}
export const freshness = new AsyncLocalStorage<Freshness>();

// Anything cached for an hour or more is reference data (station lists, timetables), not live data.
const LIVE_TTL_SEC = 3600;

const memo = new Map<string, { fetchedAt: number; expires: number; value: unknown }>();
const STALE_OK_MS = 15 * 60_000;

function track(ttlSec: number, fetchedAt: number, stale: boolean) {
  const f = freshness.getStore();
  if (!f || ttlSec >= LIVE_TTL_SEC) return;
  f.oldest = Math.min(f.oldest, fetchedAt);
  f.stale ||= stale;
}

/**
 * Per-isolate cache so many open tablets don't multiply upstream calls. If a refresh fails
 * (e.g. rate limited) the previous value is served for up to 15 minutes, but flagged as stale so
 * the page can warn. Only resolved values are stored, never pending promises: workerd hangs a
 * request that awaits a promise created by another request.
 */
export async function cached<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && hit.expires > Date.now()) {
    track(ttlSec, hit.fetchedAt, false);
    return hit.value as T;
  }
  try {
    const value = await load();
    const fetchedAt = Date.now();
    memo.set(key, { fetchedAt, expires: fetchedAt + ttlSec * 1000, value });
    track(ttlSec, fetchedAt, false);
    return value;
  } catch (e) {
    if (hit && Date.now() - hit.expires < STALE_OK_MS) {
      track(ttlSec, hit.fetchedAt, true);
      return hit.value as T;
    }
    throw e;
  }
}

export async function fetchJSON(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

/** TDX wraps v3 responses as { Foo: [...] } but v2 returns bare arrays; accept either. */
export function rows(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const v of Object.values(data)) if (Array.isArray(v)) return v;
  }
  return [];
}

/** Taiwan has no DST, so local time is always UTC+8. */
export function taipeiNow() {
  const d = new Date(Date.now() + 8 * 3600_000);
  return {
    date: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}
