import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { report } from "./manifest-report.mjs";
import { checkSchema, typeOf } from "./contract.mjs";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "contracts", "fixtures");

const EXPECTED = {
  "globex/2026-11-12/gizli-kopek": "parsed",
  "globex/2026-11-13/yesil-gok": "parsed",
  "globex/2026-11-14/missing-file": "parsed",
  "initech/2026-11-12/hidden-dog": "parsed",
  "initech/2026-11-13/green-sky": "parsed",
  "initech/2026-11-14/signature": "parsed",
  "initech/2026-11-15/missing-title": "invalid-shape title (required)",
  "initech/2026-11-15/version-2": "unknown-version 2",
  "initech/2026-11-16/invalid-json": "invalid-json",
  "initech/2026-11-16/not-approved": "not-approved pending",
};

test("every fixture package gives the expected result", () => {
  const rows = report(FIXTURES);
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.name, r.result])), EXPECTED);
});

test("a package with a missing file parses and names the file; the others miss nothing", () => {
  const rows = report(FIXTURES).filter((r) => r.result === "parsed");
  assert.deepEqual(rows.filter((r) => r.missing.length).map((r) => [r.name, r.missing]), [["globex/2026-11-14/missing-file", ["images/detail-1x1.png"]]]);
  assert.deepEqual([...new Set(rows.map((r) => r.brand))].sort(), ["globex", "initech"]);
  assert.deepEqual([...new Set(rows.map((r) => r.date))].sort(), ["2026-11-12", "2026-11-13", "2026-11-14"]);
});

test("the contract generator never silently skips a rule it does not support", () => {
  assert.throws(() => checkSchema({ type: "object", additionalProperties: false, properties: { a: { type: "string", format: "uri" } } }), /CONTRACT_KEYWORD: \$\.a\.format/);
  assert.throws(() => checkSchema({ type: "object", properties: {} }), /CONTRACT_OPEN_OBJECT/);
  assert.throws(() => checkSchema({ type: "object", additionalProperties: false, required: ["b"], properties: {} }), /CONTRACT_REQUIRED_UNKNOWN/);
  assert.throws(() => checkSchema({ type: "array" }), /CONTRACT_ARRAY_ITEMS/);
});

test("type from schema: a required field has no question mark, an optional one has", () => {
  const t = typeOf({ type: "object", additionalProperties: false, required: ["a"], properties: { a: { enum: ["x", "y"] }, b: { type: "integer" } } });
  assert.match(t, /readonly a: "x" \| "y";/);
  assert.match(t, /readonly b\?: number;/);
});
