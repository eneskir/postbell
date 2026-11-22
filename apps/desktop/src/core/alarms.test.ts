import { test } from "node:test";
import assert from "node:assert/strict";
import { alarmsOf, DEFAULT_NOTIFY, REMINDER_INTERVALS } from "./alarms.ts";
import { parseManifest, type Content } from "./manifest.ts";
import { deriveShares, fileKeyOf, shareIdOf, type Account, type AccountId, type BrandId, type ContentId, type ShareRecord } from "./shares.ts";
import { at, formatLocal, parseDate, parseTime, type LocalDate, type LocalMs, type TimeOfDay } from "./time.ts";

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
  { id: `${brand}-ig` as AccountId, brand, network: "instagram", handle: "@a", language: "en", times: { "instagram-reels": T("09:00") } },
  { id: `${brand}-tiktok` as AccountId, brand, network: "tiktok", handle: "@a", language: "en", times: { tiktok: T("18:30") } },
  { id: `${brand}-pinterest` as AccountId, brand, network: "pinterest", handle: "@a", language: "en", times: {} },
];

const shares = (contents: readonly Content[], now: LocalMs, records: readonly ShareRecord[] = []) =>
  deriveShares({ contents, accounts: [...accounts(P), ...accounts(O)], records, missingFiles: new Set(), now });

const view = (list: ReturnType<typeof alarmsOf>) => list.map((a) => `${formatLocal(a.at)} ${a.id} +${a.lateBy}`);

test("a timed pending share gives two alarms: on time and one reminder interval later", () => {
  const all = shares([content(P, "today", "2026-11-12", ["tiktok"])], NOW("2026-11-12", "14:20"));
  assert.deepEqual(view(alarmsOf(all, [P], DEFAULT_NOTIFY)), [
    "2026-11-12T18:30 initech/today/tiktok#due +0",
    "2026-11-12T19:00 initech/today/tiktok#reminder +30",
  ]);
});

test("a share whose file is missing still gives both alarms, so its time is not missed", () => {
  const missingFiles = new Set([fileKeyOf(P, "today" as ContentId, "main.png")]);
  const all = deriveShares({ contents: [content(P, "today", "2026-11-12", ["tiktok"])], accounts: accounts(P), records: [], missingFiles, now: NOW("2026-11-12", "14:20") });
  assert.ok(all[0]!.blockers.includes("file-missing"));
  assert.deepEqual(view(alarmsOf(all, [P], DEFAULT_NOTIFY)), [
    "2026-11-12T18:30 initech/today/tiktok#due +0",
    "2026-11-12T19:00 initech/today/tiktok#reminder +30",
  ]);
});

test("shared, skipped and untimed shares give no alarms", () => {
  const all = shares(
    [content(P, "today", "2026-11-12", ["x", "instagram-reels", "tiktok", "pinterest"])],
    NOW("2026-11-12", "08:00"),
    [
      { share: shareIdOf(P, "today" as ContentId, "x"), status: "done", at: NOW("2026-11-12", "07:50") },
      { share: shareIdOf(P, "today" as ContentId, "tiktok"), status: "skipped", at: NOW("2026-11-12", "07:55") },
    ],
  );
  assert.deepEqual(
    alarmsOf(all, [P], DEFAULT_NOTIFY).map((a) => a.id),
    ["initech/today/instagram-reels#due", "initech/today/instagram-reels#reminder"],
  );
});

test("notifications off gives an empty list", () => {
  const all = shares([content(P, "today", "2026-11-12", ["x", "tiktok"])], NOW("2026-11-12", "08:00"));
  assert.ok(alarmsOf(all, [P], DEFAULT_NOTIFY).length > 0);
  assert.deepEqual(alarmsOf(all, [P], { ...DEFAULT_NOTIFY, enabled: false }), []);
});

test("the reminder comes once, that many minutes after the planned time, for every option", () => {
  const all = shares([content(P, "today", "2026-11-12", ["x"])], NOW("2026-11-12", "08:00"));
  const got = REMINDER_INTERVALS.map((remindAfter) => view(alarmsOf(all, [P], { enabled: true, remindAfter }).filter((a) => a.kind === "reminder")));
  assert.deepEqual(got, [
    ["2026-11-12T09:15 initech/today/x#reminder +15"],
    ["2026-11-12T09:30 initech/today/x#reminder +30"],
    ["2026-11-12T10:00 initech/today/x#reminder +60"],
    ["2026-11-12T11:00 initech/today/x#reminder +120"],
  ]);
});

test("the list does not depend on now: past and late shares keep their alarms (the shell skips the past)", () => {
  const contents = [content(P, "yesterday", "2026-11-11", ["x"])];
  const morning = alarmsOf(shares(contents, NOW("2026-11-11", "08:00")), [P], DEFAULT_NOTIFY);
  const nextDay = alarmsOf(shares(contents, NOW("2026-11-12", "14:20")), [P], DEFAULT_NOTIFY);
  assert.deepEqual(nextDay, morning);
  assert.equal(nextDay.length, 2);
});

test("equal times sort by brand order, then format order; a brand not in the list gives no alarms", () => {
  const all = shares(
    [content(O, "o1", "2026-11-12", ["x", "instagram-reels"]), content(P, "p1", "2026-11-12", ["instagram-reels", "x"])],
    NOW("2026-11-12", "08:00"),
  );
  const due = (brands: readonly BrandId[]) => alarmsOf(all, brands, DEFAULT_NOTIFY).filter((a) => a.kind === "due").map((a) => a.id);
  assert.deepEqual(due([P, O]), ["initech/p1/x#due", "initech/p1/instagram-reels#due", "globex/o1/x#due", "globex/o1/instagram-reels#due"]);
  assert.deepEqual(due([O, P]).slice(0, 2), ["globex/o1/x#due", "globex/o1/instagram-reels#due"]);
  assert.deepEqual(due([P]), ["initech/p1/x#due", "initech/p1/instagram-reels#due"]);
});
