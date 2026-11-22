import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSchema, typeOf } from "./contract.mjs";

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
