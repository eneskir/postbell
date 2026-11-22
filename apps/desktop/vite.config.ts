import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Third-party notices ship as a frontend asset: Tauri embeds assets in the exe, and setup mode writes the file to the
// install folder.
const notices: Plugin = {
  name: "postbell-notices",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "THIRD_PARTY_NOTICES.md", source: readFileSync(new URL("./THIRD_PARTY_NOTICES.md", import.meta.url), "utf8") });
  },
};

// Tauri dev mode expects this fixed port (tauri.conf.json, devUrl).
// The fake shell reads sample packages from the repo's `contracts/fixtures`, so the dev server allows that folder too.
export default defineConfig({
  plugins: [react(), notices],
  clearScreen: false,
  server: { port: 5173, strictPort: true, fs: { allow: [".", "../../contracts/fixtures"] } },
  build: { target: "es2022", sourcemap: false },
});
