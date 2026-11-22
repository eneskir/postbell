import type { Progress, SetupInfo, SetupPort, SetupResult } from "../../core/setup.ts";

// `?kurulum=setup|uninstall`; `durum=none|older|same|newer` installed version; `hata=<CODE>` fails with that code; `bekle` stops halfway.
const VERSION = "0.1.1";
const INSTALLED = { older: "0.1.0", same: "0.1.1", newer: "0.2.0" } as const;
const params = () => new URLSearchParams(location.search);
const listeners = new Set<(p: Progress) => void>();
let forced = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function work(total: number): Promise<SetupResult> {
  const q = params();
  for (let done = 1; done <= total; done++) {
    if (q.has("bekle") && done > total / 2) return new Promise(() => undefined);
    await sleep(120);
    listeners.forEach((f) => f({ done, total }));
  }
  const code = q.get("hata");
  if (code && !(code === "SETUP_APP_RUNNING" && forced)) return { ok: false, error: { code, detail: "sahte kabuk" } };
  return { ok: true };
}

export const setupFakePort: SetupPort = {
  async state() {
    const q = params();
    const mode = q.get("kurulum") === "uninstall" ? "uninstall" : "setup";
    const durum = q.get("durum");
    const installed: SetupInfo["installed"] = durum === "older" || durum === "same" || durum === "newer" ? { kind: durum, version: INSTALLED[durum] } : { kind: "none" };
    return { mode, version: VERSION, installed };
  },
  install: (desktop) => work(desktop ? 7 : 6),
  uninstall: (removeData) => work(removeData ? 7 : 6),
  async closeApp() {
    forced = true;
    return { ok: true };
  },
  async openApp() {
    return params().get("ac") === "hata" ? { ok: false, error: { code: "SETUP_OPEN_FAILED", detail: "sahte kabuk" } } : { ok: true };
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
