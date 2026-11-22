import { test } from "node:test";
import assert from "node:assert/strict";
import type { AccountId } from "./shares.ts";
import { codesOf, hasSecrets, parseVaultStatus, signsInWithInstagram, vaultChangeOf } from "./vault.ts";

// Made up; never a real password.
const PW = "ornek-sifre-123";

test("codes: one per line, blank lines and outer spaces dropped", () => {
  assert.deepEqual(codesOf(" 1111 2222 \r\n\n3333\n   \n"), ["1111 2222", "3333"]);
  assert.deepEqual(codesOf(""), []);
});

test("a new account replaces whatever the vault held for its id", () => {
  assert.deepEqual(vaultChangeOf({ password: "", codes: "" }, true), { password: null, codes: [], replace: true });
  const c = vaultChangeOf({ password: PW, codes: "1111" }, true);
  assert.deepEqual(c, { password: PW, codes: ["1111"], replace: true });
  assert.equal(hasSecrets(c!), true);
  assert.equal(hasSecrets(vaultChangeOf({ password: "", codes: " \n" }, true)!), false);
});

test("an edit changes only the fields typed in; empty fields keep the stored values", () => {
  assert.equal(vaultChangeOf({ password: "", codes: "\n" }, false), null);
  assert.deepEqual(vaultChangeOf({ password: PW, codes: "" }, false), { password: PW, codes: null, replace: false });
  assert.deepEqual(vaultChangeOf({ password: "", codes: "1111\n2222" }, false), { password: null, codes: ["1111", "2222"], replace: false });
});

test("the password keeps its spaces: only codes are trimmed", () => {
  const spaced = ` ${PW} `;
  assert.equal(vaultChangeOf({ password: spaced, codes: "" }, false)?.password, spaced);
});

test("Threads without its own password signs in with Instagram", () => {
  const id = "acme-threads" as AccountId;
  assert.equal(signsInWithInstagram("threads", undefined), true);
  assert.equal(signsInWithInstagram("threads", { account: id, password: false, codes: 0 }), true);
  assert.equal(signsInWithInstagram("threads", { account: id, password: true, codes: 0 }), false);
  assert.equal(signsInWithInstagram("instagram", undefined), false);
});

test("vault status from the shell is checked", () => {
  assert.deepEqual(parseVaultStatus([{ account: "acme-x", password: true, codes: 2 }]), [{ account: "acme-x", password: true, codes: 2 }]);
  assert.deepEqual(parseVaultStatus([]), []);
  for (const bad of [null, {}, [{ account: "a", password: "yes", codes: 0 }], [{ account: "a", password: true, codes: -1 }], [{ account: "a", password: true, codes: 1.5 }], [{ password: true, codes: 0 }]]) {
    assert.equal(parseVaultStatus(bad), null, JSON.stringify(bad));
  }
});
