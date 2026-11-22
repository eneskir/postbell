import { test } from "node:test";
import assert from "node:assert/strict";
import { findOldName } from "./check-name.mjs";

const OLD = ["Br", "iso"].join("");
const BS = String.fromCharCode(92);
const lines = (r) => r.violations.map((v) => `${v.path}:${v.line}`);

test("the old name fails with its location, in any case", () => {
  const r = findOldName([{ path: "docs/a.md", text: `Postbell opens.\n${OLD} opens.\n${OLD.toUpperCase()}` }]);
  assert.deepEqual(lines(r), ["docs/a.md:2", "docs/a.md:3"]);
});

test("a dated line fails too; no file has an exception", () => {
  const r = findOldName([{ path: "contracts/README.md", text: `${OLD} 11.11` }]);
  assert.equal(r.violations.length, 1);
});

test("the old name inside a folder path fails", () => {
  const r = findOldName([{ path: "docs/b.md", text: `Evidence: D:${BS}x${BS}${OLD}${BS}work\n${OLD}'s path` }]);
  assert.deepEqual(lines(r), ["docs/b.md:1", "docs/b.md:2"]);
});

test("the old name in a file name fails", () => {
  const r = findOldName([{ path: `apps/desktop/${OLD.toLowerCase()}.txt`, text: "" }]);
  assert.deepEqual(lines(r), [`apps/desktop/${OLD.toLowerCase()}.txt:0`]);
});
