// Rearranging the cards: which layout is showing, the edit mode's shared state, dragging a card
// onto another slot (Pointer Events), and the FLIP animation that plays when cards change places.

import { type RefObject, createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type LayoutMode, PANELS, type Panel } from "./settings";

export type Mode = LayoutMode | "phone";

/** Keep in step with the tablet / desktop queries in styles.css (wide wins where both match). */
const QUERIES: [LayoutMode, string][] = [
  ["wide", "(min-width: 900px) and (min-aspect-ratio: 1/1) and (min-height: 560px)"],
  ["tall", "(min-width: 700px) and (max-aspect-ratio: 1/1)"],
];
const currentMode = (): Mode => QUERIES.find(([, q]) => matchMedia(q).matches)?.[0] ?? "phone";

export function useLayoutMode(): Mode {
  const [mode, setMode] = useState(currentMode);
  useEffect(() => {
    const lists = QUERIES.map(([, q]) => matchMedia(q));
    const update = () => setMode(currentMode());
    for (const l of lists) l.addEventListener("change", update);
    return () => lists.forEach((l) => l.removeEventListener("change", update));
  }, []);
  return mode;
}

// Long-pressing a card's title (in Section) asks App to start editing.
const EVENT = "edit-layout";
export const editLayout = () => window.dispatchEvent(new Event(EVENT));
export function onEditLayout(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

export interface LayoutEdit {
  editing: boolean;
  mode: Mode;
  /** The card's slot in the current layout (0-based). */
  slot: (p: Panel) => number;
  /** Swap with the card next to it in an arrow key's direction; false when there is none. */
  move: (p: Panel, key: string) => boolean;
}
export const LayoutEditContext = createContext<LayoutEdit>({ editing: false, mode: "phone", slot: () => 0, move: () => false });
export const useLayoutEdit = () => useContext(LayoutEditContext);

export const isPanel = (s: string): s is Panel => (PANELS as readonly string[]).includes(s);
const panelOf = (el: Element) => PANELS.find((p) => el.classList.contains(p))!;
const cardsIn = (grid: HTMLElement) =>
  [...grid.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains("card"));
export const cardOf = (grid: HTMLElement, p: Panel) => cardsIn(grid).find((c) => c.classList.contains(p));

export type Rects = Map<HTMLElement, DOMRect>;
export const measure = (grid: HTMLElement | null): Rects => new Map(grid ? cardsIn(grid).map((c) => [c, c.getBoundingClientRect()]) : []);

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Slide every card from where it was (`first`) to where it is now. */
function play(first: Rects) {
  if (reducedMotion()) return;
  for (const [el, f] of first) {
    const l = el.getBoundingClientRect();
    if (!l.width || !l.height || !f.width || !f.height) continue;
    const dx = f.left - l.left;
    const dy = f.top - l.top;
    const sx = f.width / l.width;
    const sy = f.height / l.height;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
    el.animate(
      [
        { transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: "top left", transform: "none" },
      ],
      { id: "flip", duration: 300, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  }
}

/**
 * FLIP: call `capture()` (or pass the rects measured while a card was being carried) right before
 * changing the layout; once React has moved the cards, each one animates from its old place.
 */
export function useFlip(gridRef: RefObject<HTMLElement | null>, key: string) {
  const first = useRef<Rects | null>(null);
  useLayoutEffect(() => {
    if (first.current) play(first.current);
    first.current = null;
  }, [key]);
  return {
    capture: (rects?: Rects) => (first.current = rects ?? measure(gridRef.current)),
    /** Nothing moves in the layout (a card dropped where it can't go): just slide back. */
    play,
  };
}

/** The card next to `el` in an arrow key's direction, nearest first, lined-up ones preferred. */
export function neighbor(grid: HTMLElement, el: HTMLElement, key: string): HTMLElement | undefined {
  const a = el.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | undefined;
  let bestD = Infinity;
  for (const c of cardsIn(grid)) {
    if (c === el) continue;
    const b = c.getBoundingClientRect();
    if (!b.width) continue;
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const ok =
      key === "ArrowLeft" ? b.right <= a.left + 1
      : key === "ArrowRight" ? b.left >= a.right - 1
      : key === "ArrowUp" ? b.bottom <= a.top + 1
      : key === "ArrowDown" && b.top >= a.bottom - 1;
    if (!ok) continue;
    const horizontal = key === "ArrowLeft" || key === "ArrowRight";
    const d = horizontal ? Math.abs(bx - ax) + 2 * Math.abs(by - ay) : Math.abs(by - ay) + 2 * Math.abs(bx - ax);
    if (d < bestD) (bestD = d), (best = c);
  }
  return best;
}

/**
 * While editing, a card follows the pointer (half see-through) and the card under it lights up;
 * letting go there swaps the two. Turning the screen or the layout changing cancels the drag
 * (`mode` changes, so this effect is torn down), as do Esc and a cancelled pointer.
 */
export function usePanelDrag(
  gridRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  mode: Mode,
  onDrop: (from: Panel, to: Panel, first: Rects) => void,
) {
  const latest = useRef(onDrop);
  latest.current = onDrop;

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || !enabled || mode === "phone") return;
    let drag: { el: HTMLElement; id: number; x: number; y: number; lifted: boolean; target: HTMLElement | null } | null = null;

    const clear = () => {
      if (!drag) return;
      drag.el.classList.remove("panel-lifted");
      drag.el.style.transform = "";
      drag.target?.classList.remove("panel-target");
      grid.classList.remove("panel-dragging");
      drag = null;
    };
    /** Put the carried card back, sliding from where it was let go. */
    const cancel = () => {
      if (!drag) return;
      const first = drag.lifted ? measure(grid) : null;
      clear();
      if (first) play(first);
    };
    const down = (e: PointerEvent) => {
      if (drag || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      const el = (e.target as Element).closest(".card");
      if (!(el instanceof HTMLElement) || el.parentElement !== grid) return;
      drag = { el, id: e.pointerId, x: e.clientX, y: e.clientY, lifted: false, target: null };
      try {
        el.setPointerCapture(e.pointerId); // keep getting moves when the pointer leaves the card
      } catch {}
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.lifted) {
        if (Math.hypot(dx, dy) < 5) return; // a tap (e.g. on the move button) isn't a drag
        drag.lifted = true;
        drag.el.classList.add("panel-lifted");
        grid.classList.add("panel-dragging");
        navigator.vibrate?.(10);
      }
      drag.el.style.transform = `translate(${dx}px, ${dy}px)`;
      const { el } = drag;
      const target =
        cardsIn(grid).find((c) => {
          if (c === el) return false;
          const b = c.getBoundingClientRect();
          return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
        }) ?? null;
      if (target !== drag.target) {
        drag.target?.classList.remove("panel-target");
        target?.classList.add("panel-target");
        drag.target = target;
      }
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.lifted) return void (drag = null);
      const first = measure(grid); // the carried card where it was let go
      const from = panelOf(drag.el);
      const to = drag.target && panelOf(drag.target);
      clear();
      if (to) latest.current(from, to, first);
      else play(first);
    };
    const pointerCancel = (e: PointerEvent) => drag && e.pointerId === drag.id && cancel();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag) {
        e.stopImmediatePropagation(); // Esc cancels the drag, not the whole edit mode
        cancel();
      }
    };
    const turned = () => cancel();

    grid.addEventListener("pointerdown", down);
    grid.addEventListener("pointermove", move);
    grid.addEventListener("pointerup", up);
    grid.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("keydown", key, true);
    screen.orientation?.addEventListener("change", turned);
    window.addEventListener("orientationchange", turned);
    return () => {
      clear();
      grid.removeEventListener("pointerdown", down);
      grid.removeEventListener("pointermove", move);
      grid.removeEventListener("pointerup", up);
      grid.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("keydown", key, true);
      screen.orientation?.removeEventListener("change", turned);
      window.removeEventListener("orientationchange", turned);
    };
  }, [gridRef, enabled, mode]);
}
