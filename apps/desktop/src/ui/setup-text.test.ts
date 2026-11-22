import { test } from "node:test";
import assert from "node:assert/strict";
import { dative, text } from "./text.ts";

test("dative suffix on a number follows the last word of how it is read", () => {
  const cases: [number, string][] = [
    [0, "a"], [1, "e"], [2, "ye"], [3, "e"], [4, "e"], [5, "e"], [6, "ya"], [7, "ye"], [8, "e"], [9, "a"],
    [10, "a"], [20, "ye"], [30, "a"], [40, "a"], [50, "ye"], [60, "a"], [70, "e"], [80, "e"], [90, "a"],
    [11, "e"], [100, "e"], [1000, "e"], [2_000_000, "a"],
  ];
  for (const [n, s] of cases) assert.equal(dative(n), s, String(n));
});

test("setup texts: version suffix, known and unknown error code", () => {
  assert.equal(text.setup.updateLine("0.1.1"), "0.1.1'e güncellenir. Markaların ve kayıtların yerinde kalır.");
  assert.equal(text.setup.updateLine("0.2.0"), "0.2.0'a güncellenir. Markaların ve kayıtların yerinde kalır.");
  assert.equal(text.setup.updateTitle(""), "Postbell'in eski bir sürümü kurulu");
  assert.deepEqual(text.setup.error(false, "SETUP_APP_RUNNING"), { title: "Postbell kapanmadı", line: "Postbell'i kapatıp yeniden dene. (SETUP_APP_RUNNING)" });
  assert.equal(text.setup.error(true, "SETUP_FAILED").title, "Kaldırma tamamlanmadı");
  assert.equal(text.setup.error(false, "SETUP_FAILED").title, "Kurulum tamamlanmadı");
});
