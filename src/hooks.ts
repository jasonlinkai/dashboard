import { useEffect, useRef, useState } from "react";

/** A fetch result plus how fresh the underlying data is. */
export interface Loaded<T> {
  data: T;
  /** When the backend last fetched this from the real source (unix ms); null = unknown. */
  dataTime: number | null;
  /** The backend couldn't refresh and served its previous copy. */
  stale: boolean;
}

export interface Polled<T> {
  data: T | undefined;
  dataTime: number | null;
  stale: boolean;
  error: string | null;
  updated: number | null;
  loading: boolean;
  /** When the next refresh is due (unix ms); null while paused in the background. */
  nextAt: number | null;
  intervalSec: number;
}

/**
 * Fetches immediately, then `intervalSec` after each fetch finishes, so `nextAt` is an exact
 * countdown target. After the first load it pauses while the page is hidden and refreshes as soon as it is shown again
 * (e.g. waking the iPad). Keeps the last good data on error so a flaky network doesn't blank the screen.
 */
export function usePolling<T>(load: () => Promise<Loaded<T>>, intervalSec: number, deps: unknown[] = []): Polled<T> {
  const [state, setState] = useState<Polled<T>>({
    data: undefined,
    dataTime: null,
    stale: false,
    error: null,
    updated: null,
    loading: true,
    nextAt: null,
    intervalSec,
  });
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let active = true;
    let paused = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    let first = true;
    const tick = async () => {
      timer = undefined;
      // Always do the first load, even in a background tab, so the page is never left blank.
      if (!first && document.visibilityState !== "visible") {
        paused = true;
        setState((s) => ({ ...s, nextAt: null }));
        return;
      }
      first = false;
      try {
        const { data, dataTime, stale } = await loadRef.current();
        if (!active) return;
        const now = Date.now();
        setState({ data, dataTime, stale, error: null, updated: now, loading: false, nextAt: now + intervalSec * 1000, intervalSec });
      } catch (e) {
        if (!active) return;
        const error = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, error, loading: false, nextAt: Date.now() + intervalSec * 1000, intervalSec }));
      }
      timer = setTimeout(tick, intervalSec * 1000);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && paused) {
        paused = false;
        tick();
      }
    };

    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalSec, ...deps]);

  return state;
}

/** Fetches JSON; freshness comes from our Worker's X-Data-Time / X-Data-Stale headers. */
export async function getJSON<T>(url: string): Promise<Loaded<T>> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return {
    data: body as T,
    dataTime: Number(res.headers.get("X-Data-Time")) || null,
    stale: res.headers.get("X-Data-Stale") === "1",
  };
}

/** Re-renders every `ms` — used for the clock and "x 分鐘前" labels. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Keeps the screen on while the dashboard is open (Safari 16.4+, Chrome). */
export function useWakeLock() {
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem("wakeLock") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("wakeLock", enabled ? "1" : "0");
    } catch {}
    if (!supported || !enabled) return;
    let sentinel: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {}
    };
    // The lock is dropped whenever the page is hidden, so take it again on return.
    const onVisible = () => document.visibilityState === "visible" && acquire();
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      sentinel?.release().catch(() => {});
    };
  }, [enabled, supported]);

  return { supported, enabled, toggle: () => setEnabled((v) => !v) };
}

/**
 * For scrollable lists: sets data-more="true" while there is content below the fold, so the
 * bottom fade only appears when there really is more to scroll to.
 */
export function useScrollHint<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      el.dataset.more = String(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const mutate = new MutationObserver(update); // new data arrived
    mutate.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", update);
      resize.disconnect();
      mutate.disconnect();
    };
  }, []);
  return ref;
}
