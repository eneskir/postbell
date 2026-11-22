// Prints one row per package manifest: `node tools/manifest-report.mjs [folder]` (default ../../contracts/fixtures).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseManifestText } from "../src/core/manifest.ts";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function findManifests(dir) {
  const out = [];
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...findManifests(p));
    else if (f === "manifest.json") out.push(p);
  }
  return out;
}

export function describe(error) {
  switch (error.code) {
    case "invalid-shape":
      return `${error.code} ${error.path} (${error.rule})`;
    case "unknown-version":
      return `${error.code} ${JSON.stringify(error.version)}`;
    case "not-approved":
      return `${error.code} ${error.approval}`;
    default:
      return error.code;
  }
}

export function report(root) {
  return findManifests(root).map((file) => {
    const pkg = dirname(file);
    const name = relative(root, pkg).split(sep).join("/");
    const r = parseManifestText(readFileSync(file, "utf8"));
    if (!r.ok) return { name, result: describe(r.error) };
    const missing = r.content.files.filter((f) => !existsSync(join(pkg, ...f.path.split("/")))).map((f) => f.path);
    return {
      name,
      result: "parsed",
      brand: r.content.brand,
      date: r.content.date,
      platforms: r.content.entries.map((e) => e.platform).join(", "),
      missing,
    };
  });
}

function main(args) {
  const root = resolve(args[0] ?? join(APP, "..", "..", "contracts", "fixtures"));
  const rows = report(root);
  if (!rows.length) {
    console.error(`packages: no manifest.json under ${root}`);
    process.exit(1);
  }
  const width = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) {
    const extra = r.result === "parsed" ? `  ${r.brand} ${r.date}  [${r.platforms}]${r.missing.length ? `  missing files: ${r.missing.join(", ")}` : ""}` : "";
    console.log(`${r.name.padEnd(width)}  ${r.result}${extra}`);
  }
  const parsed = rows.filter((r) => r.result === "parsed").length;
  console.log(`packages: ${rows.length} manifests, ${parsed} parsed, ${rows.length - parsed} rejected, ${rows.filter((r) => r.missing?.length).length} with missing files`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
