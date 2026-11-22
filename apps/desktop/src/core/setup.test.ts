import { test } from "node:test";
import assert from "node:assert/strict";
import { askOf, errorButtons, parseProgress, parseSetupError, parseSetupInfo, type SetupInfo } from "./setup.ts";

test("setup state is parsed at the boundary in the Rust `Installed` shape", () => {
  // Same values as the Rust test `installed_serializes_to_contract`.
  assert.deepEqual(parseSetupInfo({ mode: "setup", version: "0.1.1", installed: { kind: "older", version: "0.1.0" } }), {
    mode: "setup",
    version: "0.1.1",
    installed: { kind: "older", version: "0.1.0" },
  });
  assert.deepEqual(parseSetupInfo({ mode: "uninstall", version: "0.1.1", installed: { kind: "none" } }), { mode: "uninstall", version: "0.1.1", installed: { kind: "none" } });
  assert.deepEqual(parseSetupInfo({ mode: "setup", version: "0.1.1", installed: { kind: "older", version: "" } })?.installed, { kind: "older", version: "" });
  assert.equal(parseSetupInfo({ mode: "app", version: "0.1.1", installed: { kind: "none" } }), null);
  assert.equal(parseSetupInfo({ mode: "setup", version: "0.1", installed: { kind: "none" } }), null);
  assert.equal(parseSetupInfo({ mode: "setup", version: "0.1.1", installed: { kind: "same" } }), null);
  assert.equal(parseSetupInfo(null), null);
});

test("a shell error code passes through; a shapeless error becomes SETUP_FAILED", () => {
  assert.deepEqual(parseSetupError({ code: "SETUP_APP_RUNNING", detail: "C:/x/postbell.exe" }), { code: "SETUP_APP_RUNNING", detail: "C:/x/postbell.exe" });
  assert.deepEqual(parseSetupError("command setup_install not found"), { code: "SETUP_FAILED", detail: "command setup_install not found" });
  assert.deepEqual(parseSetupError({ code: "bad code", detail: "d" }), { code: "SETUP_FAILED", detail: "d" });
  assert.equal(parseSetupError(undefined).code, "SETUP_FAILED");
});

test("progress only with a valid step count", () => {
  assert.deepEqual(parseProgress({ done: 3, total: 6 }), { done: 3, total: 6 });
  assert.equal(parseProgress({ done: 7, total: 6 }), null);
  assert.equal(parseProgress({ done: 0, total: 0 }), null);
  assert.equal(parseProgress({ done: "1", total: 6 }), null);
});

test("the first screen follows the mode and the installed version", () => {
  const info = (installed: SetupInfo["installed"], mode: SetupInfo["mode"] = "setup"): SetupInfo => ({ mode, version: "0.1.1", installed });
  assert.equal(askOf(info({ kind: "none" })), "welcome");
  assert.equal(askOf(info({ kind: "older", version: "0.1.0" })), "update");
  assert.equal(askOf(info({ kind: "same", version: "0.1.1" })), "same");
  assert.equal(askOf(info({ kind: "newer", version: "0.2.0" })), "newer");
  assert.equal(askOf(info({ kind: "same", version: "0.1.1" }, "uninstall")), "confirm");
});

test("error buttons: force close only for a running Postbell; no retry after an open failure", () => {
  const e = (code: string) => ({ code, detail: "" });
  assert.deepEqual(errorButtons("install", e("SETUP_APP_RUNNING")), ["retry", "force-close"]);
  assert.deepEqual(errorButtons("uninstall", e("SETUP_APP_RUNNING")), ["retry", "force-close"]);
  assert.deepEqual(errorButtons("uninstall", e("UNINSTALL_DIR_LOCKED")), ["retry"]);
  assert.deepEqual(errorButtons("open-app", e("SETUP_OPEN_FAILED")), ["close"]);
});
