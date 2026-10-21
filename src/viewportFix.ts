// iOS home-screen web apps with a translucent status bar can report a viewport one status bar
// shorter than the screen (100%, 100dvh and innerHeight all come up short), leaving an unpainted
// strip under the tab bar. When that's the case, size the page to the screen ourselves through
// --app-h; everywhere else the variable stays unset and the CSS fallbacks apply.

export function startViewportFix() {
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (!standalone) return;
  const root = document.documentElement;
  const fit = () => {
    // iOS reports the screen in portrait whichever way the phone is held.
    const long = Math.max(screen.width, screen.height);
    const short = Math.min(screen.width, screen.height);
    const full = innerHeight > innerWidth ? long : short;
    const missing = full - innerHeight;
    // Only the status bar's worth (about 20–60 px); anything else is a real layout we leave alone.
    if (missing > 0 && missing <= 80) root.style.setProperty("--app-h", `${full}px`);
    else root.style.removeProperty("--app-h");
  };
  fit();
  addEventListener("resize", fit);
  addEventListener("orientationchange", () => setTimeout(fit, 300));
}
