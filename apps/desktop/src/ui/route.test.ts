import { test } from "node:test";
import assert from "node:assert/strict";
import type { AccountId, BrandId, ContentKey, ShareId } from "../core/shares.ts";
import { BRAND_PAGES, HOME, rowPick, sameRoute, viewOf, type PanelState, type Route } from "./route.ts";

const initech = "initech" as BrandId;
const other = "globex" as BrandId;
const names = (id: BrandId) => (id === initech ? { name: "Initech", sticker: "camera" as const } : { name: "Globex", sticker: "night" as const });

const ALL: Route[] = [
  HOME,
  { kind: "history" },
  { kind: "settings" },
  { kind: "brand-new" },
  { kind: "brand-new", group: "musteri-a" },
  ...BRAND_PAGES.map((page): Route => ({ kind: "brand", brand: initech, page })),
  { kind: "brand-settings", brand: initech },
];

test("a brand page's breadcrumb is «Brand / Page», a general page's only the page name; each item has its icon on the left", () => {
  assert.deepEqual(viewOf({ kind: "brand", brand: initech, page: "today" }, names).crumbs, [
    { label: "Initech", sticker: "camera" },
    { label: "Bugün", icon: "today" },
  ]);
  assert.deepEqual(viewOf({ kind: "brand", brand: initech, page: "accounts" }, names).crumbs, [
    { label: "Initech", sticker: "camera" },
    { label: "Hesaplar", icon: "accounts" },
  ]);
  assert.deepEqual(viewOf({ kind: "brand-settings", brand: initech }, names).crumbs, [
    { label: "Initech", sticker: "camera" },
    { label: "Marka ayarları", icon: "settings" },
  ]);
  assert.deepEqual(viewOf(HOME, names).crumbs, [{ label: "Ana sayfa", icon: "home" }]);
  assert.deepEqual(viewOf({ kind: "history" }, names).crumbs, [{ label: "Geçmiş", icon: "history" }]);
});

test("every page has a name; the name is the last breadcrumb item", () => {
  for (const r of ALL) {
    const v = viewOf(r, names);
    assert.ok(v.title.length > 0, r.kind);
    assert.equal(v.crumbs.at(-1)?.label, v.title);
  }
});

test("only the calendar fills the main area; brand pages carry the brand", () => {
  for (const r of ALL) {
    const v = viewOf(r, names);
    assert.equal(v.grid, r.kind === "brand" && r.page === "calendar", JSON.stringify(r));
    assert.equal(v.brand, r.kind === "brand" || r.kind === "brand-settings" ? initech : null);
  }
});

test("a route equals only itself", () => {
  ALL.forEach((a, i) => ALL.forEach((b, j) => assert.equal(sameRoute(a, b), i === j, `${JSON.stringify(a)} ~ ${JSON.stringify(b)}`)));
  assert.equal(sameRoute({ kind: "brand", brand: initech, page: "today" }, { kind: "brand", brand: other, page: "today" }), false);
});

test("pressing the open row again closes the panel, another row opens; the general «Add account» form matches no row", () => {
  const share = (id: string): PanelState => ({ kind: "share", share: id as ShareId });
  const account = (id: string): PanelState => ({ kind: "account", account: id as AccountId });
  const missing = (network: "x" | "instagram", language: "en" | "tr", row: boolean): PanelState => ({
    kind: "account-new",
    draft: { network, handle: "", language },
    row: row ? { languageShown: true } : null,
  });
  const closed: PanelState = { kind: "closed" };
  assert.deepEqual(rowPick(share("a"), share("a")), closed);
  assert.deepEqual(rowPick(share("a"), share("b")), share("b"));
  assert.deepEqual(rowPick(closed, share("a")), share("a"));
  assert.deepEqual(rowPick(account("a"), account("a")), closed);
  assert.deepEqual(rowPick(account("a"), share("a")), share("a"));
  const content = (id: string): PanelState => ({ kind: "content", content: id as ContentKey });
  assert.deepEqual(rowPick(content("a"), content("a")), closed);
  assert.deepEqual(rowPick(content("a"), content("b")), content("b"));
  assert.deepEqual(rowPick(missing("x", "en", true), missing("x", "en", true)), closed);
  assert.deepEqual(rowPick(missing("x", "en", true), missing("x", "tr", true)), missing("x", "tr", true));
  assert.deepEqual(rowPick(missing("x", "en", false), missing("x", "en", true)), missing("x", "en", true));
});