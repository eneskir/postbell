import { test } from "node:test";
import assert from "node:assert/strict";
import type { PackageDir } from "../core/packages.ts";
import type { Port } from "../core/port.ts";
import { emptyStore, serializeStore, type StoreFile } from "../core/store.ts";
import type { BrandId } from "../core/shares.ts";
import { at, parseDate, parseTime, type LocalDate, type TimeOfDay } from "../core/time.ts";
import { loadDump, SELF_TEST_SHARE } from "./dev-dump.ts";

const NOW = at(parseDate("2026-11-11") as LocalDate, parseTime("14:20") as TimeOfDay);

function stubPort(text: string | null, packages: Record<string, PackageDir[]> = {}) {
  const saved: StoreFile[] = [];
  let backups = 0;
  const port: Port = {
    appInfo: async () => ({ ok: true, value: { name: "Postbell", version: "0.1.0" } }),
    ready: async () => {},
    selfTest: async () => ({ active: true, addRecord: true }),
    packages: {
      read: async (folder) => (folder in packages ? { ok: true, value: packages[folder]! } : { ok: false, error: { code: "folder-not-registered", detail: folder } }),
    },
    files: { url: (folder, path) => `${folder}/${path}`, reveal: async () => ({ ok: true, value: undefined }), restore: async () => ({ ok: true, value: "cancelled" }) },
    links: { openSharePage: async () => ({ ok: true, value: "opened" }) },
    dialogs: { pickFolder: async () => ({ ok: true, value: null }) },
    window: { minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {} },
    alarms: { set: async () => ({ ok: true, value: undefined }), onOpen: () => () => {} },
    tray: { set: async () => ({ ok: true, value: undefined }) },
    store: {
      load: async () => ({ ok: true, value: { path: "C:/veri/store.json", text } }),
      save: async (s) => (saved.push(s), { ok: true, value: undefined }),
      backup: async () => (backups++, { ok: true, value: "C:/veri/store.unreadable-1.json" }),
    },
  };
  return { port, saved, backups: () => backups };
}

test("first launch writes the trial record", async () => {
  const s = stubPort(null);
  const d = await loadDump(s.port, NOW, true);
  assert.deepEqual([d.state, d.records, d.storePath], ["ready", 1, "C:/veri/store.json"]);
  assert.equal(s.saved[0]?.records[0]?.share, SELF_TEST_SHARE);
});

test("store with an unknown version: no file is written even when a trial record is asked for", async () => {
  const s = stubPort('{"version": 2}');
  const d = await loadDump(s.port, NOW, true);
  assert.equal(d.state, "newer-version");
  assert.equal(s.saved.length, 0);
  assert.equal(s.backups(), 0);
});

test("corrupt store: a copy is taken and the file is not overwritten", async () => {
  const s = stubPort("{bozuk");
  const d = await loadDump(s.port, NOW, true);
  assert.deepEqual([d.state, d.backup], ["unreadable", "C:/veri/store.unreadable-1.json"]);
  assert.equal(s.saved.length, 0);
});

test("contents are counted from registered brand folders", async () => {
  const store = { ...emptyStore(), brands: [{ id: "initech" as BrandId, name: "Initech", sticker: "camera", folder: "D:/p" }] };
  const s = stubPort(serializeStore(store), { "D:/p": [{ dir: "a", manifest: "{", files: [] }] });
  const d = await loadDump(s.port, NOW, false);
  assert.deepEqual([d.contents, d.rejected, d.errors.length], [0, 1, 0]);
  assert.equal(d.outsideRead, "folder-not-registered", "the store folder (C:/veri) is not a brand folder");
  assert.deepEqual([d.preview, d.previewOutside], ["not tried", "not tried"]);
});

test("preview probe: the first image in the folder loads, the store file's must not", async () => {
  const manifest = JSON.stringify({
    schemaVersion: 1, id: "a", brand: "initech", date: "2026-11-12", language: "en", title: "a", approval: "approved",
    files: [
      { id: "main", kind: "video", role: "main", path: "main.mp4", width: 1080, height: 1920, durationSec: 30 },
      { id: "card", kind: "image", role: "card", path: "images/card.png", width: 160, height: 90 },
    ],
    entries: [{ platform: "x", file: "card", text: "metin", aiLabel: false }],
    sources: [{ title: "kaynak", url: "https://example.com", license: "CC0-1.0" }],
    aiUsage: { voice: false, visuals: false, text: false },
  });
  const store = { ...emptyStore(), brands: [{ id: "initech" as BrandId, name: "Initech", sticker: "camera", folder: "D:/p" }] };
  const files = [{ path: "main.mp4", size: 4 }, { path: "images/card.png", size: 216 }, { path: "manifest.json", size: 2 }];
  const s = stubPort(serializeStore(store), { "D:/p": [{ dir: "2026-11-12/a", manifest, files }] });
  const asked: string[] = [];
  const d = await loadDump(s.port, NOW, false, async (url) => (asked.push(url), url.startsWith("D:/p/") ? "160 x 90" : null));
  assert.deepEqual(asked, ["D:/p/2026-11-12/a/images/card.png", "C:/veri/store.json"]);
  assert.deepEqual([d.preview, d.previewOutside], ["160 x 90", "not loaded"]);
  const none = await loadDump(stubPort(serializeStore(store), { "D:/p": [{ dir: "2026-11-12/a", manifest, files: files.slice(0, 1) }] }).port, NOW, false, async () => "1 x 1");
  assert.deepEqual([none.preview, none.previewOutside], ["no image", "loaded"]);
});
