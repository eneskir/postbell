import { test } from "node:test";
import assert from "node:assert/strict";
import { contrastRatio } from "./contrast.ts";

test("black on white is 21:1, a color on itself 1:1, order does not matter", () => {
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#7a7a7a", "#7a7a7a"), 1);
  assert.equal(contrastRatio("#ffffff", "#000000"), contrastRatio("#000000", "#ffffff"));
});

test("status pairs: success 9.21, warning 9.01, danger 8.14", () => {
  assert.equal(contrastRatio("#86e3ad", "#16301f").toFixed(2), "9.21");
  assert.equal(contrastRatio("#f7cb6b", "#382b10").toFixed(2), "9.01");
  assert.equal(contrastRatio("#ffa59c", "#3b1c19").toFixed(2), "8.14");
});

test("an invalid color throws", () => {
  assert.throws(() => contrastRatio("#fff", "#000000"), /CONTRAST_HEX_INVALID/);
});
