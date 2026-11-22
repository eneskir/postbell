import { test } from "node:test";
import assert from "node:assert/strict";
import { collect, assetPath } from "./figma-import.mjs";

test("a missing part or a missing SVG fails", () => {
  const meta = (part) => `META ${JSON.stringify({ part, parts: 2, names: ["icon/nav/home", "logo/postbell/mark"] })}`;
  const tokens = `TOKENS ${JSON.stringify({ variables: [], textStyles: [] })}`;
  const a = [meta(0), tokens, "SVG icon/nav/home <svg/>"];
  const b = [meta(1), "SVG logo/postbell/mark <svg/>"];
  assert.equal(collect([a, b]).svgs.size, 2);
  assert.throws(() => collect([a]), /EXPORT_PART_MISSING/);
  assert.throws(() => collect([a, [meta(1)]]), /EXPORT_SVG_SET/);
});

test("a Figma name maps to its asset folder; an unknown group fails", () => {
  assert.deepEqual(assetPath("icon/brand/coffee-cup-1"), { dir: "brand", file: "coffee-cup-1.svg" });
  assert.throws(() => assetPath("icon/other/x"), /FIGMA_NAME_UNKNOWN/);
});
