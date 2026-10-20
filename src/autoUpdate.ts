// The board is often left open for days: when a new version is deployed, reload into it.
// Checks every 5 minutes by comparing the script the live index.html points to with ours, and
// waits until no dialog is open (so nothing being edited is lost).

const CHECK_MS = 5 * 60_000;

const scriptOf = (html: string) => html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;

export function startAutoUpdate() {
  const mine = [...document.scripts].map((s) => s.src.match(/\/assets\/index-[\w-]+\.js/)?.[0]).find(Boolean);
  if (!mine) return; // dev server: nothing to compare
  let pending = false;
  const tryReload = () => {
    if (document.querySelector(".modal-backdrop")) return; // settings / info open: try again later
    location.reload();
  };
  const check = async () => {
    if (pending) return tryReload();
    if (document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/", { cache: "no-store" });
      const live = scriptOf(await res.text());
      if (live && live !== mine) {
        pending = true;
        tryReload();
      }
    } catch {}
  };
  setInterval(check, CHECK_MS);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
}
