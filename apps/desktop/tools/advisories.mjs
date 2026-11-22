// Fails when an npm or Rust package we build or run has a known advisory (OSV, which includes RustSec and the
// GitHub advisory database): `node tools/advisories.mjs`. An accepted advisory goes in advisories-allowed.json
// with its reason; an entry no package needs any more fails too, so the list never outlives its reason.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OSV = "https://api.osv.dev/v1/querybatch";
const BATCH = 1000; // OSV's limit per request

// Every installed npm package, dev tools included: they run on the maintainer's computer and in CI.
export function npmPackages(lock) {
  const out = new Map();
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    if (!path || !meta.version || meta.link) continue;
    const name = meta.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    out.set(`${name} ${meta.version}`, { ecosystem: "npm", name, version: meta.version });
  }
  return [...out.values()];
}

// `cargo tree --prefix none` lines ("name vX.Y.Z (...)"), minus the app itself.
export function cratePackages(tree, rootName) {
  const out = new Map();
  for (const line of tree.split("\n")) {
    const m = line.match(/^(\S+) v(\S+)/);
    if (m && m[1] !== rootName) out.set(`${m[1]} ${m[2]}`, { ecosystem: "crates.io", name: m[1], version: m[2] });
  }
  return [...out.values()];
}

// findings: [{ id, ecosystem, name, version }]; allowed: [{ id, package, reason }].
export function judge(findings, allowed) {
  const ok = new Set(allowed.map((a) => `${a.id} ${a.package}`));
  const seen = new Set(findings.map((f) => `${f.id} ${f.name}`));
  return {
    unexpected: findings.filter((f) => !ok.has(`${f.id} ${f.name}`)),
    stale: allowed.filter((a) => !seen.has(`${a.id} ${a.package}`)),
    unexplained: allowed.filter((a) => !a.reason?.trim()),
  };
}

async function query(packages) {
  const findings = [];
  for (let i = 0; i < packages.length; i += BATCH) {
    const chunk = packages.slice(i, i + BATCH);
    const body = { queries: chunk.map((p) => ({ package: { ecosystem: p.ecosystem, name: p.name }, version: p.version })) };
    const res = await fetch(OSV, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`OSV answered ${res.status}`);
    const { results } = await res.json();
    if (results?.length !== chunk.length) throw new Error(`OSV returned ${results?.length} results for ${chunk.length} packages`);
    results.forEach((r, j) => {
      if (r.next_page_token) throw new Error(`OSV has more advisories for ${chunk[j].name} than one page`);
      for (const v of r.vulns ?? []) findings.push({ id: v.id, ...chunk[j] });
    });
  }
  return findings;
}

function cargoBin() {
  const local = join(process.env.USERPROFILE ?? "", ".cargo", "bin", "cargo.exe");
  return existsSync(local) ? local : "cargo";
}

async function main() {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const npm = npmPackages(JSON.parse(readFileSync(join(appDir, "package-lock.json"), "utf8")));
  // Crates compiled for Windows, build scripts, macros and test-only crates included; the lockfile also lists
  // Linux and macOS crates that never build here.
  const tree = execFileSync(
    cargoBin(),
    ["tree", "-e", "all", "--target", "x86_64-pc-windows-msvc", "--prefix", "none", "--locked", "--offline", "--manifest-path", join(appDir, "src-tauri", "Cargo.toml")],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const crates = cratePackages(tree, "postbell");
  if (npm.length === 0 || crates.length === 0) {
    console.error("advisories: no package could be read; the check cannot pass on empty input");
    process.exit(1);
  }
  const findings = await query([...npm, ...crates]);
  const allowed = JSON.parse(readFileSync(join(appDir, "tools", "advisories-allowed.json"), "utf8"));
  const { unexpected, stale, unexplained } = judge(findings, allowed);
  console.log(`advisories: npm ${npm.length}, crates.io ${crates.length}; advisories ${findings.length}, accepted ${findings.length - unexpected.length}`);
  for (const f of unexpected) console.error(`  ${f.id}: ${f.name} ${f.version} (${f.ecosystem}), https://osv.dev/vulnerability/${f.id}`);
  for (const a of stale) console.error(`  advisories-allowed.json: ${a.id} ${a.package} is no longer reported; remove it`);
  for (const a of unexplained) console.error(`  advisories-allowed.json: ${a.id} ${a.package} has no reason`);
  process.exit(unexpected.length || stale.length || unexplained.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
