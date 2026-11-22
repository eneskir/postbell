import { test } from "node:test";
import assert from "node:assert/strict";
import { accountProblems, accountRows, addAccount, cleanHandle, draftFor, removeAccount, setupStepOf, updateAccount, type AccountDraft } from "./accounts.ts";
import type { Language } from "./manifest.ts";
import { deriveShares, shareIdOf, type Account, type AccountId, type BrandId, type ContentId } from "./shares.ts";
import { emptyStore, parseStoreText, serializeStore, type StoreFile } from "./store.ts";
import { testContent } from "./test-content.ts";
import { at, parseDate, parseTime, type LocalDate, type TimeOfDay } from "./time.ts";

const P = "initech" as BrandId;
const O = "globex" as BrandId;
const T = (s: string) => parseTime(s) as TimeOfDay;
const acc = (id: string, network: Account["network"], handle: string, language: Language, brand = P): Account => ({ id: id as AccountId, brand, network, handle, language, times: {} });
const base: StoreFile = {
  ...emptyStore(),
  brands: [
    { id: P, name: "Initech", sticker: "camera", folder: "D:/content/initech" },
    { id: O, name: "Globex", sticker: "night", folder: "D:/content/globex" },
  ],
  accounts: [acc("initech-instagram", "instagram", "@initech", "en"), acc("globex-x", "x", "@initech", "tr", O)],
};
const draft = (over: Partial<AccountDraft>): AccountDraft => ({ network: "x", handle: "@initech", language: "en", ...over });
const codes = (d: AccountDraft, self?: string) => accountProblems(base, P, d, self as AccountId | undefined).map((p) => `${p.field}:${p.code}`);

test("handle: gains a leading @, drops spaces and invisible characters, a bare @ is empty", () => {
  assert.equal(cleanHandle("initech"), "@initech");
  assert.equal(cleanHandle("  @@ini tech\t"), "@initech");
  assert.equal(cleanHandle("@ini\u200btech\u0007"), "@initech");
  assert.equal(cleanHandle("@ini\ud83dtech"), "@initech");
  assert.equal(cleanHandle("@"), null);
  assert.equal(cleanHandle("  "), null);
  assert.equal([...(cleanHandle("a".repeat(150)) ?? "")].length, 100);
});

test("problems: empty handle; same handle on the same network in any case; same handle elsewhere is fine", () => {
  assert.deepEqual(codes(draft({ handle: "@" })), ["handle:empty"]);
  assert.deepEqual(codes(draft({ network: "instagram", handle: "INITECH", language: "tr" })), ["handle:taken"]);
  assert.deepEqual(codes(draft({ network: "x" })), []);
  assert.deepEqual(codes(draft({ network: "tiktok" })), []);
});

test("problems: one account per language on a network with packages; Threads ignores language; an account does not clash with itself", () => {
  assert.deepEqual(accountProblems(base, P, draft({ network: "instagram", handle: "@initech.tr", language: "en" })), [{ field: "language", code: "taken", by: "@initech" }]);
  assert.deepEqual(codes(draft({ network: "instagram", handle: "@initech.tr", language: "tr" })), []);
  const threads = { ...base, accounts: [...base.accounts, acc("initech-threads", "threads", "@initech", "en")] };
  assert.deepEqual(accountProblems(threads, P, draft({ network: "threads", handle: "@second", language: "en" })), []);
  assert.deepEqual(codes(draft({ network: "instagram", handle: "@Initech", language: "en" }), "initech-instagram"), []);
});

test("add: id is brand-network with a number suffix when taken; handle cleaned, times empty; store round-trips", () => {
  const r = addAccount(base, P, draft({ network: "instagram", handle: " initech.tr ", language: "tr" }));
  assert.ok(r.ok);
  assert.equal(r.id, "initech-instagram-2");
  assert.deepEqual(r.store.accounts.at(-1), acc("initech-instagram-2", "instagram", "@initech.tr", "tr"));
  const x = addAccount(r.store, P, draft({}));
  assert.ok(x.ok);
  assert.equal(x.id, "initech-x");
  const back = parseStoreText(serializeStore(x.store));
  assert.equal(back.kind, "ready");
  if (back.kind === "ready") assert.deepEqual(back.store.accounts, x.store.accounts);
});

test("add: a draft with problems or an unknown brand leaves the store unchanged", () => {
  assert.deepEqual(addAccount(base, P, draft({ handle: "" })), { ok: false, problems: [{ field: "handle", code: "empty" }] });
  assert.deepEqual(addAccount(base, "deleted" as BrandId, draft({})), { ok: false, problems: [] });
});

test("update: handle and language change, id, network and times stay; no change returns the same store", () => {
  const timed = { ...base, accounts: base.accounts.map((a) => (a.id === "initech-instagram" ? { ...a, times: { "instagram-reels": T("18:00") } } : a)) };
  const id = "initech-instagram" as AccountId;
  const r = updateAccount(timed, id, { handle: "initech.tr", language: "tr" });
  assert.ok(r.ok);
  assert.deepEqual(r.store.accounts[0], { ...timed.accounts[0], handle: "@initech.tr", language: "tr" });
  const same = updateAccount(timed, id, { handle: " @initech", language: "en" });
  assert.ok(same.ok);
  assert.equal(same.store, timed);
  assert.deepEqual(updateAccount(timed, id, { handle: "@", language: "en" }), { ok: false, problems: [{ field: "handle", code: "empty" }] });
  assert.deepEqual(updateAccount(timed, "missing" as AccountId, { handle: "@a", language: "en" }), { ok: false, problems: [] });
});

test("no secrets in the store: a backup code field makes it unreadable, does not compile and is never written", () => {
  const text = serializeStore(base).replace('"handle": "@initech"', '"backupCodes": [], "handle": "@initech"');
  assert.deepEqual(parseStoreText(text), { kind: "unreadable", reason: "invalid-shape", path: "accounts[0].backupCodes", rule: "additionalProperties" });
  // @ts-expect-error the account type has no secret fields
  const typed: Account = { id: "a" as AccountId, brand: P, network: "x", handle: "@a", language: "tr", times: {}, backupCodes: [] };
  assert.doesNotMatch(serializeStore({ ...base, accounts: [typed] }), /backupCodes/);
});

test("remove: only that account goes, share records stay; an unknown account leaves the store unchanged", () => {
  const records = [{ share: shareIdOf(P, "third" as ContentId, "instagram-post"), status: "done" as const, at: NOW }];
  const r = removeAccount({ ...base, records }, "initech-instagram" as AccountId);
  assert.deepEqual(r.accounts.map((a) => a.id), ["globex-x"]);
  assert.deepEqual(r.records, records);
  assert.equal(removeAccount(base, "missing" as AccountId), base);
});

const content = (brand: BrandId, id: string, language: Language, platforms: readonly string[]) => testContent({ brand, id, language, platforms, date: "2026-11-12" });
const NOW = at(parseDate("2026-11-12") as LocalDate, T("10:00"));

test("rows: accounts in network order; a network without accounts gets one row in the first share's language", () => {
  const contents = [content(P, "first", "tr", ["tiktok", "x"]), content(P, "second", "en", ["tiktok", "instagram-reels"]), content(O, "third", "en", ["pinterest"])];
  const shares = deriveShares({ contents, accounts: base.accounts, records: [], missingFiles: new Set(), now: NOW });
  assert.deepEqual(accountRows(base.accounts, P, shares), [
    { kind: "missing", network: "x", language: "tr", languageShown: false },
    { kind: "account", account: base.accounts[0] },
    { kind: "missing", network: "tiktok", language: "tr", languageShown: false },
  ]);
});

test("rows: with an account on the network, each unmatched language gets a labeled row; finished shares need no account", () => {
  const accounts = [acc("initech-instagram", "instagram", "@initech", "en"), acc("initech-instagram-2", "instagram", "@backup", "en")];
  const contents = [content(P, "first", "tr", ["instagram-reels"]), content(P, "second", "tr", ["instagram-post"]), content(P, "third", "tr", ["x"])];
  const records = [{ share: shareIdOf(P, "third" as ContentId, "x"), status: "skipped" as const, at: NOW }];
  const shares = deriveShares({ contents, accounts, records, missingFiles: new Set(), now: NOW });
  assert.deepEqual(accountRows(accounts, P, shares), [
    { kind: "account", account: accounts[0] },
    { kind: "account", account: accounts[1] },
    { kind: "missing", network: "instagram", language: "tr", languageShown: true },
  ]);
});

test("default draft: first network without an account and the brand's first share language, Turkish without shares", () => {
  assert.deepEqual(draftFor(base.accounts, P, []), { network: "x", handle: "", language: "tr" });
  const all = (["x", "instagram", "threads", "tiktok", "youtube", "pinterest"] as const).map((n) => acc(`p-${n}`, n, "@a", "en"));
  const shares = deriveShares({ contents: [content(P, "first", "en", ["x"])], accounts: [], records: [], missingFiles: new Set(), now: NOW });
  assert.deepEqual(draftFor(all, P, shares), { network: "x", handle: "", language: "en" });
  assert.deepEqual(draftFor([acc("p-x", "x", "@a", "en")], P, []).network, "instagram");
});

test("setup step: no account, then no times at all, then none once any time is set; other brands do not count", () => {
  assert.equal(setupStepOf([], P), "add-account");
  assert.equal(setupStepOf([acc("globex-x", "x", "@o", "tr", O)], P), "add-account");
  const x = acc("initech-x", "x", "@p", "en");
  assert.equal(setupStepOf([x], P), "enter-times");
  assert.equal(setupStepOf([x, { ...acc("initech-tiktok", "tiktok", "@p", "en"), times: { tiktok: T("18:30") } }], P), null);
});

test("details: trimmed, inner spaces and invisible characters folded, empty fields left out, long text cut", () => {
  const r = addAccount(base, P, draft({ email: "  name@example.com ", twoStep: "app", recoveryEmail: "   ", note: "Creator​  account\nThreads uses it" }));
  assert.ok(r.ok);
  const a = r.store.accounts.find((x) => x.id === r.id)!;
  assert.deepEqual(
    { email: a.email, twoStep: a.twoStep, note: a.note, hasRecovery: "recoveryEmail" in a },
    { email: "name@example.com", twoStep: "app", note: "Creator account Threads uses it", hasRecovery: false },
  );
  const long = addAccount(base, P, draft({ note: "ş".repeat(600) }));
  assert.ok(long.ok);
  assert.equal([...long.store.accounts.find((x) => x.id === long.id)!.note!].length, 500);
  assert.equal(parseStoreText(serializeStore(long.store)).kind, "ready");
});

test("update: details are replaced as a whole and survive the store file; the same details write nothing", () => {
  const id = "initech-instagram" as AccountId;
  const filled = updateAccount(base, id, { handle: "@initech", language: "en", email: "name@example.com", twoStep: "none", note: "Old" });
  assert.ok(filled.ok);
  const again = updateAccount(filled.store, id, { handle: "@initech", language: "en", email: " name@example.com", twoStep: "none", note: "Old " });
  assert.ok(again.ok);
  assert.equal(again.store, filled.store);
  const cleared = updateAccount(filled.store, id, { handle: "@initech", language: "en", twoStep: "sms" });
  assert.ok(cleared.ok);
  const a = cleared.store.accounts.find((x) => x.id === id)!;
  assert.deepEqual([a.email, a.twoStep, a.note], [undefined, "sms", undefined]);
  assert.deepEqual(parseStoreText(serializeStore(cleared.store)), { kind: "ready", store: cleared.store });
});
