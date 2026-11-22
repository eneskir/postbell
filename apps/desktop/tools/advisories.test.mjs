import { test } from "node:test";
import assert from "node:assert/strict";
import { cratePackages, judge, npmPackages } from "./advisories.mjs";

test("npm packages come from the lockfile once each, dev tools included, links skipped", () => {
  const lock = {
    packages: {
      "": { name: "app", version: "1.0.0" },
      "node_modules/react": { version: "19.0.0" },
      "node_modules/vite": { version: "8.0.0", dev: true },
      "node_modules/a/node_modules/react": { version: "19.0.0" },
      "node_modules/@scope/pkg": { version: "2.0.0" },
      "node_modules/local": { link: true, resolved: "../local" },
    },
  };
  assert.deepEqual(
    npmPackages(lock).map((p) => `${p.name} ${p.version}`),
    ["react 19.0.0", "vite 8.0.0", "@scope/pkg 2.0.0"],
  );
});

test("crates come from cargo tree once each, without the app itself", () => {
  const tree = "postbell v0.1.3 (C:/x)\nurl v2.5.9\nidna v1.0.3\nurl v2.5.9 (*)\nserde_derive v1.0.0 (proc-macro)\n";
  assert.deepEqual(
    cratePackages(tree, "postbell").map((p) => `${p.name} ${p.version}`),
    ["url 2.5.9", "idna 1.0.3", "serde_derive 1.0.0"],
  );
});

test("an advisory fails unless it is accepted with a reason for that package", () => {
  const findings = [
    { id: "RUSTSEC-1", ecosystem: "crates.io", name: "a", version: "1.0.0" },
    { id: "RUSTSEC-2", ecosystem: "crates.io", name: "b", version: "1.0.0" },
  ];
  const r = judge(findings, [{ id: "RUSTSEC-1", package: "a", reason: "not on our code path" }]);
  assert.deepEqual(r.unexpected.map((f) => f.id), ["RUSTSEC-2"]);
  assert.equal(r.stale.length, 0);
  assert.equal(r.unexplained.length, 0);
});

test("an accepted advisory for another package does not cover this one", () => {
  const r = judge([{ id: "RUSTSEC-1", name: "b" }], [{ id: "RUSTSEC-1", package: "a", reason: "x" }]);
  assert.equal(r.unexpected.length, 1);
  assert.equal(r.stale.length, 1);
});

test("an accepted entry no longer reported, or without a reason, fails", () => {
  const r = judge([{ id: "RUSTSEC-1", name: "a" }], [
    { id: "RUSTSEC-1", package: "a", reason: " " },
    { id: "RUSTSEC-9", package: "z", reason: "gone" },
  ]);
  assert.deepEqual(r.stale.map((a) => a.id), ["RUSTSEC-9"]);
  assert.deepEqual(r.unexplained.map((a) => a.id), ["RUSTSEC-1"]);
});
