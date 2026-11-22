import { test } from "node:test";
import assert from "node:assert/strict";
import { addBrand, brandIdFor, brandProblems, removeBrand, updateBrand, type BrandDraft } from "./brands.ts";
import type { AccountId, BrandId, ShareId } from "./shares.ts";
import { ungrouped } from "./sidebar.ts";
import { emptyStore, parseStoreText, serializeStore, type StoreFile } from "./store.ts";

const b = (id: string) => id as BrandId;
const base: StoreFile = {
  ...emptyStore(),
  brands: [
    { id: b("initech"), name: "Initech", sticker: "camera", folder: "D:/content/initech" },
    { id: b("igdir"), name: "Iğdır Haber", sticker: "night", folder: "D:/content/igdir" },
  ],
  groups: [{ id: "musteri-a", name: "Müşteri A", open: true, brands: [b("igdir")] }],
};
const draft = (over: Partial<BrandDraft>): BrandDraft => ({ name: "Street History", sticker: "crown", folder: "D:\\Content\\street-history", ...over });
const codes = (s: StoreFile, d: BrandDraft) => brandProblems(s, d).map((p) => `${p.field}:${p.code}`);

test("problems: empty name and no folder; spaces only count as empty", () => {
  assert.deepEqual(codes(base, draft({ name: "", folder: null })), ["name:empty", "folder:missing"]);
  assert.deepEqual(codes(base, draft({ name: "   ", folder: "  " })), ["name:empty", "folder:missing"]);
  assert.deepEqual(codes(base, draft({})), []);
});

test("problems: same name ignoring case, spaces and dotted or dotless i", () => {
  assert.deepEqual(codes(base, draft({ name: " INITECH " })), ["name:taken"]);
  assert.deepEqual(codes(base, draft({ name: "ığdır  haber" })), ["name:taken"]);
  assert.deepEqual(codes(base, draft({ name: "İğdır Haber" })), ["name:taken"]);
  assert.deepEqual(codes(base, draft({ name: "Iğdır Gazete" })), []);
});

test("problems: a folder read by another brand names it; separators, case and a trailing separator do not matter", () => {
  assert.deepEqual(brandProblems(base, draft({ folder: "d:\\Content\\Initech\\" })), [{ field: "folder", code: "taken", by: "Initech" }]);
  assert.deepEqual(codes(base, draft({ folder: "D:/content/initech-backup" })), []);
});

test("id comes from the folder name (the packages' brand key), else the name; a taken id gets a number", () => {
  assert.equal(brandIdFor(base, "D:\\Content\\street-history", "Street History"), "street-history");
  assert.equal(brandIdFor(base, "D:/İçerik/Gece Dosyası/", "Other Name"), "gece-dosyasi");
  assert.equal(brandIdFor(base, "D:\\___", "Şiir Defteri"), "siir-defteri");
  assert.equal(brandIdFor(base, "E:\\backup\\initech", "Initech Second"), "initech-2");
});

test("add: goes last among ungrouped brands; name cleaned, sticker and folder stored, store stays readable", () => {
  const r = addBrand(base, draft({ name: "  Street   History " }));
  assert.ok(r.ok);
  assert.equal(r.id, "street-history");
  assert.deepEqual(r.store.brands.at(-1), { id: "street-history", name: "Street History", sticker: "crown", folder: "D:\\Content\\street-history" });
  assert.deepEqual(ungrouped(r.store).map((x) => x.id), ["initech", "street-history"]);
  assert.deepEqual(r.store.groups, base.groups);
  const back = parseStoreText(serializeStore(r.store));
  assert.deepEqual(back, { kind: "ready", store: r.store });
});

test("add: from a group's + button goes last in that group; a deleted group falls back to ungrouped", () => {
  const r = addBrand(base, draft({}), "musteri-a");
  assert.ok(r.ok);
  assert.deepEqual(r.store.groups[0]?.brands, ["igdir", "street-history"]);
  assert.deepEqual(ungrouped(r.store).map((x) => x.id), ["initech"]);
  const gone = addBrand(base, draft({}), "deleted-group");
  assert.ok(gone.ok);
  assert.deepEqual(ungrouped(gone.store).map((x) => x.id), ["initech", "street-history"]);
});

test("add: problems leave the store unchanged and are returned", () => {
  const r = addBrand(base, draft({ name: "initech", folder: null }));
  assert.deepEqual(r, { ok: false, problems: [{ field: "name", code: "taken" }, { field: "folder", code: "missing" }] });
});

test("settings: the brand's own name and folder do not clash; another brand's do", () => {
  assert.deepEqual(brandProblems(base, draft({ name: "initech", folder: "D:/content/initech" }), b("initech")), []);
  assert.deepEqual(codes(base, draft({ name: "initech", folder: "D:/content/initech" })), ["name:taken", "folder:taken"]);
  const r = updateBrand(base, b("initech"), { name: "  İğdır  haber " });
  assert.deepEqual(r.ok ? [] : r.problems, [{ field: "name", code: "taken" }]);
});

test("settings: name cleaned, sticker and folder change, id stays; no change returns the same store", () => {
  const r = updateBrand(base, b("initech"), { name: "  Initech   Studio ", sticker: "rocket", folder: " E:/archive/initech " });
  assert.ok(r.ok);
  assert.deepEqual(r.store.brands[0], { id: "initech", name: "Initech Studio", sticker: "rocket", folder: "E:/archive/initech" });
  assert.equal(r.store.brands[1], base.brands[1]);
  const same = updateBrand(base, b("initech"), { name: "Initech", sticker: "camera" });
  assert.ok(same.ok && same.store === base);
  const empty = updateBrand(base, b("initech"), { name: "  " });
  assert.deepEqual(empty.ok ? [] : empty.problems, [{ field: "name", code: "empty" }]);
});

test("settings: only changed fields are checked (an old clash in a hand-edited store does not block a sticker change)", () => {
  const twin: StoreFile = { ...base, brands: [...base.brands, { id: b("twin"), name: "Initech", sticker: "tv", folder: "D:/content/initech" }] };
  const r = updateBrand(twin, b("twin"), { sticker: "fire" });
  assert.ok(r.ok);
  assert.equal(r.store.brands[2]?.sticker, "fire");
});

test("remove: the brand, its group slot, accounts, share records and open state go; the rest stays", () => {
  const s: StoreFile = {
    ...base,
    accounts: [
      { id: "p-x" as AccountId, brand: b("initech"), network: "x", handle: "@initech", language: "en", times: {} },
      { id: "i-x" as AccountId, brand: b("igdir"), network: "x", handle: "@igdir", language: "tr", times: {} },
    ],
    records: [
      { share: "initech/hidden-dog/x" as ShareId, status: "done", at: 0 as never },
      { share: "initech-2/a/x" as ShareId, status: "done", at: 0 as never },
      { share: "igdir/a/x" as ShareId, status: "skipped", at: 0 as never },
    ],
    sidebar: { ...base.sidebar, openBrands: [b("initech"), b("igdir")] },
    lastPage: { kind: "brand", brand: b("initech"), page: "calendar" },
  };
  const before = structuredClone(s);
  const igdirGone = removeBrand(s, b("igdir"));
  assert.deepEqual(igdirGone.groups, [{ id: "musteri-a", name: "Müşteri A", open: true, brands: [] }]);
  assert.deepEqual(igdirGone.lastPage, s.lastPage, "another brand's page stays the last page");
  const r = removeBrand(s, b("initech"));
  assert.deepEqual(r.brands.map((x) => x.id), ["igdir"]);
  assert.deepEqual(r.accounts.map((x) => x.id), ["i-x"]);
  assert.deepEqual(r.records.map((x) => x.share), ["initech-2/a/x", "igdir/a/x"]);
  assert.deepEqual(r.sidebar.openBrands, ["igdir"]);
  assert.deepEqual(r.lastPage, { kind: "home" }, "the removed brand's page is no longer the last page");
  assert.equal(removeBrand(s, b("missing")), s);
  assert.deepEqual(s, before);
  assert.equal(parseStoreText(serializeStore(r)).kind, "ready");
});
