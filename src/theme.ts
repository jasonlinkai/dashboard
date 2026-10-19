import { useEffect, useState } from "react";

export type ThemePref = "auto" | "light" | "dark";

// Must match the inline script in index.html, which applies the theme before first paint.
const KEY = "theme";
const BAR = { light: "#f2f4f7", dark: "#0d1117" };

function load(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "auto";
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
  // Keep the browser / status bar colour in step with a forced theme.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = meta.media.includes("light") ? BAR.light : BAR.dark;
    meta.content = pref === "auto" ? own : BAR[pref];
  }
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(load);
  useEffect(() => {
    apply(pref);
    try {
      if (pref === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {}
  }, [pref]);
  return [pref, setPref] as const;
}
