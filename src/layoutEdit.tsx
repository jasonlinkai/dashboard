// Rearranging the cards: which layout is showing, the edit mode's shared state, dragging a card
// (Pointer Events) onto another card, into free cells or by its corner to resize it, and the FLIP
// animation that plays when cards change places.

import { type CSSProperties, type RefObject, createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Boxes, type CardId, GRID, type LayoutMode, MIN_H, MIN_W, PANELS, type Panel, type Rect, TRANSIT, fits } from "./settings";

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
  /** Where the card is, in words (for its move button's label). */
  where: (p: CardId) => string;
  /** Take the card off the dashboard (it comes back from the edit bar); an extra card is removed. */
  hide: (p: CardId) => void;
  /** The card's place on the board: --wide / --tall grid areas (styles.css picks the layout's). */
  style: (p: CardId) => CSSProperties;
  /** Arrow key: move a cell (or swap with the card that way); Shift: resize it; Alt: move its right / bottom edge with the neighbours. */
  move: (p: CardId, key: string, how: "move" | "resize" | "line") => void;
}
export const LayoutEditContext = createContext<LayoutEdit>({
  editing: false,
  mode: "phone",
  where: () => "",
  hide: () => {},
  style: () => ({}),
  move: () => {},
});

/** CSS grid-area for a box. */
export const area = (r: Rect) => `${r.y + 1} / ${r.x + 1} / span ${r.h} / span ${r.w}`;
export const useLayoutEdit = () => useContext(LayoutEditContext);

/** A card element's id (Section sets data-card) and type (its class). */
const panelOf = (el: HTMLElement): CardId => el.dataset.card!;
const kindOf = (el: Element) => PANELS.find((p) => el.classList.contains(p))!;
const cardsIn = (grid: HTMLElement) =>
  [...grid.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains("card"));
export const cardOf = (grid: HTMLElement, p: CardId) => cardsIn(grid).find((c) => c.dataset.card === p);

/** Cards that can be picked up: all of them on a tablet or desktop; on a phone, bus and train (the transit tab). */
export const movable = (mode: Mode, p: Panel) => mode !== "phone" || (TRANSIT as readonly Panel[]).includes(p);

export type Rects = Map<HTMLElement, DOMRect>;
export const measure = (grid: HTMLElement | null): Rects => new Map(grid ? cardsIn(grid).map((c) => [c, c.getBoundingClientRect()]) : []);
const measureTabs = (nav: HTMLElement | null): Rects =>
  new Map(nav ? [...nav.querySelectorAll<HTMLElement>("[data-tab-id]:not(.tab-lifted)")].map((t) => [t, t.getBoundingClientRect()]) : []);

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
export function useFlip(gridRef: RefObject<HTMLElement | null>, key: string, tabs?: boolean) {
  const first = useRef<Rects | null>(null);
  useLayoutEffect(() => {
    if (first.current) play(first.current);
    first.current = null;
  }, [key]);
  return {
    capture: (rects?: Rects) => (first.current = rects ?? (tabs ? measureTabs : measure)(gridRef.current)),
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

/** The grid cell a point is in (or nearest to). */
function cellAt(grid: HTMLElement, x: number, y: number) {
  const g = grid.getBoundingClientRect();
  const st = getComputedStyle(grid);
  const gapX = parseFloat(st.columnGap) || 0;
  const gapY = parseFloat(st.rowGap) || 0;
  const stepX = (g.width + gapX) / GRID;
  const stepY = (g.height + gapY) / GRID;
  return { x: Math.floor((x - g.left) / stepX), y: Math.floor((y - g.top) / stepY), stepX, stepY };
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * The smallest each card can be and still show its content (px, with its title and the source
 * line the data licences require): markets one row of tiles, weather one place, bus two stops,
 * train its route chips and two trains, news its topic tabs and two headlines.
 */
const MIN_PX: Record<Panel, [w: number, h: number]> = {
  markets: [300, 170],
  weather: [300, 190],
  bus: [260, 170],
  train: [280, 210],
  news: [260, 230],
};
/** A card type's minimum in cells on this screen. */
export function minCells(grid: HTMLElement, p: Panel) {
  const { stepX, stepY } = cellAt(grid, 0, 0);
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
  const [w, h] = MIN_PX[p];
  return { w: Math.ceil((w + gap) / stepX), h: Math.ceil((h + gap) / stepY) };
}
/** Every shown card on the board, clear of the others and at least its type's minimum size on this screen. */
export function allFit(grid: HTMLElement, boxes: Boxes, hidden: readonly CardId[], typeOf: (id: CardId) => Panel) {
  return Object.keys(boxes).every((p) => {
    const m = minCells(grid, typeOf(p));
    return hidden.includes(p) || (fits(boxes, p, boxes[p], hidden) && boxes[p].w >= m.w && boxes[p].h >= m.h);
  });
}

export { findSpot } from "./settings";
// shortcut: the layout not on screen can't be measured, so a card coming back there only gets the
// board-wide minimum (it may be too small to read until that layout is adjusted); measure per size if it matters.
export const BOARD_MIN = { w: MIN_W, h: MIN_H };

/**
 * Drag the line along a card's right (x) or bottom (y) edge to `to`: the cards ending at that line
 * and the cards starting at it, as far as they touch along it, all follow, so neighbours resize
 * together. The caller checks the result with allFit.
 */
export function moveLine(boxes: Boxes, p: CardId, axis: "x" | "y", to: number, hidden: readonly CardId[]): Boxes {
  const [pos, size, cross, crossSize] = axis === "x" ? (["x", "w", "y", "h"] as const) : (["y", "h", "x", "w"] as const);
  const line = boxes[p][pos] + boxes[p][size];
  const before = new Set<CardId>([p]);
  const after = new Set<CardId>();
  const touches = (a: Rect, b: Rect) => a[cross] < b[cross] + b[crossSize] && b[cross] < a[cross] + a[crossSize];
  for (let grew = true; grew; ) {
    grew = false;
    for (const q of Object.keys(boxes)) {
      if (before.has(q) || after.has(q) || hidden.includes(q)) continue;
      const b = boxes[q];
      const side = b[pos] + b[size] === line ? before : b[pos] === line ? after : null;
      if (side && [...before, ...after].some((o) => touches(b, boxes[o]))) side.add(q), (grew = true);
    }
  }
  const d = to - line;
  const next = { ...boxes };
  for (const q of before) next[q] = { ...boxes[q], [size]: boxes[q][size] + d };
  for (const q of after) next[q] = { ...boxes[q], [pos]: boxes[q][pos] + d, [size]: boxes[q][size] - d };
  return next;
}

/**
 * While editing, a card follows the pointer (half see-through). Over another card, that card
 * lights up and letting go swaps the two; over free cells, an outline shows where it would land
 * (red if it would cover another card). On a tablet or desktop the corner handle resizes it.
 * Turning the screen or the layout changing cancels the drag (`mode` changes, so this effect is
 * torn down), as do Esc and a cancelled pointer.
 */
export function usePanelDrag(
  gridRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  mode: Mode,
  /** The boxes of the layout showing (null on a phone: swapping only). */
  boxes: Boxes | null,
  hidden: readonly CardId[],
  typeOf: (id: CardId) => Panel,
  onSwap: (from: CardId, to: CardId, first: Rects) => void,
  onBoxes: (next: Boxes, first: Rects) => void,
) {
  const latest = useRef({ boxes, hidden, typeOf, onSwap, onBoxes });
  latest.current = { boxes, hidden, typeOf, onSwap, onBoxes };

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || !enabled) return;
    let drag: {
      el: HTMLElement;
      id: number;
      x: number;
      y: number;
      lifted: boolean;
      target: HTMLElement | null;
      /** Resizing by the corner, or moving the line along its right / bottom edge, instead of moving it. */
      resize: "corner" | "x" | "y" | null;
      /** The board after letting go (null: nothing changes). */
      spot: Boxes | null;
    } | null = null;
    /** Show `next` while dragging: every card that moved takes its new place right away. */
    const show = (next: Boxes) => {
      for (const c of cardsIn(grid)) c.style.gridArea = next[panelOf(c)] === latest.current.boxes?.[panelOf(c)] ? "" : area(next[panelOf(c)]);
    };
    const preview = document.createElement("div");
    preview.className = "panel-preview";

    const clear = () => {
      if (!drag) return;
      drag.el.classList.remove("panel-lifted", "panel-resizing");
      drag.el.style.transform = "";
      for (const c of cardsIn(grid)) c.style.gridArea = "";
      drag.target?.classList.remove("panel-target");
      grid.classList.remove("panel-dragging");
      preview.remove();
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
      if (!(el instanceof HTMLElement) || el.parentElement !== grid || !movable(mode, kindOf(el))) return;
      const handle = latest.current.boxes && (e.target as Element).closest<HTMLElement>("[data-resize]");
      const resize = handle ? (handle.dataset.resize as "corner" | "x" | "y") : null;
      drag = { el, id: e.pointerId, x: e.clientX, y: e.clientY, lifted: false, target: null, resize, spot: null };
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
        drag.el.classList.add(drag.resize ? "panel-resizing" : "panel-lifted");
        grid.classList.add("panel-dragging");
        navigator.vibrate?.(10);
      }
      const { el } = drag;
      const { boxes, hidden, typeOf } = latest.current;
      const p = panelOf(el);
      if (drag.resize && boxes) {
        // The cards take their new sizes as it goes; a step that doesn't fit is skipped.
        const r = boxes[p];
        const c = cellAt(grid, e.clientX, e.clientY);
        const next =
          drag.resize === "corner"
            ? { ...boxes, [p]: { ...r, w: clamp(c.x - r.x + 1, 1, GRID - r.x), h: clamp(c.y - r.y + 1, 1, GRID - r.y) } }
            : moveLine(boxes, p, drag.resize, Math.round((drag.resize === "x" ? e.clientX - grid.getBoundingClientRect().left : e.clientY - grid.getBoundingClientRect().top) / (drag.resize === "x" ? c.stepX : c.stepY)), hidden);
        if (allFit(grid, next, hidden, typeOf)) {
          drag.spot = next;
          show(next);
        }
        return;
      }
      drag.el.style.transform = `translate(${dx}px, ${dy}px)`;
      const target =
        cardsIn(grid).find((c) => {
          if (c === el || !movable(mode, kindOf(c))) return false;
          const b = c.getBoundingClientRect();
          return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
        }) ?? null;
      if (target !== drag.target) {
        drag.target?.classList.remove("panel-target");
        target?.classList.add("panel-target");
        drag.target = target;
      }
      // Not over a card: the free cells under the card's top left corner, same size.
      if (!boxes) return;
      drag.spot = null;
      preview.remove();
      if (target) return;
      const r = boxes[p];
      const start = el.getBoundingClientRect(); // includes the transform: where it is now
      const c = cellAt(grid, start.left, start.top);
      const spot = {
        ...r,
        x: clamp(Math.round((start.left - grid.getBoundingClientRect().left) / c.stepX), 0, GRID - r.w),
        y: clamp(Math.round((start.top - grid.getBoundingClientRect().top) / c.stepY), 0, GRID - r.h),
      };
      if (spot.x === r.x && spot.y === r.y) return;
      const ok = fits(boxes, p, spot, hidden);
      preview.classList.toggle("invalid", !ok);
      preview.style.gridArea = area(spot);
      grid.append(preview);
      if (ok) drag.spot = { ...boxes, [p]: spot };
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.lifted) return void (drag = null);
      const first = measure(grid); // the carried card where it was let go
      const from = panelOf(drag.el);
      const to = drag.target && panelOf(drag.target);
      const { spot } = drag;
      clear();
      if (to) latest.current.onSwap(from, to, first);
      else if (spot) latest.current.onBoxes(spot, first);
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
    const portrait = matchMedia("(orientation: portrait)");
    portrait.addEventListener("change", turned);
    screen.orientation?.addEventListener("change", turned);
    return () => {
      clear();
      grid.removeEventListener("pointerdown", down);
      grid.removeEventListener("pointermove", move);
      grid.removeEventListener("pointerup", up);
      grid.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("keydown", key, true);
      portrait.removeEventListener("change", turned);
      screen.orientation?.removeEventListener("change", turned);
    };
  }, [gridRef, enabled, mode]);
}

/**
 * Phone edit mode: drag a bottom tab sideways to reorder. The tabs make way as it passes over them
 * (`onMove` reorders right away); the carried tab stays under the finger.
 */
export function useTabDrag(
  navRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  onMove: (from: number, to: number) => void,
) {
  const latest = useRef(onMove);
  latest.current = onMove;

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !enabled) return;
    const tabs = () => [...nav.querySelectorAll<HTMLElement>("[data-tab-id]")];
    let drag: { el: HTMLElement; id: number; x: number; grab: number; lifted: boolean } | null = null;
    let swallowClick = false;

    /** Keep the carried tab under the finger, wherever its place in the row is now. */
    const follow = (x: number) => {
      if (!drag) return;
      drag.el.style.transform = "";
      const slot = drag.el.getBoundingClientRect();
      drag.el.style.transform = `translateX(${x - drag.grab - slot.left}px)`;
    };
    const end = (slideBack: boolean) => {
      if (!drag) return;
      const { el, lifted } = drag;
      const first: Rects | null = lifted && slideBack ? new Map([[el, el.getBoundingClientRect()]]) : null;
      el.classList.remove("tab-lifted");
      el.style.transform = "";
      nav.classList.remove("tab-dragging");
      drag = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      if (lifted) {
        swallowClick = true; // the click that follows letting go mustn't switch tabs
        setTimeout(() => (swallowClick = false), 400);
      }
      if (first) play(first); // from where it was let go into its place
    };
    const down = (e: PointerEvent) => {
      if (drag || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      const el = (e.target as Element).closest<HTMLElement>("[data-tab-id]");
      if (!el) return;
      const box = el.getBoundingClientRect();
      drag = { el, id: e.pointerId, x: e.clientX, grab: e.clientX - box.left, lifted: false };
      // On window: React moves the tab within the row as it goes, which drops pointer capture.
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.lifted) {
        if (Math.abs(e.clientX - drag.x) < 6) return;
        drag.lifted = true;
        drag.el.classList.add("tab-lifted");
        nav.classList.add("tab-dragging");
        navigator.vibrate?.(10);
      }
      const list = tabs();
      const from = list.indexOf(drag.el);
      const to = list.findIndex((t) => {
        if (t === drag!.el) return false;
        const b = t.getBoundingClientRect();
        return e.clientX >= b.left && e.clientX <= b.right;
      });
      if (from >= 0 && to >= 0) latest.current(from, to);
      const x = e.clientX;
      follow(x);
      requestAnimationFrame(() => follow(x)); // again once React has moved it
    };
    const up = (e: PointerEvent) => drag && e.pointerId === drag.id && end(true);
    const cancel = (e: PointerEvent) => drag && e.pointerId === drag.id && end(true);
    const click = (e: MouseEvent) => {
      if (!swallowClick) return;
      e.preventDefault();
      e.stopPropagation();
      swallowClick = false;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag) {
        e.stopImmediatePropagation();
        end(true);
      }
    };
    const turned = () => end(true);

    nav.addEventListener("pointerdown", down);
    nav.addEventListener("click", click, true);
    window.addEventListener("keydown", key, true);
    const portrait = matchMedia("(orientation: portrait)");
    portrait.addEventListener("change", turned);
    screen.orientation?.addEventListener("change", turned);
    return () => {
      end(false);
      nav.removeEventListener("pointerdown", down);
      nav.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
      portrait.removeEventListener("change", turned);
      screen.orientation?.removeEventListener("change", turned);
    };
  }, [navRef, enabled]);
}
