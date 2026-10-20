import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./settings";
import { startScrollCues } from "./scrollCues";
import { Toaster } from "./toast";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
      <Toaster />
    </SettingsProvider>
  </StrictMode>,
);

startScrollCues();
