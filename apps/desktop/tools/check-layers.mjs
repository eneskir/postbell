// Fails when src/core imports anything outside src/core (tests may also use Node's test modules): `npm run lint`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_ONLY = new Set(["node:test", "node:assert", "node:assert/strict"]);

const PATTERNS = [
  /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

export function importsOf(source) {
  const found = [];
  for (const re of PATTERNS) {
    for (const m of source.matchAll(re)) {
      const line = source.slice(0, m.index).split("\n").length;
      found.push({ spec: m[1], line });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

export function checkCoreFile(file, source, coreDir) {
  const isTest = /\.test\.tsx?$/.test(file);
  const violations = [];
  for (const { spec, line } of importsOf(source)) {
    if (isTest && TEST_ONLY.has(spec)) continue;
    if (spec.startsWith("./") || spec.startsWith("../")) {
      const target = resolve(dirname(file), spec);
      if (target === coreDir || target.startsWith(coreDir + sep)) continue;
    }
    violations.push({ line, spec });
  }
  return violations;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(?:ts|tsx|mts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

function main() {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const coreDir = join(appDir, "src", "core");
  const files = walk(coreDir);
  if (files.length === 0) {
    console.error("layers: no files found in src/core; the check cannot pass on empty input");
    process.exit(1);
  }
  let imports = 0;
  const problems = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    imports += importsOf(src).length;
    for (const v of checkCoreFile(f, src, coreDir)) {
      problems.push(`${relative(appDir, f)}:${v.line}: "${v.spec}" cannot be imported (core imports only core)`);
    }
  }
  for (const p of problems) console.error(p);
  console.log(`layers: ${files.length} files, ${imports} imports, ${problems.length} violations`);
  process.exit(problems.length === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
