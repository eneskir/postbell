import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePortError } from "./port.ts";

test("a shell error is typed at the boundary; an unknown code becomes shell-unavailable", () => {
  // Matches the Rust test `port_error_serializes_to_contract`.
  assert.deepEqual(parsePortError({ code: "STORE_NEWER_VERSION", detail: "store on disk is version 2" }), { code: "store-newer-version", detail: "store on disk is version 2" });
  assert.deepEqual(parsePortError({ code: "FOLDER_NOT_REGISTERED", detail: "C:/x" }), { code: "folder-not-registered", detail: "C:/x" });
  assert.deepEqual(parsePortError({ code: "FOLDER_MISSING", detail: "folder missing: D:/x" }), { code: "folder-missing", detail: "folder missing: D:/x" });
  assert.deepEqual(parsePortError({ code: "UNKNOWN_CODE", detail: "d" }), { code: "shell-unavailable", detail: "d" });
  assert.deepEqual(parsePortError("command store_load not found"), { code: "shell-unavailable", detail: "command store_load not found" });
});
