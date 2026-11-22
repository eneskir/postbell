import { test } from "node:test";
import assert from "node:assert/strict";
import { isRefreshKey, type KeyLike } from "./refresh-keys.ts";

const key = (k: string, mods: Partial<Omit<KeyLike, "key">> = {}): KeyLike => ({ key: k, ctrlKey: false, altKey: false, ...mods });

test("F5, Ctrl+F5, Shift+F5 and the refresh key are refresh", () => {
  assert.equal(isRefreshKey(key("F5")), true);
  assert.equal(isRefreshKey(key("F5", { ctrlKey: true })), true);
  assert.equal(isRefreshKey(key("BrowserRefresh")), true);
});

test("Ctrl+R and Ctrl+Shift+R are refresh (uppercase too)", () => {
  assert.equal(isRefreshKey(key("r", { ctrlKey: true })), true);
  assert.equal(isRefreshKey(key("R", { ctrlKey: true })), true);
});

test("typing and other shortcuts pass through", () => {
  assert.equal(isRefreshKey(key("r")), false);
  assert.equal(isRefreshKey(key("R")), false);
  assert.equal(isRefreshKey(key("r", { ctrlKey: true, altKey: true })), false); // AltGr arrives as Ctrl+Alt
  assert.equal(isRefreshKey(key("F4")), false);
  assert.equal(isRefreshKey(key("Escape", { ctrlKey: true })), false);
});
