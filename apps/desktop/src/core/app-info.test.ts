import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAppInfo } from "./app-info.ts";

// Matches the Rust test `app_info_serializes_to_contract`.
const contract = { name: "Postbell", version: "0.1.0" };

test("the shell's value parses as AppInfo", () => {
  assert.deepEqual(parseAppInfo(contract), { ok: true, value: contract });
});

test("a prerelease suffix is accepted", () => {
  assert.equal(parseAppInfo({ name: "Postbell", version: "0.2.0-beta.1" }).ok, true);
});

test("a missing or wrong field returns the error code", () => {
  for (const raw of [null, "Postbell 0.1.0", {}, { name: "Postbell" }, { name: "", version: "0.1.0" }, { name: "Postbell", version: "1" }, { name: "Postbell", version: 1 }]) {
    assert.deepEqual(parseAppInfo(raw), { ok: false, code: "APP_INFO_INVALID" }, JSON.stringify(raw));
  }
});
