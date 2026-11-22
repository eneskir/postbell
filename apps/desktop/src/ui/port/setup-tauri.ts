import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { parseProgress, parseSetupError, parseSetupInfo, type SetupPort, type SetupResult } from "../../core/setup.ts";

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
  // Tauri's listen() resolves later; an unsubscribe that comes first runs once it does.
  onProgress(f) {
    let stop: (() => void) | null = null;
    let done = false;
    void listen<unknown>("setup-progress", (e) => {
      const p = parseProgress(e.payload);
      if (p) f(p);
    }).then((unlisten) => {
      if (done) unlisten();
      else stop = unlisten;
    });
    return () => {
      done = true;
      stop?.();
    };
  },
  ready: (rendered) => invoke("ready", { rendered }),
  close: () => getCurrentWindow().close(),
};
