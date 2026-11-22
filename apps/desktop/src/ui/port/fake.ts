import { parseAppInfo } from "../../core/app-info.ts";
import type { Language } from "../../core/manifest.ts";
import type { PackageDir } from "../../core/packages.ts";
import { parseAlarmTarget, type AlarmPlan, type Port, type TrayTexts } from "../../core/port.ts";
import type { Account, AccountId, BrandId, Network, ShareId, Times } from "../../core/shares.ts";
import { emptyStore, serializeStore, withRecord, type StoreFile } from "../../core/store.ts";
import { at, dateOf, parseDate, parseTime, type LocalDate, type TimeOfDay } from "../../core/time.ts";
import { localNow } from "../clock.ts";

const ROOT = "../../../../../contracts/fixtures/";
const manifests = import.meta.glob<string>("../../../../../contracts/fixtures/**/manifest.json", { query: "?raw", import: "default", eager: true });
const fileUrls = import.meta.glob<string>("../../../../../contracts/fixtures/**/*", { query: "?url", import: "default", eager: true });
const fileTexts = import.meta.glob<string>("../../../../../contracts/fixtures/**/*", { query: "?raw", import: "default", eager: true });
const files = Object.keys(fileUrls);
const fixturePath = (folder: string) => `${ROOT}${folder.replace(/^fixtures\//, "")}/`;
// `?open=error`: Explorer and the browser fail to open.
const openScenario = () => new URLSearchParams(location.search).get("open");
const restored = new Set<string>();

function packagesOf(brandFolder: string): PackageDir[] {
  const prefix = fixturePath(brandFolder);
  return Object.entries(manifests)
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, text]) => {
      const dir = path.slice(prefix.length, -"/manifest.json".length);
      const own = `${prefix}${dir}/`;
      return { dir, manifest: text, files: files.filter((f) => f.startsWith(own)).map((f) => ({ path: f.slice(own.length), size: fileTexts[f]?.length ?? 0 })) };
    });
}

const fixtureFolders = [...new Set(Object.keys(manifests).map((p) => `fixtures/${p.slice(ROOT.length).split("/")[0]}`))];

const T = (s: string) => parseTime(s) as TimeOfDay;
const account = (network: Network, times: Times, language: Language = "en"): Account => ({
  id: `initech-${network}${language === "en" ? "" : `-${language}`}` as AccountId,
  brand: "initech" as BrandId,
  network,
  handle: language === "en" ? "@initech" : `@initech.${language}`,
  language,
  times,
});
let store: StoreFile = {
  ...emptyStore(),
  brands: [
    { id: "initech" as BrandId, name: "Initech", sticker: "camera", folder: "fixtures/initech" },
    { id: "globex" as BrandId, name: "Globex", sticker: "night", folder: "fixtures/globex" },
  ],
  groups: [{ id: "musteri-a", name: "Müşteri A", open: true, brands: ["globex" as BrandId] }],
  accounts: [
    account("x", { x: T("09:00") }),
    account("instagram", { "instagram-reels": T("14:15") }),
    account("instagram", { "instagram-reels": T("14:45") }, "tr"),
    account("tiktok", { tiktok: T("18:30") }),
    account("youtube", { "youtube-shorts": T("19:00") }),
    account("pinterest", { pinterest: T("20:00") }),
  ],
};

export const fakePort: Port = {
  async appInfo() {
    return parseAppInfo({ name: "Postbell", version: "0.0.0-fake" });
  },
  async ready() {},
  async selfTest() {
    return { active: false, addRecord: false };
  },
  packages: {
    async read(folder) {
      if (!store.brands.some((b) => b.folder === folder)) return { ok: false, error: { code: "folder-not-registered", detail: folder } };
      // `?packages=`: missing (folder missing), unreadable, empty, future (future days only), no-files (manifests only), wait (never resolves), mixed (only Globex missing).
      const scenario = new URLSearchParams(location.search).get("packages");
      if (scenario === "wait") return new Promise(() => undefined);
      if (scenario === "mixed" && folder === "fixtures/globex") return { ok: false, error: { code: "folder-missing", detail: `folder missing: ${folder}` } };
      if (scenario === "no-files") {
        const own = (p: PackageDir, f: string) => `${fixturePath(folder)}${p.dir}/${f}`;
        return { ok: true, value: packagesOf(folder).map((p) => ({ ...p, files: p.files.filter((f) => f.path === "manifest.json" || restored.has(own(p, f.path))) })) };
      }
      if (scenario === "missing") return { ok: false, error: { code: "folder-missing", detail: `folder missing: ${folder}` } };
      if (scenario === "unreadable") return { ok: false, error: { code: "folder-read", detail: "Access is denied. (os error 5)" } };
      if (scenario === "empty") return { ok: true, value: [] };
      if (scenario === "future") return { ok: true, value: packagesOf(folder).filter((p) => p.dir.slice(0, 10) > dateOf(localNow())) };
      return { ok: true, value: packagesOf(folder) };
    },
  },
  files: {
    url: (folder, path) => fileUrls[`${fixturePath(folder)}${path}`] ?? "",
    async reveal(folder, path) {
      if (openScenario() === "error") return { ok: false, error: { code: "open-failed", detail: "fake shell: ?open=error" } };
      if (!(`${fixturePath(folder)}${path}` in fileUrls)) return { ok: false, error: { code: "file-missing", detail: path } };
      return { ok: true, value: undefined };
    },
    // `?open=`: cancel, type (wrong file type), error (write fails).
    async restore(folder, path) {
      const key = `${fixturePath(folder)}${path}`;
      const scenario = openScenario();
      if (scenario === "cancel") return { ok: true, value: "cancelled" };
      if (scenario === "type") return { ok: false, error: { code: "file-type", detail: path.slice(path.lastIndexOf(".")) } };
      if (scenario === "error") return { ok: false, error: { code: "file-write", detail: "fake shell: ?open=error" } };
      if (restored.has(key) || new URLSearchParams(location.search).get("packages") !== "no-files") return { ok: true, value: "present" };
      restored.add(key);
      return { ok: true, value: "copied" };
    },
  },
  // The last request is kept in `window.postbellOpened`. `?open=`: error (open fails), long (text too long for the URL).
  links: {
    async openSharePage(platform, text) {
      (window as { postbellOpened?: { platform: string; text: string } }).postbellOpened = { platform, text };
      if (openScenario() === "error") return { ok: false, error: { code: "open-failed", detail: "fake shell: ?open=error" } };
      return { ok: true, value: openScenario() === "long" ? "text-dropped" : "opened" };
    },
  },
  // `?folder=`: cancel, error (dialog fails).
  dialogs: {
    async pickFolder() {
      const scenario = new URLSearchParams(location.search).get("folder");
      if (scenario === "cancel") return { ok: true, value: null };
      if (scenario === "error") return { ok: false, error: { code: "dialog-failed", detail: "fake shell: ?folder=error" } };
      return { ok: true, value: fixtureFolders.find((f) => !store.brands.some((b) => b.folder === f)) ?? "fixtures/bos-klasor" };
    },
  },
  window: {
    async minimize() {},
    async toggleMaximize() {},
    async close() {},
  },
  // The last plan is kept in `window.postbellAlarms`; dispatch a `postbell-alarm-open` CustomEvent to simulate a click (`detail: null` is the grouped one).
  alarms: {
    async set(plan) {
      (window as { postbellAlarms?: AlarmPlan }).postbellAlarms = plan;
      return { ok: true, value: undefined };
    },
    onOpen(open) {
      const on = (e: Event) => open(parseAlarmTarget((e as CustomEvent<unknown>).detail));
      window.addEventListener("postbell-alarm-open", on);
      return () => window.removeEventListener("postbell-alarm-open", on);
    },
  },
  // The last texts are kept in `window.postbellTray`.
  tray: {
    async set(texts) {
      (window as { postbellTray?: TrayTexts }).postbellTray = texts;
      return { ok: true, value: undefined };
    },
  },
  store: {
    // `?store=`: missing (first run), corrupt, newer (newer version), wait (never resolves), groups (extra closed empty group), finished (done and skipped records).
    async load() {
      const scenario = new URLSearchParams(location.search).get("store");
      if (scenario === "wait") return new Promise(() => undefined);
      if (scenario === "missing") store = emptyStore();
      if (scenario === "groups" && !store.groups.some((g) => g.id === "musteri-b"))
        store = { ...store, groups: [...store.groups, { id: "musteri-b", name: "Müşteri B", open: false, brands: [] }] };
      if (scenario === "finished" && store.records.length === 0) {
        const day = parseDate("2026-11-12") as LocalDate;
        const id = (p: string) => `initech/initech-2026-11-12-hidden-dog/${p}` as ShareId;
        store = withRecord(store, { share: id("instagram-reels"), status: "done", at: at(day, T("09:05")) });
        store = withRecord(store, { share: id("tiktok"), status: "skipped", at: at(day, T("10:00")) });
      }
      const text = scenario === "missing" ? null : scenario === "corrupt" ? "{bozuk" : scenario === "newer" ? '{"version": 2}' : serializeStore(store);
      return { ok: true, value: { path: "bellek (sahte kabuk)", text } };
    },
    async save(next) {
      store = next;
      return { ok: true, value: undefined };
    },
    async backup() {
      return { ok: false, error: { code: "store-backup", detail: "no files in the fake shell" } };
    },
  },
};
