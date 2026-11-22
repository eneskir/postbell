import { test } from "node:test";
import assert from "node:assert/strict";
import { firstDays, historyView } from "./history.ts";
import { deriveShares, shareIdOf, type Account, type AccountId, type BrandId, type ContentId, type ShareId, type ShareRecord } from "./shares.ts";
import { testContent } from "./test-content.ts";
import { at, parseDate, parseTime, type LocalDate, type TimeOfDay } from "./time.ts";

const D = (s: string) => parseDate(s) as LocalDate;
const T = (s: string) => parseTime(s) as TimeOfDay;
const P = "initech" as BrandId;
const O = "globex" as BrandId;
const NOW = at(D("2026-11-12"), T("14:20"));

const accounts = (brand: BrandId): Account[] => [
  { id: `${brand}-x` as AccountId, brand, network: "x", handle: "@a", language: "en", times: { x: T("09:00") } },
  { id: `${brand}-tiktok` as AccountId, brand, network: "tiktok", handle: "@a", language: "en", times: { tiktok: T("18:30") } },
  { id: `${brand}-pinterest` as AccountId, brand, network: "pinterest", handle: "@a", language: "en", times: {} },
];

const contents = [
  { id: "today", date: "2026-11-12", platforms: ["x", "tiktok"] },
  { id: "yesterday", date: "2026-11-11", platforms: ["tiktok", "x", "pinterest"] },
  { id: "other", date: "2026-11-11", platforms: ["x"], brand: O },
] satisfies Parameters<typeof testContent>[0][];

const id = (content: string, platform: "x" | "tiktok" | "pinterest", brand = P) => shareIdOf(brand, content as ContentId, platform);
const rec = (share: ShareId, status: ShareRecord["status"], when: string): ShareRecord => ({ share, status, at: at(D(when.slice(0, 10)), T(when.slice(11))) });

const view = (records: ShareRecord[], filter: Parameters<typeof historyView>[2] = "all", present = contents) => {
  const shares = deriveShares({ contents: present.map(testContent), accounts: [...accounts(P), ...accounts(O)], records, missingFiles: new Set(), now: NOW });
  return historyView(records, shares, filter);
};

const records = [
  rec(id("today", "x"), "done", "2026-11-12T09:05"),
  rec(id("yesterday", "tiktok"), "skipped", "2026-11-12T08:00"),
  rec(id("yesterday", "x"), "done", "2026-11-11T09:30"),
  rec(id("yesterday", "pinterest"), "done", "2026-11-11T21:00"),
  rec(id("other", "x", O), "done", "2026-11-11T09:10"),
];

test("rows are grouped by planned day, newest first, and sorted by time with no time last", () => {
  const v = view(records);
  assert.deepEqual(
    v.days.map((d) => [d.date, d.rows.map((r) => `${r.brand}/${r.content}/${r.platform}`)]),
    [
      ["2026-11-12", ["initech/today/x"]],
      ["2026-11-11", ["globex/other/x", "initech/yesterday/x", "initech/yesterday/tiktok", "initech/yesterday/pinterest"]],
    ],
  );
  // Skipped this morning but planned yesterday: it stays under yesterday.
  const skipped = v.days[1]!.rows.find((r) => r.status === "skipped")!;
  assert.equal(skipped.markedAt, at(D("2026-11-12"), T("08:00")));
  assert.equal(skipped.time, T("18:30"));
  assert.equal(v.days[1]!.rows[3]!.time, null);
});

test("the filter keeps one status while the counts stay over every record", () => {
  const done = view(records, "done");
  assert.equal(done.days.flatMap((d) => d.rows).length, 4);
  assert.ok(done.days.flatMap((d) => d.rows).every((r) => r.status === "done"));
  const skipped = view(records, "skipped");
  assert.deepEqual(
    skipped.days.map((d) => [d.date, d.rows.length]),
    [["2026-11-11", 1]],
  );
  assert.equal(skipped.total, 5);
  assert.equal(skipped.skipped, 1);
});

test("a record whose package is gone keeps its row under the day it was marked, without title or time", () => {
  const v = view(records, "all", contents.filter((c) => c.id !== "yesterday"));
  const gone = v.days.flatMap((d) => d.rows).filter((r) => r.content === "yesterday");
  assert.equal(gone.length, 3);
  assert.ok(gone.every((r) => r.gone && r.title === null && r.time === null));
  assert.deepEqual(
    gone.map((r) => [r.day, r.platform, r.status]),
    [
      ["2026-11-12", "tiktok", "skipped"],
      ["2026-11-11", "x", "done"],
      ["2026-11-11", "pinterest", "done"],
    ],
  );
  assert.notEqual(v.days.flatMap((d) => d.rows).find((r) => r.content === "today")!.title, null);
});

test("a gone package's record written since store version 2 keeps its title, planned day and time", () => {
  const planned = { kind: "at", at: at(D("2026-11-10"), T("18:30")) } as const;
  const stored = { ...rec(id("yesterday", "tiktok"), "done", "2026-11-11T09:00"), title: "Dün", planned };
  const unscheduled = { ...rec(id("yesterday", "x"), "skipped", "2026-11-11T09:00"), title: "Dün", planned: { kind: "unscheduled", date: D("2026-11-09") } } as const;
  const rows = view([stored, unscheduled], "all", []).days.flatMap((d) => d.rows);
  assert.deepEqual(
    rows.map((r) => [r.gone, r.title, r.day, r.time]),
    [
      [true, "Dün", "2026-11-10", T("18:30")],
      [true, "Dün", "2026-11-09", null],
    ],
  );
});

test("a present package wins over its record's copy, which may be older", () => {
  const old = { ...rec(id("today", "x"), "done", "2026-11-12T09:00"), title: "Old title", planned: { kind: "unscheduled", date: D("2026-11-01") } } as const;
  const row = view([old]).days.flatMap((d) => d.rows)[0]!;
  assert.equal(row.gone, false);
  assert.notEqual(row.title, "Old title");
  assert.equal(row.day, "2026-11-12");
});

test("an unknown platform in a hand-edited record still shows, after the known formats", () => {
  const odd = rec("initech/yesterday/myspace" as ShareId, "done", "2026-11-11T10:00");
  const v = view([odd, rec(id("yesterday", "pinterest"), "done", "2026-11-11T21:00")], "all", []);
  assert.deepEqual(
    v.days[0]!.rows.map((r) => r.platform),
    ["pinterest", null],
  );
});

test("the first page keeps whole days until it reaches the limit and counts the rest", () => {
  const v = view(records);
  assert.deepEqual(
    [firstDays(v.days, 1).days.length, firstDays(v.days, 1).hidden],
    [1, 4],
  );
  assert.deepEqual(
    [firstDays(v.days, 2).days.length, firstDays(v.days, 2).hidden],
    [2, 0],
  );
  assert.deepEqual(firstDays([], 200), { days: [], hidden: 0 });
});

test("no records gives no days", () => {
  const v = view([]);
  assert.deepEqual([v.days.length, v.total, v.skipped], [0, 0, 0]);
});
