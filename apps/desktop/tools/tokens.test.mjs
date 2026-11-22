import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTokenFile, renderCss, renderTs } from "./tokens.mjs";

const raw = {
  variables: [
    { name: "color/bg", type: "COLOR", value: "#191919" },
    { name: "color/sample/brand-1", type: "COLOR", value: "#e0b354" },
    { name: "space/2xs", type: "FLOAT", value: 4 },
  ],
  textStyles: [{ name: "text/body", family: "Inter", style: "Regular", size: 14, lineHeight: 20 }],
};

test("Figma names map one to one to CSS variables", () => {
  const css = renderCss(parseTokenFile(raw));
  assert.match(css, /--color-bg: #191919;/);
  assert.match(css, /--color-sample-brand-1: #e0b354;/);
  assert.match(css, /--space-2xs: 4px;/);
  assert.match(css, /--text-body: 400 14px \/ 20px "Inter", sans-serif;/);
});

test("an unknown kind, name or weight fails at the boundary", () => {
  assert.throws(() => parseTokenFile({ ...raw, variables: [{ name: "shadow/x", type: "FLOAT", value: 1 }] }), /TOKENS_NAME/);
  assert.throws(() => parseTokenFile({ ...raw, variables: [{ name: "color/bg", type: "FLOAT", value: 1 }] }), /TOKENS_TYPE/);
  assert.throws(() => parseTokenFile({ ...raw, textStyles: [{ ...raw.textStyles[0], style: "Thin" }] }), /TOKENS_TEXT_STYLE/);
});

test("the asset list becomes typed objects; an empty group is an error", () => {
  const ts = renderTs({ nav: ["home"], brand: ["coffee-cup-1"], empty: ["whirl-3"], logo: ["sticker"] });
  assert.match(ts, /import brandCoffeeCup1 from "\.\/assets\/brand\/coffee-cup-1\.svg";/);
  assert.match(ts, /import navHome from "\.\/assets\/nav\/home\.svg\?inline";/);
  assert.match(ts, /export type StickerName = keyof typeof stickers;/);
  assert.throws(() => renderTs({ nav: [], brand: ["a"], empty: ["b"], logo: ["c"] }), /ASSETS_EMPTY/);
});
