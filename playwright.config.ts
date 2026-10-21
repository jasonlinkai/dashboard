import { defineConfig } from "@playwright/test";

// End-to-end tests of the layout system (e2e/). `npm run test:e2e`; a running `vite --port 5199` is reused.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  use: { baseURL: "http://localhost:5199", locale: "zh-TW", timezoneId: "Asia/Taipei" },
  webServer: { command: "npx vite --port 5199 --strictPort", url: "http://localhost:5199", reuseExistingServer: true, timeout: 60_000 },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
