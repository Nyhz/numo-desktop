import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Tauri carga la interfaz desde este servidor en desarrollo (puerto fijo)
// y desde dist/ en la app empaquetada.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 4400, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { outDir: "dist", target: "safari15", chunkSizeWarningLimit: 900 },
  test: { include: ["shared/**/*.test.ts", "src/**/*.test.ts"], environment: "node" },
});
