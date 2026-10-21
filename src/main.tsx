import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./settings";
import { startAutoUpdate } from "./autoUpdate";
import { startScrollCues } from "./scrollCues";
import { Toaster } from "./toast";
import { startViewportFix } from "./viewportFix";
import "./styles.css";

startViewportFix();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
      <Toaster />
    </SettingsProvider>
  </StrictMode>,
);

startScrollCues();
startAutoUpdate();
