import { useEffect, useRef, useState } from "react";
import { tdxHeaders, usesTdx } from "./tdxKey";
import { toast } from "./toast";

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
  /** The deps the shown data was loaded for; differs from `key` right after they change. */
  dataKey: string | null;
  /** The current deps. */
  key: string;
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
    dataKey: null,
    key: "",
  });
  const key = JSON.stringify(deps);
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
        setState({ data, dataTime, stale, error: null, updated: now, loading: false, nextAt: now + intervalSec * 1000, intervalSec, dataKey: key, key });
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

    // New deps (e.g. another news topic): what's on screen is for the old ones until this loads.
    setState((s) => ({ ...s, loading: true }));
    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalSec, ...deps]);

  return { ...state, key };
}

/** Fetches JSON; freshness comes from our Worker's X-Data-Time / X-Data-Stale headers. */
export async function getJSON<T>(url: string): Promise<Loaded<T>> {
  const res = await fetch(url, { headers: usesTdx(url) ? tdxHeaders() : {} });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return {
    data: body as T,
    dataTime: Number(res.headers.get("X-Data-Time")) || null,
    stale: res.headers.get("X-Data-Stale") === "1",
  };
}

/**
 * Cards of one type (天氣, 天氣 2 …) poll on the same beat. List requests to the same endpoint made
 * within a moment go out as one, asking for everything any of them wants; every caller gets that
 * combined answer and keeps its own part. So more cards don't mean more requests to the server.
 */
// shortcut: cards whose polls drift apart (one's content just changed) fetch separately until the
// page reloads; bounded by MAX_PER_TYPE. Align them to a shared clock if that ever matters.
const batches = new Map<string, { items: Set<string>; done: Promise<Loaded<unknown>> }>();
export function getBatched<T>(path: string, param: string, items: string[]): Promise<Loaded<T>> {
  let b = batches.get(path);
  if (!b) {
    const all = new Set<string>();
    const done = new Promise((r) => setTimeout(r, 50)).then(() => {
      batches.delete(path);
      return getJSON<T>(`${path}?${param}=${encodeURIComponent([...all].join(","))}`);
    });
    b = { items: all, done };
    batches.set(path, b);
  }
  for (const i of items) b.items.add(i);
  return b.done as Promise<Loaded<T>>;
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
 * Ref for a scrollable list. The "more below" hint is drawn by scrollCues.ts on the list's parent;
 * nothing is written to the list itself while it scrolls (that can cut iOS momentum scrolling short).
 */
export function useScrollHint<T extends HTMLElement>() {
  return useRef<T>(null);
}

// Long enough that resting a finger before scrolling doesn't turn into a drag.
const LONG_PRESS_MS = 700;

/**
 * Long-press-and-drag reordering for the cards on the board itself (weather cards, market tiles,
 * train routes). The items are links inside scrolling areas, so a drag only starts after holding
 * still for a moment; moving earlier is a normal scroll, and the tap after a drag doesn't open the link.
 * Mark each direct child that can move with `data-reorder`; `onMove(from, to)` gets list indexes.
 * With `handle`, only a press inside that part of an item (e.g. a route's header) starts a drag.
 */
export function useReorder<T extends HTMLElement>(onMove: (from: number, to: number) => void, handle?: string) {
  const ref = useRef<T>(null);
  const latest = useRef(onMove);
  latest.current = onMove;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let item: HTMLElement | null = null;
    let start = { x: 0, y: 0 };
    let grab = { x: 0, y: 0 }; // where in the card it was picked up
    let active = false;
    let moved = false;
    let swallowClick = false;
    const items = () => [...root.children].filter((c): c is HTMLElement => c instanceof HTMLElement && "reorder" in c.dataset);

    /** Keep the lifted card under the pointer, wherever its slot currently is. */
    const follow = (x: number, y: number) => {
      if (!item) return;
      item.style.transform = "";
      const slot = item.getBoundingClientRect();
      item.style.transform = `translate(${x - grab.x - slot.left}px, ${y - grab.y - slot.top}px) scale(1.05)`;
    };
    const stop = () => {
      clearTimeout(timer);
      if (active && item) {
        item.classList.remove("reordering");
        item.style.transform = "";
        root.classList.remove("reorder-active");
        swallowClick = true; // the click that follows the release
        setTimeout(() => (swallowClick = false), 400);
        toast(moved ? "已更新順序" : "順序沒有改變", moved ? "ok" : "info");
      }
      active = false;
      item = null;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-reorder]");
      if (!el || el.parentElement !== root) return;
      if (handle && !(e.target as HTMLElement).closest(handle)) return;
      item = el;
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        active = true;
        moved = false;
        root.classList.add("reorder-active"); // may fold content (train routes): measure after
        el.classList.add("reordering");
        const box = el.getBoundingClientRect();
        grab = { x: Math.min(start.x - box.left, box.width / 2), y: Math.min(start.y - box.top, box.height / 2) };
        follow(start.x, start.y);
        navigator.vibrate?.(15);
        toast("拖到想要的位置後放開", "info");
      }, LONG_PRESS_MS);
    };
    const move = (e: PointerEvent) => {
      if (!item) return;
      if (!active) {
        // Moved before the long press: it's a scroll (or a tap that slipped), not a drag.
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) stop();
        return;
      }
      e.preventDefault();
      const list = items();
      // The card under the pointer, other than the one being carried.
      const to = list.findIndex((c) => {
        if (c === item) return false;
        const b = c.getBoundingClientRect();
        return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
      });
      const from = list.indexOf(item);
      if (to >= 0 && from >= 0) {
        latest.current(from, to);
        moved = true;
      }
      // Dragging to the edge of a scrolling area brings the rest into reach.
      const box = root.getBoundingClientRect();
      if (root.scrollHeight > root.clientHeight) {
        if (e.clientY < box.top + 30) root.scrollBy(0, -10);
        else if (e.clientY > box.bottom - 30) root.scrollBy(0, 10);
      }
      if (root.scrollWidth > root.clientWidth) {
        if (e.clientX < box.left + 30) root.scrollBy(-10, 0);
        else if (e.clientX > box.right - 30) root.scrollBy(10, 0);
      }
      // After React has moved the card to its new slot.
      const x = e.clientX;
      const y = e.clientY;
      requestAnimationFrame(() => follow(x, y));
    };
    const click = (e: MouseEvent) => {
      if (!swallowClick) return;
      e.preventDefault();
      e.stopPropagation();
      swallowClick = false;
    };
    // Once dragging, the finger must not scroll the page or the list underneath.
    const touchMove = (e: TouchEvent) => active && e.preventDefault();
    // Holding a link would otherwise open the link preview / context menu.
    const menu = (e: Event) => item && e.preventDefault();
    const noNativeDrag = (e: DragEvent) => e.preventDefault();

    root.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("touchmove", touchMove, { passive: false });
    root.addEventListener("click", click, true);
    root.addEventListener("contextmenu", menu);
    root.addEventListener("dragstart", noNativeDrag);
    return () => {
      clearTimeout(timer);
      root.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("touchmove", touchMove);
      root.removeEventListener("click", click, true);
      root.removeEventListener("contextmenu", menu);
      root.removeEventListener("dragstart", noNativeDrag);
    };
  }, []);
  return ref;
}

/** Move one item to another index (for useReorder). */
export const moveTo = <T,>(list: T[], from: number, to: number): T[] => {
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
};
