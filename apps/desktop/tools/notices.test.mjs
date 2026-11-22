import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judge, render, withUpstream } from "./notices.mjs";

test("allowed licenses and expressions with options pass", () => {
  assert.equal(judge("MIT"), "ok");
  assert.equal(judge("MIT OR Apache-2.0"), "ok");
  assert.equal(judge("MIT/Apache-2.0"), "ok");
  assert.equal(judge("Apache-2.0 WITH LLVM-exception OR MIT"), "ok");
  assert.equal(judge("(MIT OR Apache-2.0) AND Unicode-3.0"), "ok");
  assert.equal(judge("BSL-1.0"), "ok");
  assert.equal(judge("OFL-1.1"), "ok");
});

test("the GPL family and unknown licenses fail", () => {
  assert.equal(judge("GPL-3.0"), "no");
  assert.equal(judge("LGPL-2.1-or-later"), "no");
  assert.equal(judge("MIT AND AGPL-3.0"), "no");
  assert.equal(judge(""), "no");
  assert.equal(judge("MIT OR"), "no");
});

test("a GPL option next to an allowed option takes the allowed one", () => {
  assert.equal(judge("MIT OR GPL-3.0"), "ok");
});

test("MPL-2.0 counts as conditional and is listed with its source address", () => {
  assert.equal(judge("MPL-2.0"), "mpl");
  assert.equal(judge("MPL-2.0 AND MIT"), "mpl");
  assert.equal(judge("MPL-2.0 OR MIT"), "ok");
  const out = render([{ source: "crates.io", name: "option-ext", version: "0.2.0", license: "MPL-2.0", repository: "https://example.invalid/option-ext", texts: ["MPL text"] }]);
  assert.match(out, /option-ext 0\.2\.0 \(crates\.io, MPL-2\.0\); used unmodified, source code: https:\/\/example\.invalid\/option-ext/);
  assert.match(out, /are subject to their own licenses/);
});

test("the same license text is grouped once, a package without a file is listed apart", () => {
  const out = render([
    { source: "npm", name: "a", version: "1.0.0", license: "MIT", texts: ["Copyright A\nMIT"] },
    { source: "npm", name: "b", version: "2.0.0", license: "MIT", texts: ["Copyright A\nMIT"] },
    { source: "crates.io", name: "c", version: "0.1.0", license: "MIT", texts: [] },
  ]);
  assert.equal(out.match(/```text/g)?.length, 1);
  assert.match(out, /## a 1\.0\.0, b 2\.0\.0/);
  assert.match(out, /## Packages without a bundled license file\n\n- c 0\.1\.0/);
});

test("an upstream text goes only to a package of the same version without a file; an unused file is stale", () => {
  const dir = mkdtempSync(join(tmpdir(), "notices-"));
  try {
    writeFileSync(join(dir, "a-1.0.0.txt"), "MIT\r\nCopyright A\n");
    writeFileSync(join(dir, "s+b-2.0.0.txt"), "MIT B");
    writeFileSync(join(dir, "c-1.0.0.txt"), "MIT C");
    writeFileSync(join(dir, "d-1.0.0.txt"), "MIT D");
    const { packages, stale } = withUpstream([
      { source: "npm", name: "a", version: "1.0.0", license: "MIT", texts: [] },
      { source: "npm", name: "@s/b", version: "2.0.0", license: "MIT", texts: [] },
      { source: "npm", name: "c", version: "1.1.0", license: "MIT", texts: [] },
      { source: "npm", name: "d", version: "1.0.0", license: "MIT", texts: ["own text"] },
    ], dir);
    assert.deepEqual(packages.map((p) => p.texts), [["MIT\nCopyright A"], ["MIT B"], [], ["own text"]]);
    assert.deepEqual(stale, ["c-1.0.0.txt", "d-1.0.0.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an embedded component's text is added to the package's own text; for another version it is stale", () => {
  const dir = mkdtempSync(join(tmpdir(), "notices-"));
  try {
    writeFileSync(join(dir, "e-1.0.0.embedded.txt"), "BSD SDK\r\n");
    writeFileSync(join(dir, "f-1.0.0.embedded.txt"), "BSD F");
    const { packages, stale } = withUpstream([
      { source: "crates.io", name: "e", version: "1.0.0", license: "MIT", texts: ["own text"] },
      { source: "crates.io", name: "f", version: "2.0.0", license: "MIT", texts: ["own F"] },
    ], dir);
    assert.deepEqual(packages.map((p) => p.texts), [["own text", "BSD SDK"], ["own F"]]);
    assert.deepEqual(stale, ["f-1.0.0.embedded.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
