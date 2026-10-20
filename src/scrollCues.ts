// A small, quiet arrow on every area whose content doesn't fit, so people remember it scrolls.
// It points to where the rest is (down / right) and disappears at the end. Drawn as ::after on the
// area's parent, positioned from CSS variables set here. It only changes once scrolling has
// stopped: restyling things mid-scroll can cut iOS momentum scrolling short.

const AREAS = ".scroll, .wx-grid, .tiles, .route-tabs";
const EDGE = 4;

function scrollsX(el: HTMLElement) {
  const o = getComputedStyle(el).overflowX;
  return o === "auto" || o === "scroll";
}

function update(el: HTMLElement) {
  const p = el.parentElement;
  if (!p) return;
  if (!el.offsetParent || el.clientHeight === 0) {
    delete p.dataset.cue; // hidden (e.g. another tab on a phone)
    return;
  }
  const down = el.scrollTop + el.clientHeight < el.scrollHeight - EDGE;
  const right = scrollsX(el) && el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE;
  const dir = down ? "down" : right ? "right" : "";
  if (!dir) {
    delete p.dataset.cue;
    return;
  }
  if (getComputedStyle(p).position === "static") p.style.position = "relative";
  // Place it inside the scrolling area, at the edge the arrow points to.
  const x0 = el.offsetLeft;
  const y0 = el.offsetTop;
  const [x, y] = dir === "down" ? [x0 + el.offsetWidth / 2, y0 + el.offsetHeight - 14] : [x0 + el.offsetWidth - 14, y0 + el.offsetHeight / 2];
  p.style.setProperty("--cue-x", `${Math.round(x)}px`);
  p.style.setProperty("--cue-y", `${Math.round(y)}px`);
  p.dataset.cue = dir;
}

export function startScrollCues() {
  const watched = new WeakSet<Element>();
  const resize = new ResizeObserver((entries) => entries.forEach((e) => update(e.target as HTMLElement)));
  let queued = false;
  const scan = () => {
    queued = false;
    for (const el of document.querySelectorAll<HTMLElement>(AREAS)) {
      if (!watched.has(el)) {
        watched.add(el);
        resize.observe(el);
      }
      update(el);
    }
  };
  const later = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  };
  // Wait until the area has stopped scrolling (no scroll event for a moment) before updating.
  const idle = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
  document.addEventListener(
    "scroll",
    (e) => {
      const el = e.target as HTMLElement;
      if (!(el instanceof HTMLElement) || !el.matches(AREAS)) return;
      clearTimeout(idle.get(el));
      idle.set(el, setTimeout(() => update(el), 250));
    },
    { capture: true, passive: true },
  );
  new MutationObserver(later).observe(document.body, { subtree: true, childList: true });
  addEventListener("resize", later);
  later();
}
