import { test } from "node:test";
import assert from "node:assert/strict";
import { markShare, panelSteps } from "./panel-steps.ts";
import { deriveShares, fileKeyOf, shareIdOf, type Account, type AccountId, type BrandId, type ContentId, type Share } from "./shares.ts";
import { testContent } from "./test-content.ts";
import { at, parseDate, parseTime, type LocalDate, type TimeOfDay } from "./time.ts";

const day = parseDate("2026-11-11") as LocalDate;
const T = (s: string) => parseTime(s) as TimeOfDay;
const NOW = at(day, T("14:20"));
const B = "initech" as BrandId;

const content = testContent({ id: "dog", platforms: ["x", "tiktok"], video: true });
const accounts: Account[] = [{ id: "initech-x" as AccountId, brand: B, network: "x", handle: "@initech", language: "en", times: { x: T("09:00") } }];

function share(platform: "x" | "tiktok", opts: { missing?: boolean; status?: "done" | "skipped" } = {}): Share {
  const id = shareIdOf(B, "dog" as ContentId, platform);
  const all = deriveShares({
    contents: [content],
    accounts,
    records: opts.status ? [{ share: id, status: opts.status, at: NOW }] : [],
    missingFiles: new Set(opts.missing ? [fileKeyOf(B, "dog" as ContentId, "main.mp4")] : []),
    now: NOW,
  });
  const s = all.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
}

test("unblocked share: every step ready, marking works", () => {
  const s = share("x");
  assert.deepEqual(panelSteps(s), { reveal: true, share: { kind: "ready" }, mark: { kind: "ready" }, skip: true });
  assert.deepEqual(markShare(s, "done", NOW), { ok: true, record: { share: s.id, status: "done", at: NOW } });
});

test("missing file: no reveal, share and mark blocked; marking is refused, skipping works", () => {
  const s = share("x", { missing: true });
  const blocked = { kind: "blocked", reason: "file-missing" };
  assert.deepEqual(panelSteps(s), { reveal: false, share: blocked, mark: blocked, skip: true });
  assert.deepEqual(markShare(s, "done", NOW), { ok: false, why: "file-missing" });
  assert.equal(markShare(s, "skipped", NOW).ok, true);
});

test("missing account: the blocker is the account (the account comes first when the file is missing too)", () => {
  const s = share("tiktok", { missing: true });
  const blocked = { kind: "blocked", reason: "account-missing" };
  assert.deepEqual(panelSteps(s), { reveal: false, share: blocked, mark: blocked, skip: true });
  assert.deepEqual(markShare(s, "done", NOW), { ok: false, why: "account-missing" });
  assert.equal(panelSteps(share("tiktok")).reveal, true);
});

test("finished share: mark step done, no skip, no second mark", () => {
  for (const status of ["done", "skipped"] as const) {
    const s = share("x", { status });
    assert.deepEqual([panelSteps(s).mark, panelSteps(s).skip], [{ kind: "done" }, false], status);
    assert.deepEqual(markShare(s, "skipped", NOW), { ok: false, why: "finished" });
  }
});
