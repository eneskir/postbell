import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStart, weekView } from "./calendar.ts";
import { deriveShares, shareIdOf, type Account, type AccountId, type BrandId, type ContentId } from "./shares.ts";
import { testContent } from "./test-content.ts";
import { at, parseDate, parseTime, type LocalDate, type TimeOfDay } from "./time.ts";

const D = (s: string) => parseDate(s) as LocalDate;
const T = (s: string) => parseTime(s) as TimeOfDay;
const P = "initech" as BrandId;
const O = "globex" as BrandId;

const accounts = (brand: BrandId): Account[] => [
  { id: `${brand}-x` as AccountId, brand, network: "x", handle: "@a", language: "en", times: { x: T("09:00") } },
  { id: `${brand}-tiktok` as AccountId, brand, network: "tiktok", handle: "@a", language: "en", times: { tiktok: T("18:30") } },
  { id: `${brand}-pinterest` as AccountId, brand, network: "pinterest", handle: "@a", language: "en", times: {} },
];

const shares = (contents: Parameters<typeof testContent>[0][], records: Parameters<typeof deriveShares>[0]["records"] = []) =>
  deriveShares({
    contents: contents.map(testContent),
    accounts: [...accounts(P), ...accounts(O)],
    records,
    missingFiles: new Set(),
    now: at(D("2026-11-11"), T("14:20")),
  });

test("the week runs Monday to Sunday and holds only the brand's shares of those days", () => {
  const all = shares([
    { id: "mon", date: "2026-11-09", platforms: ["x"] },
    { id: "sun", date: "2026-11-15", platforms: ["tiktok"] },
    { id: "next-mon", date: "2026-11-16", platforms: ["x"] },
    { id: "other", date: "2026-11-11", platforms: ["x"], brand: O },
  ]);
  const v = weekView(all, P, D("2026-11-11"));
  assert.deepEqual(
    v.days.map((d) => [d.date, d.shares.map((s) => s.content.id)]),
    [
      ["2026-11-09", ["mon"]],
      ["2026-11-10", []],
      ["2026-11-11", []],
      ["2026-11-12", []],
      ["2026-11-13", []],
      ["2026-11-14", []],
      ["2026-11-15", ["sun"]],
    ],
  );
  assert.equal(v.total, 2);
});

test("a day's cards sort by time; a share with no time comes last", () => {
  const v = weekView(shares([{ id: "c", date: "2026-11-11", platforms: ["pinterest", "tiktok", "x"] }]), P, D("2026-11-11"));
  assert.deepEqual(v.days[2]!.shares.map((s) => s.platform), ["x", "tiktok", "pinterest"]);
});

test("the summary counts shared and skipped shares as finished", () => {
  const id = (p: "x" | "tiktok" | "pinterest") => shareIdOf(P, "c" as ContentId, p);
  const v = weekView(
    shares([{ id: "c", date: "2026-11-11", platforms: ["x", "tiktok", "pinterest"] }], [
      { share: id("x"), status: "done", at: at(D("2026-11-11"), T("09:05")) },
      { share: id("pinterest"), status: "skipped", at: at(D("2026-11-11"), T("10:00")) },
    ]),
    P,
    D("2026-11-11"),
  );
  assert.deepEqual({ total: v.total, finished: v.finished }, { total: 3, finished: 2 });
});

test("moving by weeks crosses month and year ends on a Monday", () => {
  assert.equal(weekStart(D("2026-11-11"), 0), "2026-11-09");
  assert.equal(weekStart(D("2026-11-11"), 3), "2026-11-30");
  assert.equal(weekStart(D("2026-12-30"), 1), "2027-01-04");
  assert.equal(weekStart(D("2027-01-01"), -1), "2026-12-21");
});
