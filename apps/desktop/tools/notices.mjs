// Writes THIRD_PARTY_NOTICES.md for the shipped npm and Rust packages: `npm run notices`; `--check` exits 1 when it is stale or a license is not allowed.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ALLOWED = new Set(["MIT", "MIT-0", "0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "PSF-2.0", "Unicode-3.0", "BSL-1.0", "OFL-1.1"]);
// MPL-2.0 section 3.2(a): used unmodified, listed with its version, license text and source address.
const CONDITIONAL = new Set(["MPL-2.0"]);
const RANK = { ok: 2, mpl: 1, no: 0 };

// SPDX: OR takes the best option, AND the worst; the legacy crates.io form "MIT/Apache-2.0" counts as OR.
export function judge(expr) {
  if (!expr) return "no";
  const tokens = expr.replace(/\//g, " OR ").match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const worst = (a, b) => (RANK[a] <= RANK[b] ? a : b);
  const best = (a, b) => (RANK[a] >= RANK[b] ? a : b);
  function factor() {
    const t = tokens[i++];
    if (t === "(") {
      const v = orExpr();
      i++;
      return v;
    }
    if (tokens[i] === "WITH") i += 2; // an SPDX exception (e.g. LLVM-exception) never narrows the license
    const id = (t ?? "").replace(/\+$/, "");
    return ALLOWED.has(id) ? "ok" : CONDITIONAL.has(id) ? "mpl" : "no";
  }
  function andExpr() {
    let v = factor();
    while (tokens[i] === "AND") {
      i++;
      v = worst(v, factor());
    }
    return v;
  }
  function orExpr() {
    let v = andExpr();
    while (tokens[i] === "OR") {
      i++;
      v = best(v, andExpr());
    }
    return v;
  }
  const v = orExpr();
  return i === tokens.length ? v : "no";
}

function licenseFiles(dir, declared) {
  const names = declared ? [declared] : existsSync(dir) ? readdirSync(dir).filter((n) => /^(licen[cs]e|copying|notice)/i.test(n)).sort() : [];
  return names
    .map((n) => join(dir, n))
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n").trim());
}

// File names drop a scope's leading @ and write / as +, since "name@version" reads as an e-mail address to the commit scan.
export function withUpstream(packages, dir) {
  const files = new Set(existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".txt")) : []);
  const used = new Set();
  const read = (f) => (used.add(f), readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n").trim());
  const out = packages.map((p) => {
    const stem = `${p.name.replace(/^@/, "").replace(/\//g, "+")}-${p.version}`;
    let texts = p.texts;
    if (!texts.length && files.has(`${stem}.txt`)) texts = [read(`${stem}.txt`)];
    // A component the package ships inside it (a vendored binary) has its own license, added on top of the package's.
    if (files.has(`${stem}.embedded.txt`)) texts = [...texts, read(`${stem}.embedded.txt`)];
    return texts === p.texts ? p : { ...p, texts };
  });
  return { packages: out, stale: [...files].filter((f) => !used.has(f)).sort() };
}

function npmPackages(appDir) {
  const lock = JSON.parse(readFileSync(join(appDir, "package-lock.json"), "utf8"));
  const out = [];
  for (const [path, meta] of Object.entries(lock.packages)) {
    if (!path || meta.dev || meta.devOptional) continue;
    const dir = join(appDir, path);
    if (!existsSync(dir)) continue; // an optional package npm does not install on this platform
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    out.push({ source: "npm", name, version: meta.version, license: meta.license ?? "", repository: repo ?? "", texts: licenseFiles(dir) });
  }
  return out;
}

function cargoBin() {
  const local = join(process.env.USERPROFILE ?? "", ".cargo", "bin", "cargo.exe");
  return existsSync(local) ? local : "cargo";
}

// `cargo tree` lists the crates that reach the exe; `cargo metadata` merges build-time features into its graph and
// over-counts, so it is used only to find each crate's folder.
function cargoPackages(appDir) {
  const manifest = join(appDir, "src-tauri", "Cargo.toml");
  const common = ["--locked", "--offline", "--manifest-path", manifest];
  const run = (args) => execFileSync(cargoBin(), args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const meta = JSON.parse(run(["metadata", "--format-version", "1", "--filter-platform", "x86_64-pc-windows-msvc", ...common]));
  const rootName = meta.packages.find((p) => p.id === meta.resolve.root).name;
  const byKey = new Map(meta.packages.map((p) => [`${p.name} ${p.version}`, p]));
  const tree = run(["tree", "-e", "normal,no-proc-macro", "--target", "x86_64-pc-windows-msvc", "--prefix", "none", "-f", "{p}", ...common]);
  const keys = new Set();
  for (const line of tree.split("\n")) {
    const m = line.match(/^(\S+) v(\S+)/);
    if (m && m[1] !== rootName) keys.add(`${m[1]} ${m[2]}`);
  }
  return [...keys].map((key) => {
    const p = byKey.get(key);
    if (!p) throw new Error(`NOTICES_CRATE_UNKNOWN: ${key} is not in cargo metadata`);
    const repository = p.repository || `https://crates.io/crates/${p.name}/${p.version}`;
    return { source: "crates.io", name: p.name, version: p.version, license: p.license ?? "", repository, texts: licenseFiles(dirname(p.manifest_path), p.license_file) };
  });
}

export function render(packages, assetNotes = "") {
  const groups = new Map();
  const missing = [];
  for (const p of packages) {
    if (p.texts.length === 0) {
      missing.push(p);
      continue;
    }
    const key = p.texts.join("\n\n---\n\n");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const label = (p) =>
    `${p.name} ${p.version} (${p.source}, ${p.license || "no license stated"})` +
    (judge(p.license) === "mpl" ? `; used unmodified, source code: ${p.repository}` : "");
  const lines = [
    "# Third-party notices",
    "",
    "Postbell includes the open source components below. Open source components are subject to their own licenses. License texts are taken from the file in the component's own package; a text that does not ship with the package is taken from the component's source repository, and its source is written below it.",
    "Components licensed under MPL-2.0 are used unmodified; their source code is available from the address written next to them.",
    "This file is generated by `npm run notices`; it is not edited by hand.",
    "",
  ];
  const sorted = [...groups.entries()].map(([text, ps]) => [text, ps.sort((a, b) => label(a).localeCompare(label(b), "en"))]);
  sorted.sort((a, b) => label(a[1][0]).localeCompare(label(b[1][0]), "en"));
  for (const [text, ps] of sorted) {
    lines.push("## " + ps.map((p) => `${p.name} ${p.version}`).join(", "), "");
    for (const p of ps) lines.push(`- ${label(p)}`);
    lines.push("", "```text", text.replace(/```/g, "'''"), "```", "");
  }
  if (missing.length) {
    lines.push("## Packages without a bundled license file", "");
    for (const p of missing.sort((a, b) => label(a).localeCompare(label(b), "en"))) lines.push(`- ${label(p)}`);
    lines.push("");
  }
  if (assetNotes.trim()) lines.push("## Images", "", assetNotes.trim(), "");
  return lines.join("\n");
}

function main() {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const out = join(appDir, "THIRD_PARTY_NOTICES.md");
  const { packages, stale } = withUpstream([...npmPackages(appDir), ...cargoPackages(appDir)], join(appDir, "tools", "licenses"));
  if (packages.length === 0) {
    console.error("notices: no package could be read; the check cannot pass on empty input");
    process.exit(1);
  }
  const verdicts = packages.map((p) => ({ p, v: judge(p.license) }));
  const mpl = verdicts.filter((x) => x.v === "mpl");
  const denied = verdicts.filter((x) => x.v === "no");
  const noSource = mpl.filter((x) => !x.p.repository);
  const missing = packages.filter((p) => p.texts.length === 0);
  const name = (p) => `${p.name} ${p.version} [${p.license || "?"}]`;
  const npmCount = packages.filter((p) => p.source === "npm").length;
  console.log(`notices: npm ${npmCount}, crates.io ${packages.length - npmCount}; allowed ${verdicts.length - mpl.length - denied.length}, conditional (MPL) ${mpl.length}, not allowed ${denied.length}, no license file ${missing.length}`);
  if (mpl.length) console.log("  conditional (MPL-2.0, with source address): " + mpl.map((x) => `${name(x.p)} ${x.p.repository}`).join(", "));
  if (missing.length) console.log("  no license file: " + missing.map(name).join(", "));
  for (const x of denied) console.error("  license not allowed or unknown: " + name(x.p));
  for (const x of noSource) console.error("  MPL package has no source address: " + name(x.p));
  for (const f of stale) console.error("  stale upstream license text (the package ships its own file or its version changed): tools/licenses/" + f);
  const sources = join(appDir, "src", "ui", "assets", "SOURCES.md");
  const assetNotes = existsSync(sources) ? (readFileSync(sources, "utf8").replace(/\r\n/g, "\n").split("## Notice")[1] ?? "") : "";
  if (existsSync(sources) && !assetNotes.trim()) {
    console.error('notices: SOURCES.md has no "## Notice" section');
    process.exit(1);
  }
  const text = render(packages, assetNotes);
  let failed = denied.length > 0 || noSource.length > 0 || stale.length > 0;
  if (process.argv.includes("--check")) {
    const current = existsSync(out) ? readFileSync(out, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== text) {
      console.error("notices: THIRD_PARTY_NOTICES.md is stale; run `npm run notices`");
      failed = true;
    }
  } else {
    writeFileSync(out, text, "utf8");
    console.log("notices written: " + out);
  }
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
