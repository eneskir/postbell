import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { parseProgress, parseSetupError, parseSetupInfo, type SetupPort, type SetupResult } from "../../core/setup.ts";
import { subscribe } from "./listen.ts";

async function call(cmd: string, args?: Record<string, unknown>): Promise<SetupResult> {
  try {
    await invoke(cmd, args);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: parseSetupError(e) };
  }
}

export const setupTauriPort: SetupPort = {
  async state() {
    try {
      return parseSetupInfo(await invoke<unknown>("setup_state"));
    } catch {
      return null;
    }
  },
  install: (desktop) => call("setup_install", { desktop }),
  uninstall: (removeData) => call("setup_uninstall", { removeData }),
  forceCloseApp: () => call("setup_close_app"),
  openApp: () => call("setup_open_app"),
  onProgress: (f) =>
    subscribe("setup-progress", (payload) => {
      const p = parseProgress(payload);
      if (p) f(p);
    }),
  ready: (rendered) => invoke("ready", { rendered }),
  close: () => getCurrentWindow().close(),
};
