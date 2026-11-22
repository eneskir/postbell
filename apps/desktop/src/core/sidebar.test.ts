import { test } from "node:test";
import assert from "node:assert/strict";
import type { BrandId } from "./shares.ts";
import { abbreviations, addGroup, COLLAPSE_BELOW, dropIndex, moveBrand, moveGroup, removeGroup, renameGroup, resetWidth, resize, sidebarOrder, toggleBrand, toggleGroup, ungrouped } from "./sidebar.ts";
import { emptyStore, parseStoreText, serializeStore, type StoreFile } from "./store.ts";

const b = (id: string) => id as BrandId;
const brand = (id: string, name: string) => ({ id: b(id), name, sticker: "camera", folder: `D:/content/${id}` });
const base: StoreFile = {
  ...emptyStore(),
  brands: [brand("initech", "Initech"), brand("gece-dosyasi", "Gece Dosyası"), brand("globex", "Globex")],
};
const ids = (s: StoreFile) => ({ top: ungrouped(s).map((x) => x.id), groups: s.groups.map((g) => [g.id, ...g.brands]) });

test("sidebar order: ungrouped brands in store order, then groups in order", () => {
  assert.deepEqual(sidebarOrder(base).map((x) => x.id), ["initech", "gece-dosyasi", "globex"]);
  const { store: withGroup, id } = addGroup(base, "Müşteri A");
  const s = moveBrand(moveBrand(withGroup, b("globex"), { group: id, index: 0 }), b("initech"), { group: id, index: 1 });
  assert.deepEqual(sidebarOrder(s).map((x) => x.id), ["gece-dosyasi", "globex", "initech"]);
});

test("width: clamps to 224-280, collapses below 136 keeping the last width, double click gives 240", () => {
  const s = emptyStore().sidebar;
  assert.equal(COLLAPSE_BELOW, 136);
  assert.deepEqual([300, 251.6, 224, 200, 136].map((w) => resize(s, w).width), [280, 252, 224, 224, 224]);
  const wide = resize(s, 270);
  assert.deepEqual(resize(wide, 135), { ...wide, collapsed: true });
  assert.deepEqual(resize(resize(wide, 135), 150), { ...wide, collapsed: false, width: 224 });
  assert.deepEqual(resetWidth({ ...wide, collapsed: true }), { ...wide, collapsed: false, width: 240 });
});

test("group abbreviation in the narrow menu: sample names and Turkish casing", () => {
  const cases: Array<[string[], string[]]> = [
    [["Müşteri A"], ["MA"]],
    [["Müşteri Ayva", "Müşteri Ağa"], ["MAy", "MAğ"]],
    [["Müşteri A", "Mahmut A"], ["MüA", "MaA"]],
    [["Pictures", "Pizza"], ["Pic", "Piz"]],
    [["Müşteri A", "Müşteri Ayva"], ["MA", "MAy"]],
    [["istanbul işleri", "İzmir İşleri"], ["İsİ", "İzİ"]],
    [["Denemeler", "  ılık   sular "], ["De", "IS"]],
  ];
  for (const [names, expected] of cases) assert.deepEqual(abbreviations(names), expected, names.join(" / "));
});

test("add, rename and toggle groups: id from the name and unique, an empty name keeps the old one", () => {
  const one = addGroup(base, "  Müşteri   A ");
  const two = addGroup(one.store, "Müşteri A");
  assert.deepEqual([one.id, two.id], ["musteri-a", "musteri-a-2"]);
  assert.deepEqual(two.store.groups[0], { id: "musteri-a", name: "Müşteri A", open: true, brands: [] });
  assert.equal(addGroup(base, "   ").store.groups[0]?.name, "Yeni grup");
  assert.equal(addGroup(base, "!!!").id, "grup");
  assert.equal(renameGroup(two.store, "musteri-a", "  ").groups[0]?.name, "Müşteri A");
  assert.equal(renameGroup(two.store, "musteri-a", "Müşteri B").groups[0]?.name, "Müşteri B");
  assert.equal(toggleGroup(two.store, "musteri-a").groups[0]?.open, false);
  assert.deepEqual(toggleBrand(toggleBrand(base, b("globex")), b("initech")).sidebar.openBrands, ["globex", "initech"]);
  assert.deepEqual(toggleBrand(toggleBrand(base, b("globex")), b("globex")).sidebar.openBrands, []);
});

test("moving brands and groups; deleting a group returns its brands to the top, brand count unchanged", () => {
  const g = addGroup(addGroup(base, "Müşteri A").store, "Müşteri B").store;
  let s = moveBrand(g, b("gece-dosyasi"), { group: "musteri-a", index: 0 });
  s = moveBrand(s, b("initech"), { group: "musteri-a", index: 0 });
  assert.deepEqual(ids(s), { top: ["globex"], groups: [["musteri-a", "initech", "gece-dosyasi"], ["musteri-b"]] });
  s = moveBrand(s, b("initech"), { group: "musteri-b", index: 9 });
  assert.deepEqual(ids(s).groups, [["musteri-a", "gece-dosyasi"], ["musteri-b", "initech"]]);
  s = moveBrand(s, b("initech"), { group: null, index: 0 });
  assert.deepEqual(ids(s), { top: ["initech", "globex"], groups: [["musteri-a", "gece-dosyasi"], ["musteri-b"]] });
  s = moveBrand(s, b("globex"), { group: null, index: 0 });
  assert.deepEqual(ids(s).top, ["globex", "initech"]);
  assert.deepEqual(moveGroup(s, "musteri-b", 0).groups.map((x) => x.id), ["musteri-b", "musteri-a"]);
  const removed = removeGroup(s, "musteri-a");
  assert.equal(removed.brands.length, 3);
  assert.deepEqual(ids(removed), { top: ["globex", "initech", "gece-dosyasi"], groups: [["musteri-b"]] });
  for (const x of [g, s, removed, moveGroup(s, "musteri-b", 0)]) assert.equal(parseStoreText(serializeStore(x)).kind, "ready");
});

test("drag and drop index: a boundary maps to the list without the item; its own gaps do not move it", () => {
  assert.equal(dropIndex(null, 2), 2);
  assert.equal(dropIndex(1, 1), null);
  assert.equal(dropIndex(1, 2), null);
  assert.equal(dropIndex(1, 3), 2);
  assert.equal(dropIndex(3, 0), 0);
  const at = dropIndex(0, 3);
  assert.equal(at, 2);
  assert.deepEqual(ids(moveBrand(base, b("initech"), { group: null, index: at ?? -1 })).top, ["gece-dosyasi", "globex", "initech"]);
  const three = ["A", "B", "C"].reduce((x, n) => addGroup(x, n).store, base);
  assert.deepEqual(moveGroup(three, "c", dropIndex(2, 0) ?? -1).groups.map((x) => x.id), ["c", "a", "b"]);
  assert.deepEqual(moveGroup(three, "a", dropIndex(0, 2) ?? -1).groups.map((x) => x.id), ["b", "a", "c"]);
});
