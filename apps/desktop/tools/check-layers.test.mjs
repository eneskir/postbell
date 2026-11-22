import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { checkCoreFile } from "./check-layers.mjs";

const core = resolve("C:/project/apps/desktop/src/core");
const file = join(core, "model.ts");
const testFile = join(core, "model.test.ts");
const specs = (src, f = file) => checkCoreFile(f, src, core).map((v) => v.spec);

test("core may import core", () => {
  assert.deepEqual(specs('import { a } from "./app-info.ts";\nimport type { B } from "./x/y.ts";'), []);
});

test("importing the UI, Tauri or React fails", () => {
  assert.deepEqual(specs('import { App } from "../ui/App.tsx";'), ["../ui/App.tsx"]);
  assert.deepEqual(specs('import type { T } from "../ui/text.ts";'), ["../ui/text.ts"]);
  assert.deepEqual(specs('import { invoke } from "@tauri-apps/api/core";'), ["@tauri-apps/api/core"]);
  assert.deepEqual(specs('import React from "react";'), ["react"]);
});

test("multi-line, side-effect, dynamic imports and re-exports are caught too", () => {
  const src = 'import {\n  a,\n  b,\n} from "react";\nimport "../ui/styles.css";\nconst m = await import("@tauri-apps/api");\nexport * from "../ui/x.ts";';
  assert.deepEqual(specs(src), ["react", "../ui/styles.css", "@tauri-apps/api", "../ui/x.ts"]);
});

test("a test file may also use Node's test modules, and only those", () => {
  assert.deepEqual(specs('import { test } from "node:test";\nimport assert from "node:assert/strict";', testFile), []);
  assert.deepEqual(specs('import { test } from "node:test";', file), ["node:test"]);
  assert.deepEqual(specs('import { readFileSync } from "node:fs";', testFile), ["node:fs"]);
});

test("the line number points at the violating line", () => {
  assert.equal(checkCoreFile(file, '// note\n\nimport x from "react";', core)[0].line, 3);
});
