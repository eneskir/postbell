import { test } from "node:test";
import assert from "node:assert/strict";
import { readTimeInput, scheduleRows, setTime } from "./schedule.ts";
import type { Account, AccountId, BrandId, Network, Times } from "./shares.ts";
import { emptyStore, parseStoreText, serializeStore, type StoreFile } from "./store.ts";
import { parseTime, type TimeOfDay } from "./time.ts";

const T = (s: string) => parseTime(s) as TimeOfDay;
const initech = "initech" as BrandId;
const acc = (id: string, network: Network, handle: string, language: "en" | "tr", times: Times = {}, brand = initech): Account => ({
  id: id as AccountId,
  brand,
  network,
  handle,
  language,
  times,
});
const store: StoreFile = {
  ...emptyStore(),
  brands: [
    { id: initech, name: "Initech", sticker: "camera", folder: "D:/p" },
    { id: "globex" as BrandId, name: "Globex", sticker: "night", folder: "D:/g" },
  ],
  accounts: [
    acc("p-pin", "pinterest", "@initech", "en", { pinterest: T("20:00") }),
    acc("p-ig-tr", "instagram", "@initech.tr", "tr", { "instagram-reels": T("14:45") }),
    acc("p-threads", "threads", "@initech", "en"),
    acc("p-x", "x", "@initech", "en", { x: T("09:00") }),
    acc("p-ig", "instagram", "@initech", "en", { "instagram-post": T("12:00"), "instagram-reels": T("14:15") }),
    acc("g-x", "x", "@globex", "tr", { x: T("08:00") }, "globex" as BrandId),
  ],
};
const label = (s: StoreFile) => scheduleRows(s, initech).map((r) => `${r.account.handle} ${r.format} ${r.time === null ? "--:--" : r.time}`);

test("rows: network order, store order within a network, the account's formats; no Threads and no other brand", () => {
  assert.deepEqual(label(store), [
    "@initech x 540",
    "@initech.tr instagram-reels 885",
    "@initech.tr instagram-post --:--",
    "@initech instagram-reels 855",
    "@initech instagram-post 720",
    "@initech pinterest 1200",
  ]);
  assert.deepEqual(scheduleRows(store, "missing" as BrandId), []);
});

test("a time is set and cleared and survives the store round trip; no change or a foreign format returns the same store", () => {
  const s1 = setTime(store, "p-ig-tr" as AccountId, "instagram-post", T("12:30"));
  const s2 = setTime(s1, "p-x" as AccountId, "x", null);
  assert.deepEqual(label(s2).slice(0, 3), ["@initech x --:--", "@initech.tr instagram-reels 885", "@initech.tr instagram-post 750"]);
  const back = parseStoreText(serializeStore(s2));
  assert.equal(back.kind, "ready");
  if (back.kind === "ready") assert.deepEqual(label(back.store), label(s2));
  assert.equal(setTime(store, "p-x" as AccountId, "x", T("09:00")), store);
  assert.equal(setTime(store, "p-x" as AccountId, "tiktok", T("10:00")), store);
  assert.equal(setTime(store, "missing" as AccountId, "x", T("10:00")), store);
});

test("typed time: colon or dot, one-digit hour; no error while typing; a finished invalid time is invalid", () => {
  const kind = (t: string) => readTimeInput(t).kind;
  assert.deepEqual(readTimeInput("9:00"), { kind: "time", time: T("09:00") });
  assert.deepEqual(readTimeInput(" 09.30 "), { kind: "time", time: T("09:30") });
  assert.deepEqual(readTimeInput("23:59"), { kind: "time", time: T("23:59") });
  assert.deepEqual(readTimeInput("0:00"), { kind: "time", time: T("00:00") });
  assert.deepEqual(["", "  "].map(kind), ["empty", "empty"]);
  assert.deepEqual(["9", "09", "09:", "09:3", "9:5", "25", "9."].map(kind), Array(7).fill("partial"));
  assert.deepEqual(["25:00", "12:60", "123", "0900", "ab", "9:000", "-1:00"].map(kind), Array(7).fill("invalid"));
});
