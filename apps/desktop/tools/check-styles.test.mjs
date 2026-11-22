import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCss, checkTs } from "./check-styles.mjs";

const rules = (src) => checkCss(src).map((v) => v.rule);

test("styles written with tokens pass", () => {
  assert.deepEqual(rules(".a {\n  color: var(--color-text);\n  gap: var(--space-m);\n  font: var(--text-body);\n  border: 1px solid var(--color-border);\n}"), []);
});

test("raw color fails: hex, function and name", () => {
  assert.deepEqual(rules(".a {\n  color: #ffa59c;\n  background: rgb(0 0 0);\n  border-color: white;\n}"), ["raw color", "raw color", "raw color"]);
});

test("off-scale size fails, 0-2 px pass, an exemption with a reason passes", () => {
  assert.deepEqual(rules(".a {\n  padding: 10px;\n  margin: 1rem;\n  outline: 2px solid var(--color-text);\n  max-width: 880px; /* off-token: rule 7 */\n}"), ["off-scale size", "off-scale size"]);
});

test("untokened type value fails", () => {
  assert.deepEqual(rules(".a {\n  font-size: 14px;\n  font-weight: 600;\n}"), ["untokened type", "off-scale size", "untokened type"]);
});

test("@font-face, comments and variable definitions are not checked", () => {
  assert.deepEqual(rules("/* #fff\n  10px */\n@font-face {\n  font-weight: 100 900;\n}\n:root {\n  --x: #fff;\n}"), []);
});

test("quoted raw color in TS fails, an id selector passes", () => {
  assert.equal(checkTs('const c = "#ffa59c";').length, 1);
  assert.equal(checkTs('document.getElementById("root");\nquerySelector("#root")').length, 0);
});
