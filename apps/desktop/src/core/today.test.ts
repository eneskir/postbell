import { test } from "node:test";
import assert from "node:assert/strict";
import { parseManifest, type Content } from "./manifest.ts";
import { deriveShares, fileKeyOf, shareIdOf, type Account, type AccountId, type BrandId, type ContentId, type ShareRecord } from "./shares.ts";
import { at, parseDate, parseTime, type LocalDate, type LocalMs, type TimeOfDay } from "./time.ts";
import { homeView, rowTagOf, todayView, type BrandState } from "./today.ts";

const D = (s: string) => parseDate(s) as LocalDate;
const T = (s: string) => parseTime(s) as TimeOfDay;
const NOW = (d: string, t: string) => at(D(d), T(t));
const P = "initech" as BrandId;
const O = "globex" as BrandId;

function content(brand: BrandId, id: string, date: string, platforms: readonly string[]): Content {
  const r = parseManifest({
    schemaVersion: 1, id, brand, date, language: "en", title: id, approval: "approved",
    files: [{ id: "main", kind: "image", role: "main", path: "main.png", width: 10, height: 10 }],
    entries: platforms.map((p) => ({ platform: p, file: "main", text: "text", aiLabel: false })),
    sources: [{ title: "source", url: "https://example.com", license: "CC0-1.0" }],
    aiUsage: { voice: false, visuals: false, text: false },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.content;
}

const accounts = (brand: BrandId): Account[] => [
  { id: `${brand}-x` as AccountId, brand, network: "x", handle: "@a", language: "en", times: { x: T("09:00") } },
  { id: `${brand}-tiktok` as AccountId, brand, network: "tiktok", handle: "@a", language: "en", times: { tiktok: T("18:30") } },
  { id: `${brand}-pinterest` as AccountId, brand, network: "pinterest", handle: "@a", language: "en", times: {} },
];

const read = (brand: BrandId): BrandState => ({ brand, folder: { kind: "read" }, rejected: 0 });

const shares = (contents: readonly Content[], now: LocalMs, records: readonly ShareRecord[] = [], missingFiles: ReadonlySet<string> = new Set()) =>
  deriveShares({ contents, accounts: [...accounts(P), ...accounts(O)], records, missingFiles, now });

test("summary counts come from the brand's four groups; another brand's shares do not count", () => {
  const all = shares(
    [
      content(P, "yesterday", "2026-11-10", ["x"]),
      content(P, "today", "2026-11-11", ["x", "tiktok", "pinterest"]),
      content(O, "other", "2026-11-11", ["x", "tiktok"]),
    ],
    NOW("2026-11-11", "14:20"),
    [{ share: shareIdOf(P, "today" as ContentId, "x"), status: "done", at: NOW("2026-11-11", "09:05") }],
  );
  const v = todayView(all, P, D("2026-11-11"));
  assert.deepEqual(
    { total: v.total, late: v.late, unscheduled: v.unscheduled, next: v.next },
    { total: 4, late: 1, unscheduled: 1, next: null },
  );
  assert.deepEqual(
    [v.groups.late, v.groups.upcoming, v.groups.unscheduled, v.groups.finished].map((g) => g.map((s) => s.id)),
    [["initech/yesterday/x"], ["initech/today/tiktok"], ["initech/today/pinterest"], ["initech/today/x"]],
  );
  assert.equal(todayView(all, O, D("2026-11-11")).total, 2);
});

test("an empty day shows the next timed pending share after today; untimed and marked ones are skipped", () => {
  const all = shares(
    [
      content(P, "tomorrow", "2026-11-12", ["tiktok", "pinterest"]),
      content(P, "was-skipped", "2026-11-12", ["x"]),
      content(P, "later", "2026-11-14", ["x"]),
      content(O, "other", "2026-11-12", ["x"]),
    ],
    NOW("2026-11-11", "14:20"),
    [{ share: shareIdOf(P, "was-skipped" as ContentId, "x"), status: "skipped", at: NOW("2026-11-11", "10:00") }],
  );
  const v = todayView(all, P, D("2026-11-11"));
  assert.equal(v.total, 0);
  assert.equal(v.next, NOW("2026-11-12", "18:30"));
  assert.deepEqual(v.groups.finished, []);
});

test("a past day's untimed share stays under No time; with nothing ahead, next is null", () => {
  const v = todayView(shares([content(P, "old", "2026-11-09", ["pinterest"])], NOW("2026-11-11", "14:20")), P, D("2026-11-11"));
  assert.equal(v.unscheduled, 1);
  assert.equal(todayView([], P, D("2026-11-11")).next, null);
});

test("an empty day with nothing timed next shows the content count and the first waiting day", () => {
  const now = NOW("2026-11-11", "14:20");
  const contents = [content(P, "a", "2026-11-13", ["x"]), content(P, "b", "2026-11-12", ["x", "tiktok"]), content(O, "c", "2026-11-12", ["x"])];
  const v = todayView(deriveShares({ contents, accounts: [], records: [], missingFiles: new Set(), now }), P, D("2026-11-11"));
  assert.equal(v.total, 0);
  assert.equal(v.next, null);
  assert.deepEqual(v.later, { contents: 2, firstDay: D("2026-11-12") });
  assert.equal(todayView(shares([content(P, "y", "2026-11-12", ["x"])], now), P, D("2026-11-11")).later, null);
  assert.equal(todayView([], P, D("2026-11-11")).later, null);
});

test("unscheduled shares sort by content, then format (X, Instagram Reels, ..., YouTube Shorts)", () => {
  const H = "no-accounts" as BrandId;
  const all = shares([content(H, "b", "2026-11-11", ["youtube-shorts", "x"]), content(H, "a", "2026-11-11", ["youtube-shorts", "tiktok", "instagram-reels", "x"])], NOW("2026-11-11", "14:20"));
  const v = todayView(all, H, D("2026-11-11"));
  assert.deepEqual(v.groups.unscheduled.map((s) => s.id), ["no-accounts/a/x", "no-accounts/a/instagram-reels", "no-accounts/a/tiktok", "no-accounts/a/youtube-shorts", "no-accounts/b/x", "no-accounts/b/youtube-shorts"]);
});

test("row tag: a missing file hides late and due; finished shares ignore the file", () => {
  const c = [content(P, "a", "2026-11-11", ["x", "tiktok", "pinterest"]), content(P, "b", "2026-11-11", ["x", "tiktok"]), content(O, "c", "2026-11-11", ["x"])];
  const missing = new Set([fileKeyOf(P, "a" as ContentId, "main.png"), fileKeyOf(O, "c" as ContentId, "main.png")]);
  const records: ShareRecord[] = [{ share: shareIdOf(O, "c" as ContentId, "x"), status: "skipped", at: NOW("2026-11-11", "10:00") }];
  const tags = (all: ReturnType<typeof shares>) => Object.fromEntries(all.map((s) => [s.id, rowTagOf(s)]));
  const t = tags(shares(c, NOW("2026-11-11", "18:40"), records, missing));
  assert.deepEqual(t["initech/a/x"], { kind: "file-missing" });
  assert.deepEqual(t["initech/a/tiktok"], { kind: "file-missing" });
  assert.deepEqual(t["initech/a/pinterest"], { kind: "file-missing" }, "unscheduled share too");
  assert.deepEqual(t["initech/b/x"], { kind: "late", lateBy: 580 });
  assert.deepEqual(t["initech/b/tiktok"], { kind: "due" });
  assert.deepEqual(t["globex/c/x"], { kind: "skipped" }, "skipped ignores the file");
  const early = tags(shares(c, NOW("2026-11-11", "08:00"), [{ share: shareIdOf(P, "b" as ContentId, "tiktok"), status: "done", at: NOW("2026-11-11", "07:00") }]));
  assert.equal(early["initech/b/x"], null);
  assert.equal(early["initech/b/tiktok"], null);
  const H = "no-accounts" as BrandId;
  assert.equal(rowTagOf(shares([content(H, "d", "2026-11-11", ["x"])], NOW("2026-11-11", "18:40"))[0]!), null);
});

test("Home: all brands' shares in one list by time; equal times by content, format, then full id", () => {
  const all = shares(
    [
      content(P, "a", "2026-11-11", ["x", "tiktok"]),
      content(O, "a", "2026-11-11", ["x"]),
      content(O, "b", "2026-11-11", ["tiktok"]),
      content(O, "yesterday", "2026-11-10", ["x"]),
    ],
    NOW("2026-11-11", "08:00"),
  );
  const v = homeView(all, [read(P), read(O)], D("2026-11-11"));
  assert.deepEqual(
    [v.groups.late, v.groups.upcoming].map((g) => g.map((s) => s.id)),
    [["globex/yesterday/x"], ["globex/a/x", "initech/a/x", "initech/a/tiktok", "globex/b/tiktok"]],
  );
  assert.deepEqual({ total: v.total, late: v.late, unscheduled: v.unscheduled, problems: v.problems }, { total: 5, late: 1, unscheduled: 0, problems: [] });
});

test("Home: brands with a missing or unreadable folder or rejected packages are problems, in brand order; an empty folder is not", () => {
  const G = "locked" as BrandId;
  const E = "empty" as BrandId;
  const all = shares([content(P, "a", "2026-11-11", ["x"])], NOW("2026-11-11", "08:00"));
  const v = homeView(
    all,
    [
      { brand: O, folder: { kind: "missing" }, rejected: 0 },
      { brand: P, folder: { kind: "read" }, rejected: 2 },
      { brand: G, folder: { kind: "unreadable", code: "folder-read" }, rejected: 0 },
      { brand: E, folder: { kind: "empty" }, rejected: 0 },
    ],
    D("2026-11-11"),
  );
  assert.deepEqual(v.problems, [
    { brand: O, kind: "missing" },
    { brand: P, kind: "rejected", count: 2 },
    { brand: G, kind: "unreadable" },
  ]);
  assert.deepEqual(v.groups.upcoming.map((s) => s.id), ["initech/a/x"]);
});

test("Home: shares of a brand not in the store (removed) do not count", () => {
  const all = shares([content(P, "a", "2026-11-11", ["x"]), content(O, "a", "2026-11-11", ["x"])], NOW("2026-11-11", "08:00"));
  const v = homeView(all, [read(P)], D("2026-11-11"));
  assert.deepEqual(v.groups.upcoming.map((s) => s.id), ["initech/a/x"]);
  assert.equal(homeView(all, [], D("2026-11-11")).total, 0);
});
