import { test } from "node:test";
import assert from "node:assert/strict";
import type { Content } from "./manifest.ts";
import { contentRowOf, contentsView, skipLeft } from "./contents.ts";
import { contentKeyOf, deriveShares, fileKeyOf, shareIdOf, type Account, type AccountId, type BrandId, type ContentId, type FileKey, type ShareRecord } from "./shares.ts";
import { emptyStore, withoutRecord, withRecord } from "./store.ts";
import { testContent } from "./test-content.ts";
import { at, parseDate, parseTime, type LocalDate, type LocalMs, type TimeOfDay } from "./time.ts";

const D = (s: string) => parseDate(s) as LocalDate;
const T = (s: string) => parseTime(s) as TimeOfDay;
const NOW = (d: string, t: string) => at(D(d), T(t));
const P = "initech" as BrandId;
const O = "globex" as BrandId;
const TODAY = D("2026-11-11");
const NOON = NOW("2026-11-11", "14:20");

const accounts = (brand: BrandId): Account[] => [
  { id: `${brand}-x` as AccountId, brand, network: "x", handle: "@a", language: "en", times: { x: T("09:00") } },
  { id: `${brand}-tiktok` as AccountId, brand, network: "tiktok", handle: "@a", language: "en", times: { tiktok: T("18:30") } },
  { id: `${brand}-ig` as AccountId, brand, network: "instagram", handle: "@a", language: "en", times: { "instagram-reels": T("14:15") } },
  { id: `${brand}-pinterest` as AccountId, brand, network: "pinterest", handle: "@a", language: "en", times: {} },
];

const content = (id: string, date: string, platforms: readonly string[], brand = P) => testContent({ brand, id, date, platforms });
const id = (c: string, p: "x" | "tiktok" | "instagram-reels" | "pinterest", brand = P) => shareIdOf(brand, c as ContentId, p);
const rec = (share: ReturnType<typeof id>, status: ShareRecord["status"], t = "10:00"): ShareRecord => ({ share, status, at: NOW("2026-11-11", t) });

const view = (contents: readonly Content[], records: readonly ShareRecord[] = [], now: LocalMs = NOON, missingFiles: ReadonlySet<FileKey> = new Set()) =>
  contentsView(deriveShares({ contents, accounts: [...accounts(P), ...accounts(O)], records, missingFiles, now }), P, TODAY);

const titles = (v: ReturnType<typeof view>) => ({
  today: v.groups.today.map((r) => r.content.id),
  planned: v.groups.planned.map((r) => r.content.id),
  done: v.groups.done.map((r) => r.content.id),
});

test("contents group into Bugün, Planlı and Bitenler; another brand's contents are left out", () => {
  const v = view(
    [content("today", "2026-11-11", ["x", "tiktok"]), content("tomorrow", "2026-11-12", ["x"]), content("finished", "2026-11-10", ["x"]), content("other", "2026-11-11", ["x"], O)],
    [rec(id("finished", "x"), "done")],
  );
  assert.deepEqual(titles(v), { today: ["today"], planned: ["tomorrow"], done: ["finished"] });
  assert.equal(v.total, 3);
});

test("a row counts its shared shares out of all; a skipped share is not counted as shared", () => {
  const v = view([content("c", "2026-11-11", ["x", "tiktok", "instagram-reels"])], [rec(id("c", "x"), "done"), rec(id("c", "instagram-reels"), "skipped")]);
  const row = v.groups.today[0]!;
  assert.deepEqual({ done: row.done, total: row.shares.length, next: row.next?.platform }, { done: 1, total: 3, next: "tiktok" });
});

test("a content whose every share was skipped falls into Bitenler with the skipped tag", () => {
  const v = view([content("c", "2026-11-11", ["x", "tiktok"])], [rec(id("c", "x"), "skipped"), rec(id("c", "tiktok"), "skipped")]);
  assert.deepEqual(titles(v), { today: [], planned: [], done: ["c"] });
  assert.deepEqual(v.groups.done[0]!.tag, { kind: "skipped" });
});

test("a late share from an earlier day keeps its content in Bugün", () => {
  const v = view([content("yesterday", "2026-11-10", ["x", "tiktok"])], [rec(id("yesterday", "tiktok"), "done")]);
  assert.deepEqual(titles(v).today, ["yesterday"]);
  assert.deepEqual(v.groups.today[0]!.tag, { kind: "late", count: 1 });
});

test("the tag counts late shares first, then a missing file, then a due one", () => {
  const missing = new Set([fileKeyOf(P, "file" as ContentId, "main.png")]);
  const v = view(
    [content("late", "2026-11-11", ["x", "instagram-reels"]), content("due", "2026-11-11", ["instagram-reels"]), content("file", "2026-11-11", ["tiktok"]), content("calm", "2026-11-11", ["tiktok"])],
    [],
    NOW("2026-11-11", "14:20"),
    missing,
  );
  const tags = Object.fromEntries(v.groups.today.map((r) => [r.content.id, r.tag]));
  assert.deepEqual(tags, { late: { kind: "late", count: 1 }, due: { kind: "due" }, file: { kind: "file-missing" }, calm: null });
});

test("Bugün and Planlı sort by the next share's time; a share with no time comes after the timed ones of its day", () => {
  const v = view([
    content("evening", "2026-11-11", ["tiktok"]),
    content("morning", "2026-11-11", ["x"]),
    content("untimed", "2026-11-11", ["pinterest"]),
    content("day-after", "2026-11-13", ["x"]),
    content("tomorrow-untimed", "2026-11-12", ["pinterest"]),
    content("tomorrow", "2026-11-12", ["tiktok"]),
  ]);
  assert.deepEqual(titles(v), { today: ["morning", "evening", "untimed"], planned: ["tomorrow", "tomorrow-untimed", "day-after"], done: [] });
});

test("Bitenler lists the most recently finished content first", () => {
  const v = view([content("a", "2026-11-11", ["x"]), content("b", "2026-11-11", ["x"])], [rec(id("a", "x"), "done", "09:05"), rec(id("b", "x"), "done", "11:00")]);
  assert.deepEqual(titles(v).done, ["b", "a"]);
});

test("the panel goes to the first late share, else to the next one on Bugün, and nowhere for a planned content", () => {
  const v = view([content("late", "2026-11-11", ["instagram-reels", "x", "tiktok"]), content("calm", "2026-11-11", ["tiktok"]), content("later", "2026-11-12", ["x"])]);
  const goTo = (c: string) => contentRowOf(v, contentKeyOf(P, c as ContentId))?.goTo?.platform ?? null;
  assert.deepEqual([goTo("late"), goTo("calm"), goTo("later")], ["x", "tiktok", null]);
});

test("skipping the rest records only the shares still left, and undoing them restores the row", () => {
  const c = content("c", "2026-11-11", ["x", "tiktok", "instagram-reels"]);
  const before = [rec(id("c", "x"), "done")];
  const row = view([c], before).groups.today[0]!;
  const skips = skipLeft(row, NOW("2026-11-11", "14:21"));
  assert.deepEqual(skips.map((r) => r.share).sort(), [id("c", "instagram-reels"), id("c", "tiktok")]);
  const store = [...before, ...skips].reduce(withRecord, emptyStore());
  const after = view([c], store.records);
  assert.deepEqual({ group: after.groups.done[0]?.content.id, done: after.groups.done[0]?.done }, { group: "c", done: 1 });
  const undone = skips.reduce((s, r) => withoutRecord(s, r.share), store);
  assert.deepEqual(titles(view([c], undone.records)).today, ["c"]);
});
