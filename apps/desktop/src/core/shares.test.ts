import { test } from "node:test";
import assert from "node:assert/strict";
import { parseManifest, type Content, type Platform } from "./manifest.ts";
import {
  accountFor,
  deriveShares,
  FORMATS,
  lateCount,
  LATE_AFTER_MIN,
  networkOf,
  NETWORKS,
  shareIdOf,
  todayGroups,
  type Account,
  type AccountId,
  type BrandId,
  type ContentId,
  type DeriveInput,
  type Network,
  type ShareRecord,
} from "./shares.ts";
import { at, parseDate, parseTime, type LocalDate, type LocalMs, type TimeOfDay } from "./time.ts";

const D = (s: string) => parseDate(s) as LocalDate;
const T = (s: string) => parseTime(s) as TimeOfDay;
const NOW = (d: string, t: string) => at(D(d), T(t));
const B = "initech" as BrandId;

function content(id: string, date: string, platforms: readonly string[], language = "en"): Content {
  const r = parseManifest({
    schemaVersion: 1, id, brand: "initech", date, language, title: id, approval: "approved",
    files: [{ id: "main", kind: "image", role: "main", path: "main.png", width: 10, height: 10 }],
    entries: platforms.map((p) => ({ platform: p, file: "main", text: "text", aiLabel: false })),
    sources: [{ title: "source", url: "https://example.com", license: "CC0-1.0" }],
    aiUsage: { voice: false, visuals: false, text: false },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.content;
}

const account = (network: Network, times: Record<string, string>, over: Partial<Account> = {}): Account => ({
  id: `initech-${network}` as AccountId,
  brand: B,
  network,
  handle: "@initech",
  language: "en",
  times: Object.fromEntries(Object.entries(times).map(([p, t]) => [p, T(t)])),
  ...over,
});
const accountsAt = (times: Record<string, string>): Account[] =>
  NETWORKS.map((n) => account(n, Object.fromEntries(Object.entries(times).filter(([p]) => networkOf(p as Platform) === n))));
const input = (over: Partial<DeriveInput>): DeriveInput => ({
  contents: [content("c1", "2026-11-11", ["x"])],
  accounts: accountsAt({ x: "09:00" }),
  records: [],
  missingFiles: new Set(),
  now: NOW("2026-11-11", "08:00"),
  ...over,
});
const only = (i: DeriveInput) => {
  const s = deriveShares(i);
  assert.equal(s.length, 1);
  return s[0]!;
};
const C1X = shareIdOf(B, "c1" as ContentId, "x");

test("status: upcoming before the time, due on the minute, late at the threshold", () => {
  assert.equal(only(input({ now: NOW("2026-11-11", "08:59") })).status.kind, "upcoming");
  assert.equal(only(input({ now: NOW("2026-11-11", "09:00") })).status.kind, "due");
  const justBefore = (NOW("2026-11-11", "09:00") + LATE_AFTER_MIN * 60_000 - 1) as LocalMs;
  assert.equal(only(input({ now: justBefore })).status.kind, "due");
  assert.equal(LATE_AFTER_MIN, 30, "late threshold is 30 minutes");
  assert.deepEqual(only(input({ now: NOW("2026-11-11", "09:30") })).status, { kind: "late", lateBy: 30 });
  assert.deepEqual(only(input({ now: NOW("2026-11-11", "14:20") })).status, { kind: "late", lateBy: 320 });
});

test("marked gives done, skipped gives skipped; undo (record removed) derives from the time again", () => {
  const done: ShareRecord = { share: C1X, status: "done", at: NOW("2026-11-11", "09:05") };
  const skipped: ShareRecord = { share: C1X, status: "skipped", at: NOW("2026-11-11", "10:00") };
  const now = NOW("2026-11-11", "14:20");
  assert.deepEqual(only(input({ now, records: [done] })).status, { kind: "done", at: done.at });
  assert.deepEqual(only(input({ now, records: [skipped] })).status, { kind: "skipped", at: skipped.at });
  assert.equal(only(input({ now, records: [] })).status.kind, "late");
});

test("schedule: a new time moves unfinished shares; done and skipped ones stay", () => {
  const contents = [content("c1", "2026-11-11", ["x", "tiktok", "pinterest"])];
  const records: ShareRecord[] = [
    { share: shareIdOf(B, "c1" as ContentId, "tiktok"), status: "done", at: NOW("2026-11-11", "09:10") },
    { share: shareIdOf(B, "c1" as ContentId, "pinterest"), status: "skipped", at: NOW("2026-11-11", "09:20") },
  ];
  const now = NOW("2026-11-11", "10:00");
  const before = deriveShares(input({ contents, records, now, accounts: accountsAt({ x: "09:00", tiktok: "09:00", pinterest: "09:00" }) }));
  const after = deriveShares(input({ contents, records, now, accounts: accountsAt({ x: "18:00", tiktok: "18:00", pinterest: "18:00" }) }));
  const pick = (list: typeof before, p: string) => list.find((s) => s.platform === p)!;
  assert.equal(pick(before, "x").status.kind, "late");
  assert.deepEqual(pick(after, "x").plannedAt, { kind: "at", at: NOW("2026-11-11", "18:00") });
  assert.equal(pick(after, "x").status.kind, "upcoming");
  assert.deepEqual(pick(after, "tiktok").status, pick(before, "tiktok").status);
  assert.deepEqual(pick(after, "pinterest").status, pick(before, "pinterest").status);
});

test("a format without a time is unscheduled: never due or late, not in the badge, in the no-time group", () => {
  const i = input({ accounts: accountsAt({}), now: NOW("2026-11-11", "23:59") });
  const s = only(i);
  assert.deepEqual(s.plannedAt, { kind: "unscheduled", date: "2026-11-11" });
  assert.equal(s.status.kind, "upcoming");
  assert.equal(lateCount([s], B), 0);
  const g = todayGroups([s], D("2026-11-11"));
  assert.deepEqual([g.late.length, g.upcoming.length, g.unscheduled.length, g.finished.length], [0, 0, 1, 0]);
});

test("day boundary: 23:59 and 00:01 shares fall on their own day; yesterday's late share is in today's late group", () => {
  const contents = [content("yesterday", "2026-11-10", ["x"]), content("today", "2026-11-11", ["tiktok"])];
  const shares = deriveShares(input({ contents, accounts: accountsAt({ x: "23:59", tiktok: "00:01" }), now: NOW("2026-11-11", "00:00") }));
  const yesterday = shares.find((s) => s.content.id === "yesterday")!;
  const today = shares.find((s) => s.content.id === "today")!;
  assert.deepEqual(yesterday.plannedAt, { kind: "at", at: Date.UTC(2026, 10, 10, 23, 59) });
  assert.deepEqual(today.plannedAt, { kind: "at", at: Date.UTC(2026, 10, 11, 0, 1) });
  assert.equal(yesterday.status.kind, "due");
  assert.equal(today.status.kind, "upcoming");
  const midnight = todayGroups(shares, D("2026-11-11"));
  assert.deepEqual(midnight.upcoming.map((s) => s.content.id), ["yesterday", "today"], "a share due yesterday stays after midnight");
  const later = deriveShares(input({ contents, accounts: accountsAt({ x: "23:59", tiktok: "00:01" }), now: NOW("2026-11-11", "09:00") }));
  const g = todayGroups(later, D("2026-11-11"));
  assert.deepEqual(g.late.map((s) => s.content.id), ["yesterday", "today"]);
});

test("the same content id in two brands: separate shares, one brand's record does not leak", () => {
  const other = { ...content("c1", "2026-11-11", ["x"]), brand: "globex" };
  const shares = deriveShares(input({
    contents: [content("c1", "2026-11-11", ["x"]), other],
    accounts: [account("x", { x: "09:00" }), account("x", { x: "09:00" }, { id: "globex-x" as AccountId, brand: "globex" as BrandId })],
    records: [{ share: C1X, status: "done", at: NOW("2026-11-11", "09:05") }],
    now: NOW("2026-11-11", "14:20"),
  }));
  assert.deepEqual(shares.map((s) => [s.id, s.status.kind]), [["initech/c1/x", "done"], ["globex/c1/x", "late"]]);
});

test("blockers: file-missing when the file is not in the folder, account-missing and no time without an account", () => {
  const s = only(input({ missingFiles: new Set(["initech/c1/main.png"]), accounts: [] }));
  assert.deepEqual(s.blockers, ["file-missing", "account-missing"]);
  assert.equal(s.account, null);
  assert.deepEqual(s.plannedAt, { kind: "unscheduled", date: "2026-11-11" }, "the time belongs to the account; no account, no time");
  assert.deepEqual(only(input({})).blockers, []);
  assert.equal(only(input({})).account?.handle, "@initech");
});

test("account choice: one account on the network ignores language; several match the package language, else none", () => {
  const en = account("instagram", { "instagram-reels": "14:15" }, { id: "initech-ig" as AccountId });
  const tr = account("instagram", { "instagram-reels": "12:00" }, { id: "initech-ig-tr" as AccountId, handle: "@initech.tr", language: "tr" });
  assert.equal(accountFor([en], B, "instagram-reels", "tr"), en, "single account: a Turkish package goes to it too");
  assert.equal(accountFor([en, tr], B, "instagram-reels", "tr"), tr);
  assert.equal(accountFor([tr, en], B, "instagram-post", "en"), en, "posts go to the Instagram account too");
  assert.equal(accountFor([en, { ...tr, language: "en" }], B, "instagram-reels", "tr"), null, "two accounts, both in another language");
  assert.equal(accountFor([en, { ...tr, language: "en" }], B, "instagram-reels", "en"), en, "two accounts in one language: the first in the store");
  assert.equal(accountFor([en], "globex" as BrandId, "instagram-reels", "en"), null, "another brand's account does not count");
  assert.equal(accountFor([en], B, "tiktok", "en"), null, "another network's account does not count");
  const threads = account("threads", {}, { id: "initech-threads" as AccountId });
  assert.deepEqual(FORMATS.map((p) => accountFor([threads], B, p, "en")), FORMATS.map(() => null), "no share goes to a Threads account");

  const shares = deriveShares(input({
    contents: [content("c1", "2026-11-11", ["instagram-reels"]), content("c2", "2026-11-11", ["instagram-reels"], "tr")],
    accounts: [en, tr],
  }));
  assert.deepEqual(shares.map((s) => [s.content.id, s.account?.handle, s.plannedAt]), [
    ["c1", "@initech", { kind: "at", at: NOW("2026-11-11", "14:15") }],
    ["c2", "@initech.tr", { kind: "at", at: NOW("2026-11-11", "12:00") }],
  ]);
});

test("time per format: Reels and posts on one Instagram account get their own times; a format without a time is unscheduled", () => {
  const ig = account("instagram", { "instagram-reels": "14:15", "instagram-post": "11:30" });
  const both = deriveShares(input({ contents: [content("c1", "2026-11-11", ["instagram-reels", "instagram-post"])], accounts: [ig] }));
  assert.deepEqual(both.map((s) => [s.platform, s.plannedAt]), [
    ["instagram-reels", { kind: "at", at: NOW("2026-11-11", "14:15") }],
    ["instagram-post", { kind: "at", at: NOW("2026-11-11", "11:30") }],
  ]);
  const reelsOnly = account("instagram", { "instagram-reels": "14:15" });
  const post = only(input({ contents: [content("c1", "2026-11-11", ["instagram-post"])], accounts: [reelsOnly] }));
  assert.deepEqual([post.account?.id, post.plannedAt.kind, post.blockers], ["initech-instagram", "unscheduled", []]);
});
