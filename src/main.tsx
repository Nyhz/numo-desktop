import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { boot, getApp } from "./data/store.ts";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void boot().then(async () => {
  // Prueba de humo automática (solo con NUMO_SMOKE=1): no se ejecuta en uso normal.
  if (getApp().info?.smoke) (await import("./data/smoke.ts")).runSmoke();
});
