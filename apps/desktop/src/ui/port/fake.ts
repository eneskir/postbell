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
// `?ac=hata`: Explorer and the browser fail to open.
const openScenario = () => new URLSearchParams(location.search).get("ac");
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
      // `?paket=`: yok (folder missing), okunamaz (unreadable), bos (empty), gelecek (future days only), dosyasiz (manifests only), bekle (never resolves), karisik (only Globex missing).
      const scenario = new URLSearchParams(location.search).get("paket");
      if (scenario === "bekle") return new Promise(() => undefined);
      if (scenario === "karisik" && folder === "fixtures/globex") return { ok: false, error: { code: "folder-missing", detail: `folder missing: ${folder}` } };
      if (scenario === "dosyasiz") {
        const own = (p: PackageDir, f: string) => `${fixturePath(folder)}${p.dir}/${f}`;
        return { ok: true, value: packagesOf(folder).map((p) => ({ ...p, files: p.files.filter((f) => f.path === "manifest.json" || restored.has(own(p, f.path))) })) };
      }
      if (scenario === "yok") return { ok: false, error: { code: "folder-missing", detail: `folder missing: ${folder}` } };
      if (scenario === "okunamaz") return { ok: false, error: { code: "folder-read", detail: "Access is denied. (os error 5)" } };
      if (scenario === "bos") return { ok: true, value: [] };
      if (scenario === "gelecek") return { ok: true, value: packagesOf(folder).filter((p) => p.dir.slice(0, 10) > dateOf(localNow())) };
      return { ok: true, value: packagesOf(folder) };
    },
  },
  files: {
    url: (folder, path) => fileUrls[`${fixturePath(folder)}${path}`] ?? "",
    async reveal(folder, path) {
      if (openScenario() === "hata") return { ok: false, error: { code: "open-failed", detail: "sahte kabuk: ?ac=hata" } };
      if (!(`${fixturePath(folder)}${path}` in fileUrls)) return { ok: false, error: { code: "file-missing", detail: path } };
      return { ok: true, value: undefined };
    },
    // `?ac=`: iptal (cancel), tur (wrong file type), hata (write fails).
    async restore(folder, path) {
      const key = `${fixturePath(folder)}${path}`;
      const scenario = openScenario();
      if (scenario === "iptal") return { ok: true, value: "cancelled" };
      if (scenario === "tur") return { ok: false, error: { code: "file-type", detail: path.slice(path.lastIndexOf(".")) } };
      if (scenario === "hata") return { ok: false, error: { code: "file-write", detail: "sahte kabuk: ?ac=hata" } };
      if (restored.has(key) || new URLSearchParams(location.search).get("paket") !== "dosyasiz") return { ok: true, value: "present" };
      restored.add(key);
      return { ok: true, value: "copied" };
    },
  },
  // The last request is kept in `window.postbellOpened`. `?ac=`: hata (open fails), uzun (text too long for the URL).
  links: {
    async openSharePage(platform, text) {
      (window as { postbellOpened?: { platform: string; text: string } }).postbellOpened = { platform, text };
      if (openScenario() === "hata") return { ok: false, error: { code: "open-failed", detail: "sahte kabuk: ?ac=hata" } };
      return { ok: true, value: openScenario() === "uzun" ? "text-dropped" : "opened" };
    },
  },
  // `?klasor=`: iptal (cancel), hata (dialog fails).
  dialogs: {
    async pickFolder() {
      const scenario = new URLSearchParams(location.search).get("klasor");
      if (scenario === "iptal") return { ok: true, value: null };
      if (scenario === "hata") return { ok: false, error: { code: "dialog-failed", detail: "sahte kabukta denendi" } };
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
    // `?kayit=`: yok (first run), bozuk (corrupt), yeni (newer version), bekle (never resolves), gruplar (extra closed empty group), bitenler (done and skipped records).
    async load() {
      const scenario = new URLSearchParams(location.search).get("kayit");
      if (scenario === "bekle") return new Promise(() => undefined);
      if (scenario === "yok") store = emptyStore();
      if (scenario === "gruplar" && !store.groups.some((g) => g.id === "musteri-b"))
        store = { ...store, groups: [...store.groups, { id: "musteri-b", name: "Müşteri B", open: false, brands: [] }] };
      if (scenario === "bitenler" && store.records.length === 0) {
        const day = parseDate("2026-11-12") as LocalDate;
        const id = (p: string) => `initech/initech-2026-11-12-hidden-dog/${p}` as ShareId;
        store = withRecord(store, { share: id("instagram-reels"), status: "done", at: at(day, T("09:05")) });
        store = withRecord(store, { share: id("tiktok"), status: "skipped", at: at(day, T("10:00")) });
      }
      const text = scenario === "yok" ? null : scenario === "bozuk" ? "{bozuk" : scenario === "yeni" ? '{"version": 2}' : serializeStore(store);
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
