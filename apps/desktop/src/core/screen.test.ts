import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStore } from "./screen.ts";
import { emptyStore, serializeStore } from "./store.ts";
import type { BrandId } from "./shares.ts";

const ok = (text: string | null) => ({ ok: true as const, value: { text } });

test("no store file or no brands gives the empty state with a writable store", () => {
  assert.deepEqual(loadStore(ok(null)), { screen: { kind: "empty" }, store: emptyStore() });
  const narrow = { ...emptyStore(), sidebar: { collapsed: true, width: 260, openBrands: [] } };
  assert.deepEqual(loadStore(ok(serializeStore(narrow))), { screen: { kind: "empty" }, store: narrow });
});

test("a store with brands is ready with the parsed store", () => {
  const store = { ...emptyStore(), brands: [{ id: "initech" as BrandId, name: "Initech", sticker: "camera", folder: "D:/p" }] };
  const s = loadStore(ok(serializeStore(store)));
  assert.deepEqual(s, { screen: { kind: "ready", value: store }, store });
});

test("broken, newer and shell errors give an error code and no store to write", () => {
  assert.deepEqual(loadStore(ok("{broken")), { screen: { kind: "error", code: "store-unreadable" }, store: null });
  assert.deepEqual(loadStore(ok('{"version": 4}')), { screen: { kind: "error", code: "store-newer-version" }, store: null });
  assert.deepEqual(loadStore({ ok: false, error: { code: "store-read", detail: "access denied" } }), { screen: { kind: "error", code: "store-read" }, store: null });
});
