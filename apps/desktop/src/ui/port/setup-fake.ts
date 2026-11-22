import type { Progress, SetupInfo, SetupPort, SetupResult } from "../../core/setup.ts";

// `?setup=setup|uninstall`; `installed=none|older|same|newer` installed version; `error=<CODE>` fails with that code; `wait` stops halfway.
const VERSION = "0.1.1";
const INSTALLED = { older: "0.1.0", same: "0.1.1", newer: "0.2.0" } as const;
const params = () => new URLSearchParams(location.search);
const listeners = new Set<(p: Progress) => void>();
let forced = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function work(total: number): Promise<SetupResult> {
  const q = params();
  for (let done = 1; done <= total; done++) {
    if (q.has("wait") && done > total / 2) return new Promise(() => undefined);
    await sleep(120);
    listeners.forEach((f) => f({ done, total }));
  }
  const code = q.get("error");
  if (code && !(code === "SETUP_APP_RUNNING" && forced)) return { ok: false, error: { code, detail: "fake shell" } };
  return { ok: true };
}

export const setupFakePort: SetupPort = {
  async state() {
    const q = params();
    const mode = q.get("setup") === "uninstall" ? "uninstall" : "setup";
    const kind = q.get("installed");
    const installed: SetupInfo["installed"] = kind === "older" || kind === "same" || kind === "newer" ? { kind, version: INSTALLED[kind] } : { kind: "none" };
    return { mode, version: VERSION, installed };
  },
  install: (desktop) => work(desktop ? 7 : 6),
  uninstall: (removeData) => work(removeData ? 7 : 6),
  async forceCloseApp() {
    forced = true;
    return { ok: true };
  },
  async openApp() {
    return params().get("open") === "error" ? { ok: false, error: { code: "SETUP_OPEN_FAILED", detail: "fake shell" } } : { ok: true };
  },
  onProgress(f) {
    listeners.add(f);
    return () => listeners.delete(f);
  },
  async ready() {},
  async close() {
    document.body.dataset.closed = "1";
  },
};
