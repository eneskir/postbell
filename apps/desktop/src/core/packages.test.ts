import { test } from "node:test";
import assert from "node:assert/strict";
import { folderStateOf, loadPackages, type PackageDir } from "./packages.ts";
import type { BrandId } from "./shares.ts";

const manifest = (id: string, brand = "initech") =>
  JSON.stringify({
    schemaVersion: 1, id, brand, date: "2026-11-12", language: "en", title: id, approval: "approved",
    files: [
      { id: "main", kind: "video", role: "main", path: "main.mp4", width: 1080, height: 1920, durationSec: 30 },
      { id: "card", kind: "image", role: "card", path: "images/card.png", width: 1000, height: 1500 },
    ],
    entries: [{ platform: "x", file: "main", text: "text", aiLabel: true }],
    sources: [{ title: "source", url: "https://example.com", license: "CC0-1.0" }],
    aiUsage: { voice: false, visuals: true, text: false },
  });
const pkg = (dir: string, text: string | null, files = ["main.mp4", "images/card.png", "manifest.json"]): PackageDir => ({
  dir,
  manifest: text,
  files: files.map((path) => ({ path, size: path.length })),
});
const B = "initech" as BrandId;

test("packages become contents; a missing file is keyed by brand/content/path", () => {
  const r = loadPackages([{ brand: B, packages: [pkg("2026-11-12/a", manifest("a")), pkg("2026-11-12/b", manifest("b"), ["main.mp4"])] }]);
  assert.deepEqual(r.contents.map((c) => c.id), ["a", "b"]);
  assert.deepEqual([...r.missingFiles], ["initech/b/images/card.png"]);
  assert.deepEqual(
    [...r.sizes],
    [
      ["initech/a/main.mp4", 8],
      ["initech/a/images/card.png", 15],
      ["initech/b/main.mp4", 8],
    ],
  );
  assert.deepEqual([...r.dirs], [["initech/a", "2026-11-12/a"], ["initech/b", "2026-11-12/b"]]);
  assert.deepEqual(r.rejected, []);
});

test("unreadable, invalid, other-brand and duplicate-id packages are rejected with their reason", () => {
  const r = loadPackages([
    {
      brand: B,
      packages: [
        pkg("1/unreadable", null),
        pkg("2/broken", "{"),
        pkg("3/other", manifest("c", "globex")),
        pkg("4/first", manifest("d")),
        pkg("5/second", manifest("d")),
      ],
    },
  ]);
  assert.deepEqual(r.contents.map((c) => c.id), ["d"]);
  assert.deepEqual(
    r.rejected.map((x) => [x.dir, x.why.code]),
    [["1/unreadable", "manifest-unreadable"], ["2/broken", "manifest"], ["3/other", "brand-mismatch"], ["5/second", "duplicate-id"]],
  );
});

test("the same id in two brands is not rejected", () => {
  const r = loadPackages([
    { brand: B, packages: [pkg("x", manifest("same"))] },
    { brand: "globex" as BrandId, packages: [pkg("x", manifest("same", "globex"))] },
  ]);
  assert.equal(r.contents.length, 2);
});

test("folder state: read, empty, missing and unreadable apart; an unregistered path counts as unreadable", () => {
  const pkg: PackageDir = { dir: "2026-11-12/a", manifest: "{}", files: [] };
  assert.deepEqual(folderStateOf({ ok: true, value: [pkg] }), { kind: "read" });
  assert.deepEqual(folderStateOf({ ok: true, value: [] }), { kind: "empty" });
  assert.deepEqual(folderStateOf({ ok: false, error: { code: "folder-missing", detail: "folder missing: D:/x" } }), { kind: "missing" });
  assert.deepEqual(folderStateOf({ ok: false, error: { code: "folder-read", detail: "Access is denied." } }), { kind: "unreadable", code: "folder-read" });
  assert.deepEqual(folderStateOf({ ok: false, error: { code: "folder-not-registered", detail: "D:/x" } }), { kind: "unreadable", code: "folder-not-registered" });
});
