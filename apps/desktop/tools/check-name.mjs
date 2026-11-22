// Fails when the old product name appears in any text file git tracks or would track: `node tools/check-name.mjs`.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Written in parts so this file does not trip its own check.
const OLD = new RegExp(["br", "iso"].join(""), "i");

export function findOldName(files) {
  const violations = [];
  for (const { path, text } of files) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (OLD.test(line)) violations.push({ path, line: i + 1, text: line.trim() });
    });
    if (OLD.test(path)) violations.push({ path, line: 0, text: "(file name)" });
  }
  return { violations };
}

function gitFiles(root) {
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return [...new Set(r.stdout.split("\0").filter(Boolean))];
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const files = [];
  for (const path of gitFiles(root)) {
    let buf;
    try { buf = readFileSync(join(root, path)); } catch { continue; } // deleted but not yet staged
    if (buf.includes(0)) continue;
    files.push({ path, text: buf.toString("utf8") });
  }
  if (files.length === 0) { console.error("old name: no file could be read"); process.exit(1); }
  const { violations } = findOldName(files);
  for (const v of violations) console.error(`${v.path}:${v.line}: old name: ${v.text.slice(0, 160)}`);
  console.log(`old name: ${files.length} files, ${violations.length} occurrences`);
  process.exit(violations.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
