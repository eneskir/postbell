import { test } from "node:test";
import assert from "node:assert/strict";
import { parseManifest, parseManifestText } from "./manifest.ts";
import { manifestSchemaV1 } from "./manifest.gen.ts";

const valid = () => ({
  schemaVersion: 1,
  id: "initech-2026-11-12-hidden-dog",
  brand: "initech",
  date: "2026-11-12",
  language: "en",
  title: "The dog hiding in the corner",
  approval: "approved",
  files: [
    { id: "main", kind: "video", role: "main", path: "main.mp4", width: 1080, height: 1920, durationSec: 42.5 },
    { id: "card", kind: "image", role: "card", path: "images/card-16x9.png", width: 160, height: 90 },
  ],
  entries: [
    { platform: "tiktok", file: "main", text: "Look at the lower left corner first.", aiLabel: true },
    { platform: "x", file: "card", text: "Look at the lower left corner first.", aiLabel: false },
  ],
  sources: [{ title: "Sample museum, artwork page", url: "https://example.com/artwork/1", license: "CC0-1.0" }],
  aiUsage: { voice: true, visuals: false, text: true },
});

const errorOf = (raw: unknown) => {
  const r = parseManifest(raw);
  assert.equal(r.ok, false, "expected an error");
  return r.ok ? null : r.error;
};

test("a valid package parses; each platform entry carries its file", () => {
  const r = parseManifest(valid());
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.content.brand, "initech");
  assert.equal(r.content.date, "2026-11-12");
  assert.equal(r.content.entries.length, 2);
  assert.equal(r.content.entries[0]?.platform, "tiktok");
  assert.equal(r.content.entries[0]?.file.path, "main.mp4");
  assert.equal(r.content.entries[0]?.aiLabel, true);
  assert.equal(r.content.entries[1]?.file.kind, "image");
});

test("missing field: invalid-shape with the field path", () => {
  const m = valid() as Record<string, unknown>;
  delete m.title;
  assert.deepEqual(errorOf(m), { code: "invalid-shape", path: "title", rule: "required" });
});

test("every required top-level field fails with its own path when removed", () => {
  for (const key of manifestSchemaV1.required ?? []) {
    if (key === "schemaVersion") continue;
    const m = valid() as Record<string, unknown>;
    delete m[key];
    assert.deepEqual(errorOf(m), { code: "invalid-shape", path: key, rule: "required" }, key);
  }
});

test("a version 2 package does not crash and gives unknown-version; its shape is not judged by version 1 rules", () => {
  assert.deepEqual(errorOf({ ...valid(), schemaVersion: 2, title: 7 }), { code: "unknown-version", version: 2 });
  assert.deepEqual(errorOf({ ...valid(), schemaVersion: "1" }), { code: "unknown-version", version: "1" });
  const m = valid() as Record<string, unknown>;
  delete m.schemaVersion;
  assert.deepEqual(errorOf(m), { code: "invalid-shape", path: "schemaVersion", rule: "required" });
});

test("an unapproved package gives not-approved; a broken shape reports the shape error first", () => {
  assert.deepEqual(errorOf({ ...valid(), approval: "pending" }), { code: "not-approved", approval: "pending" });
  assert.deepEqual(errorOf({ ...valid(), approval: "revision" }), { code: "not-approved", approval: "revision" });
  const m = { ...valid(), approval: "pending" } as Record<string, unknown>;
  delete m.title;
  assert.equal(errorOf(m)?.code, "invalid-shape");
});

test("rules the schema cannot express: calendar date, file reference, duplicates, video duration", () => {
  assert.deepEqual(errorOf({ ...valid(), date: "2026-02-30" }), { code: "invalid-shape", path: "date", rule: "date" });
  const v = valid();
  assert.deepEqual(errorOf({ ...v, entries: [{ ...v.entries[0], file: "missing" }] }), { code: "invalid-shape", path: "entries[0].file", rule: "reference" });
  assert.deepEqual(errorOf({ ...v, entries: [v.entries[0], v.entries[0]] }), { code: "invalid-shape", path: "entries[1].platform", rule: "unique" });
  assert.deepEqual(errorOf({ ...v, files: [v.files[0], v.files[0]] }), { code: "invalid-shape", path: "files[1].id", rule: "unique" });
  const { durationSec: _, ...noDuration } = v.files[0]!;
  assert.deepEqual(errorOf({ ...v, files: [noDuration, v.files[1]] }), { code: "invalid-shape", path: "files[0].durationSec", rule: "required" });
});

test("a lone surrogate (JSON escape \\ud83d) fails the unicode rule; a paired emoji passes", () => {
  const text = JSON.stringify(valid()).replace('"The dog hiding in the corner"', '"The dog \\ud83d"');
  assert.deepEqual(parseManifestText(text), { ok: false, error: { code: "invalid-shape", path: "title", rule: "unicode" } });
  const v = valid();
  assert.deepEqual(errorOf({ ...v, entries: [v.entries[0], { ...v.entries[1], text: "x \udc36 y" }] }), { code: "invalid-shape", path: "entries[1].text", rule: "unicode" });
  assert.deepEqual(errorOf({ ...v, sources: [{ ...v.sources[0], title: "\ud83d\ud83d" }] }), { code: "invalid-shape", path: "sources[0].title", rule: "unicode" });
  const ok = parseManifestText(JSON.stringify({ ...v, title: "Dog 🐶 🐶" }));
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.content.title, "Dog 🐶 🐶");
});

test("rejected at the boundary: unknown platform, extra field, path leaving the folder, non-https source", () => {
  const v = valid();
  assert.deepEqual(errorOf({ ...v, entries: [{ ...v.entries[0], platform: "facebook" }] }), { code: "invalid-shape", path: "entries[0].platform", rule: "enum" });
  assert.deepEqual(errorOf({ ...v, extra: 1 }), { code: "invalid-shape", path: "extra", rule: "additionalProperties" });
  assert.deepEqual(errorOf({ ...v, files: [{ ...v.files[0], path: "../main.mp4" }, v.files[1]] }), { code: "invalid-shape", path: "files[0].path", rule: "pattern" });
  assert.deepEqual(errorOf({ ...v, files: [{ ...v.files[0], path: "C:/main.mp4" }, v.files[1]] }), { code: "invalid-shape", path: "files[0].path", rule: "pattern" });
  assert.deepEqual(errorOf({ ...v, sources: [{ ...v.sources[0], url: "http://example.com" }] }), { code: "invalid-shape", path: "sources[0].url", rule: "pattern" });
  assert.deepEqual(errorOf({ ...v, files: [{ ...v.files[0], width: 10.5 }, v.files[1]] }), { code: "invalid-shape", path: "files[0].width", rule: "type" });
});

test("broken JSON text gives invalid-json; a non-object value gives invalid-shape", () => {
  assert.deepEqual(parseManifestText('{"schemaVersion": 1,'), { ok: false, error: { code: "invalid-json" } });
  assert.deepEqual(errorOf([]), { code: "invalid-shape", path: "$", rule: "type" });
  assert.equal(parseManifestText(JSON.stringify(valid())).ok, true);
});
