import { parseAppInfo } from "../../core/app-info.ts";
import { passphraseLongEnough } from "../../core/backup.ts";
import type { Language } from "../../core/manifest.ts";
import type { PackageDir } from "../../core/packages.ts";
import { parseAlarmTarget, type AlarmPlan, type Port, type TrayTexts } from "../../core/port.ts";
import type { Account, AccountDetails, AccountId, BrandId, Network, ShareId, Times } from "../../core/shares.ts";
import { emptyStore, serializeStore, withRecord, type StoreFile } from "../../core/store.ts";
import { at, DAY, dateOf, parseDate, parseTime, type LocalDate, type TimeOfDay } from "../../core/time.ts";
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
const account = (network: Network, times: Times, language: Language = "en", details: AccountDetails = {}): Account => ({
  id: `initech-${network}${language === "en" ? "" : `-${language}`}` as AccountId,
  brand: "initech" as BrandId,
  network,
  handle: language === "en" ? "@initech" : `@initech.${language}`,
  language,
  times,
  ...details,
});
let store: StoreFile = {
  ...emptyStore(),
  brands: [
    { id: "initech" as BrandId, name: "Initech", sticker: "camera", folder: "fixtures/initech" },
    { id: "globex" as BrandId, name: "Globex", sticker: "night", folder: "fixtures/globex" },
  ],
  groups: [{ id: "musteri-a", name: "Müşteri A", open: true, brands: ["globex" as BrandId] }],
  accounts: [
    account("x", { x: T("09:00") }, "en", { email: "initech@example.com", twoStep: "app" }),
    account("instagram", { "instagram-reels": T("14:15") }, "en", {
      email: "initech@example.com",
      twoStep: "app",
      recoveryEmail: "kurtarma@example.com",
      note: "Creator hesabı; Threads buna bağlı",
    }),
    account("instagram", { "instagram-reels": T("14:45") }, "tr"),
    account("tiktok", { tiktok: T("18:30") }, "en", { email: "video@example.com", twoStep: "sms" }),
    account("youtube", { "youtube-shorts": T("19:00") }, "en", { email: "video@example.com", twoStep: "app" }),
    account("pinterest", { pinterest: T("20:00") }, "en", { email: "initech@example.com", twoStep: "none" }),
  ],
};

// Made-up passwords only; every fake account except Instagram (Türkçe) has one, and Instagram has 8 backup codes.
const FAKE_PASSWORD = "ornek-sifre-123";
const vault = new Map<string, { readonly password: string | null; readonly codes: readonly string[] }>(
  ["initech-x", "initech-instagram", "initech-tiktok", "initech-youtube", "initech-pinterest"].map((id) => [
    id,
    { password: FAKE_PASSWORD, codes: id === "initech-instagram" ? ["1111 2222", "3333 4444", "5555 6666", "7777 8888", "9999 0000", "1212 3434", "5656 7878", "9090 1212"] : [] },
  ]),
);
// The fake backup file: what `backup.save` wrote last, or one made from the starting entries.
type FakeEntry = { readonly password: string | null; readonly codes: readonly string[] };
const FAKE_PASSPHRASE = "ornek-parola-uzun";
let backupFile = { passphrase: FAKE_PASSPHRASE, entries: new Map<string, FakeEntry>(vault) };
let backupPicked = false;
// `?backup=cancel`: every backup dialog is cancelled; `?backup=write`: saving fails.
const backupScenario = () => new URLSearchParams(location.search).get("backup");
const dataScenario = () => new URLSearchParams(location.search).get("data");
// `?vault=error`: the Credential Manager cannot be opened.
const vaultDown = (): { ok: false; error: { code: "vault-unavailable"; detail: string } } | null =>
  new URLSearchParams(location.search).get("vault") === "error" ? { ok: false, error: { code: "vault-unavailable", detail: "fake shell: ?vault=error" } } : null;

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
  // The last call is kept in `window.postbellTray`.
  tray: {
    async set(texts, hideOnClose) {
      (window as { postbellTray?: { texts: TrayTexts; hideOnClose: boolean } }).postbellTray = { texts, hideOnClose };
      return { ok: true, value: undefined };
    },
  },
  // The last value is kept in `window.postbellAutostart`. `?autostart=fail`: the Run key cannot be written.
  autostart: {
    async set(on) {
      if (new URLSearchParams(location.search).get("autostart") === "fail") return { ok: false, error: { code: "autostart-failed", detail: "fake shell: ?autostart=fail" } };
      (window as { postbellAutostart?: boolean }).postbellAutostart = on;
      return { ok: true, value: undefined };
    },
  },
  // The last saved file is kept in `window.postbellData`. The opened file is this store with «Gecikeni hatırlat» at 1 hour,
  // «Son açık sayfa» and «Bilgisayar açılınca başlat» on. `?data=`: cancel, fail (the file cannot be written or read),
  // bad (not a data file), newer (from a newer Postbell).
  data: {
    async save(name, text) {
      const scenario = dataScenario();
      if (scenario === "cancel") return { ok: true, value: null };
      if (scenario === "fail") return { ok: false, error: { code: "data-write", detail: "fake shell: ?data=fail" } };
      (window as { postbellData?: { name: string; text: string } }).postbellData = { name, text };
      return { ok: true, value: name };
    },
    async open() {
      const scenario = dataScenario();
      if (scenario === "cancel") return { ok: true, value: null };
      if (scenario === "fail") return { ok: false, error: { code: "data-read", detail: "fake shell: ?data=fail" } };
      if (scenario === "bad") return { ok: true, value: "{ not a data file" };
      if (scenario === "newer") return { ok: true, value: JSON.stringify({ version: 99 }) };
      return { ok: true, value: serializeStore({ ...store, settings: { ...store.settings, reminderInterval: 60, startScreen: "last", launchAtLogin: true } }) };
    },
    async keep() {
      (window as { postbellKept?: number }).postbellKept = ((window as { postbellKept?: number }).postbellKept ?? 0) + 1;
      return { ok: true, value: undefined };
    },
  },
  vault: {
    async status(accounts) {
      return vaultDown() ?? { ok: true, value: accounts.map((account) => ({ account, password: (vault.get(account)?.password ?? null) !== null, codes: vault.get(account)?.codes.length ?? 0 })) };
    },
    async write(account, { password, codes, replace }) {
      const down = vaultDown();
      if (down) return down;
      const old = replace ? { password: null, codes: [] } : (vault.get(account) ?? { password: null, codes: [] });
      const next = { password: password === null ? old.password : password || null, codes: codes ?? old.codes };
      if (next.password === null && next.codes.length === 0) vault.delete(account);
      else vault.set(account, next);
      return { ok: true, value: undefined };
    },
    async password(account) {
      const p = vault.get(account)?.password;
      return vaultDown() ?? (p ? { ok: true, value: p } : { ok: false, error: { code: "vault-not-found", detail: account } });
    },
    async copy(account) {
      return vaultDown() ?? (vault.get(account)?.password ? { ok: true, value: undefined } : { ok: false, error: { code: "vault-not-found", detail: account } });
    },
    async remove(account) {
      const down = vaultDown();
      if (down) return down;
      vault.delete(account);
      return { ok: true, value: undefined };
    },
  },
  backup: {
    async save(accounts, passphrase) {
      if (!passphraseLongEnough(passphrase)) return { ok: false, error: { code: "backup-passphrase-short", detail: "fake shell" } };
      const down = vaultDown();
      if (down) return down;
      if (backupScenario() === "cancel") return { ok: true, value: null };
      const entries = new Map(accounts.flatMap((a) => (vault.has(a.id) ? [[a.id, vault.get(a.id)!] as const] : [])));
      if (entries.size === 0) return { ok: false, error: { code: "backup-empty", detail: "fake shell" } };
      if (backupScenario() === "write") return { ok: false, error: { code: "backup-write", detail: "fake shell: ?backup=write" } };
      backupFile = { passphrase, entries };
      return { ok: true, value: { count: entries.size, created: Date.now() } };
    },
    async pick() {
      backupPicked = backupScenario() !== "cancel";
      return { ok: true, value: backupPicked ? "D:\\Yedek\\postbell-kasa-2026-11-12.age" : null };
    },
    async restore(passphrase, accounts) {
      if (!backupPicked) return { ok: false, error: { code: "backup-not-picked", detail: "fake shell" } };
      if (passphrase !== backupFile.passphrase) return { ok: false, error: { code: "backup-unreadable", detail: "fake shell" } };
      const down = vaultDown();
      if (down) return down;
      const done = { changed: 0, added: 0, skipped: 0 };
      for (const [id, entry] of backupFile.entries) {
        if (!accounts.includes(id as AccountId)) done.skipped += 1;
        else {
          done[vault.has(id) ? "changed" : "added"] += 1;
          vault.set(id, entry);
        }
      }
      return { ok: true, value: done };
    },
  },
  store: {
    // `?store=`: missing (first run), corrupt, newer (newer version), wait (never resolves), groups (extra closed empty group), finished (done and skipped records),
    // backup (last backup on 3 Kasım and a new account since, as `accounts/V1 · backup-reminder` and `settings/V1 · default`).
    async load() {
      const scenario = new URLSearchParams(location.search).get("store");
      if (scenario === "wait") return new Promise(() => undefined);
      if (scenario === "missing") store = emptyStore();
      if (scenario === "backup" && store.backup.last === undefined) store = { ...store, backup: { last: at(parseDate("2026-11-03") as LocalDate, T("10:00")), pending: "new-account" } };
      if (scenario === "groups" && !store.groups.some((g) => g.id === "musteri-b"))
        store = { ...store, groups: [...store.groups, { id: "musteri-b", name: "Müşteri B", open: false, brands: [] }] };
      if ((scenario === "finished" || scenario === "history") && store.records.length === 0) {
        const day = parseDate("2026-11-12") as LocalDate;
        const id = (p: string) => `initech/initech-2026-11-12-hidden-dog/${p}` as ShareId;
        store = withRecord(store, { share: id("instagram-reels"), status: "done", at: at(day, T("09:05")) });
        store = withRecord(store, { share: id("tiktok"), status: "skipped", at: at(day, T("10:00")) });
      }
      // `many`: 5,000 records of old contents over 100 days, for the history timing.
      if (scenario === "many" && store.records.length === 0) {
        const platforms = ["x", "instagram-reels", "tiktok", "youtube-shorts", "pinterest"];
        const first = at(parseDate("2026-08-04") as LocalDate, T("09:00"));
        const records = Array.from({ length: 5000 }, (_, i) => ({
          share: `initech/initech-old-${Math.floor(i / 5)}/${platforms[i % 5]}` as ShareId,
          status: i % 7 ? ("done" as const) : ("skipped" as const),
          at: (first + Math.floor(i / 50) * DAY) as typeof first,
        }));
        store = { ...store, records };
      }
      // `history`: also records of earlier days whose packages are no longer in the folders, and one of Globex.
      if (scenario === "history" && store.records.length === 2) {
        const rec = (share: string, status: "done" | "skipped", date: string, time: string) => ({ share: share as ShareId, status, at: at(parseDate(date) as LocalDate, T(time)) });
        for (const r of [
          rec("globex/globex-2026-11-12-gizli-kopek/x", "done", "2026-11-12", "09:20"),
          rec("initech/initech-2026-11-11-old-letter/x", "done", "2026-11-11", "09:02"),
          rec("initech/initech-2026-11-11-old-letter/tiktok", "done", "2026-11-11", "18:41"),
          rec("initech/initech-2026-11-11-old-letter/pinterest", "skipped", "2026-11-11", "20:10"),
          rec("initech/initech-2026-11-09-first-light/x", "done", "2026-11-09", "09:00"),
        ])
          store = withRecord(store, r);
      }
      const text = scenario === "missing" ? null : scenario === "corrupt" ? "{bozuk" : scenario === "newer" ? '{"version": 5}' : serializeStore(store);
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
