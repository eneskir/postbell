import "./fonts.css";
import "./tokens.gen.css";
import "./layout.css";
import "./styles.css";
import "./shell.css";
import "./components.css";
import "./today.css";
import "./share-panel.css";
import "./accounts.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { App } from "./App.tsx";
import { tauriPort } from "./port/tauri.ts";

const inTauri = "__TAURI_INTERNALS__" in window;
const setup = inTauri ? getCurrentWindow().label === "setup" : new URLSearchParams(location.search).has("setup");

async function app(): Promise<ReactNode> {
  if (setup) {
    const { SetupApp } = await import("./setup-app.tsx");
    const port = inTauri ? (await import("./port/setup-tauri.ts")).setupTauriPort : (await import("./port/setup-fake.ts")).setupFakePort;
    return <SetupApp port={port} />;
  }
  const port = inTauri ? tauriPort : (await import("./port/fake.ts")).fakePort;
  return <App port={port} />;
}

const root = document.getElementById("root");
if (!root) throw new Error("UI_ROOT_MISSING");

createRoot(root).render(<StrictMode>{await app()}</StrictMode>);
