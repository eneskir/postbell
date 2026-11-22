import { test } from "node:test";
import assert from "node:assert/strict";
import { at, dateOf, formatTime, parseDate, parseTime, timeOf, weekOf, type LocalDate, type TimeOfDay } from "./time.ts";

test("time parsing: 09:00 is 540; invalid input is null", () => {
  assert.equal(parseTime("09:00"), 540);
  assert.equal(parseTime("23:59"), 1439);
  for (const bad of ["24:00", "9:00", "09:60", "", "09:00 "]) assert.equal(parseTime(bad), null, bad);
  assert.equal(formatTime(540 as TimeOfDay), "09:00");
});

test("date parsing: a day not in the calendar is null", () => {
  assert.equal(parseDate("2026-11-11"), "2026-11-11");
  assert.equal(parseDate("2026-02-29"), null);
  assert.equal(parseDate("2028-02-29"), "2028-02-29");
});

test("instant and day: 23:59 and 00:01 stay on their own day in local wall-clock time", () => {
  const d = parseDate("2026-11-11") as LocalDate;
  assert.equal(dateOf(at(d, parseTime("23:59") as TimeOfDay)), "2026-11-11");
  assert.equal(dateOf(at(d, parseTime("00:01") as TimeOfDay)), "2026-11-11");
  assert.equal(timeOf(at(d, parseTime("14:20") as TimeOfDay)), 860);
});

test("the week starts on Monday; 11 November 2026 is a Wednesday", () => {
  assert.deepEqual(weekOf(parseDate("2026-11-11") as LocalDate), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  assert.equal(weekOf(parseDate("2026-11-09") as LocalDate)[0], "2026-11-09");
  assert.equal(weekOf(parseDate("2026-11-15") as LocalDate)[6], "2026-11-15");
});
