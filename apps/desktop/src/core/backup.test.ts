import { test } from "node:test";
import assert from "node:assert/strict";
import { backupAccountsOf, parseBackupSaved, parseRestored, passphraseLongEnough } from "./backup.ts";
import type { AccountId, BrandId } from "./shares.ts";
import { emptyStore, type StoreFile } from "./store.ts";

test("the passphrase minimum counts characters like the shell, not UTF-16 units", () => {
  assert.equal(passphraseLongEnough("on-bir-harf"), false);
  assert.equal(passphraseLongEnough("on-iki-harfi"), true);
  // 11 emoji are 22 UTF-16 units but 11 characters.
  assert.equal(passphraseLongEnough("🔒".repeat(11)), false);
  assert.equal(passphraseLongEnough("ığüşöçİĞÜŞÖÇ"), true);
});

test("backup accounts carry the brand name so a person can tell them apart in the file", () => {
  const s: StoreFile = {
    ...emptyStore(),
    brands: [{ id: "initech" as BrandId, name: "Initech", sticker: "camera", folder: "D:/content/initech" }],
    accounts: [
      { id: "initech-x" as AccountId, brand: "initech" as BrandId, network: "x", handle: "@initech", language: "tr", times: {} },
      { id: "lost-x" as AccountId, brand: "lost" as BrandId, network: "x", handle: "@lost", language: "tr", times: {} },
    ],
  };
  assert.deepEqual(backupAccountsOf(s), [
    { id: "initech-x", brand: "Initech", network: "x", handle: "@initech" },
    { id: "lost-x", brand: "lost", network: "x", handle: "@lost" },
  ]);
});

test("shell answers of the wrong shape are refused", () => {
  assert.deepEqual(parseBackupSaved({ count: 3, created: 1_795_000_000_000 }), { count: 3, created: 1_795_000_000_000 });
  assert.equal(parseBackupSaved({ count: -1, created: 0 }), null);
  assert.equal(parseBackupSaved(null), null);
  assert.deepEqual(parseRestored({ changed: 1, added: 2, skipped: 0 }), { changed: 1, added: 2, skipped: 0 });
  assert.equal(parseRestored({ changed: 1, added: 2 }), null);
  assert.equal(parseRestored({ changed: 1.5, added: 0, skipped: 0 }), null);
});
