import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// Shown in 設定 → 關於: build date (Taipei) and commit, e.g. "2026.10.21（87c47f3）". Cloudflare's
// build checks out the repo; WORKERS_CI_COMMIT_SHA covers a build without git.
const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 7) ?? "dev";
  }
})();
const built = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date()).replaceAll("-", ".");

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: { host: true }, // reachable from iPad / phone on the same Wi-Fi during development
  define: { __APP_VERSION__: JSON.stringify(`${built}（${commit}）`) },
});
