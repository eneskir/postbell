// Writes tokens/figma.json and src/ui/assets from the Figma plugin results of tools/figma/export.js: `node tools/figma-import.mjs <result.json>...` (all parts at once).
import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const GROUPS = [
  { prefix: "icon/nav/", dir: "nav" },
  { prefix: "icon/brand/", dir: "brand" },
  { prefix: "illustration/empty/", dir: "empty" },
  { prefix: "logo/postbell/", dir: "logo" },
];

export function assetPath(figmaName) {
  const g = GROUPS.find((x) => figmaName.startsWith(x.prefix));
  if (!g) throw new Error(`FIGMA_NAME_UNKNOWN: ${figmaName}`);
  const base = figmaName.slice(g.prefix.length);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(base)) throw new Error(`FIGMA_NAME_INVALID: ${figmaName}`);
  return { dir: g.dir, file: `${base}.svg` };
}

export function collect(printedLists) {
  let meta = null;
  let tokens = null;
  const seenParts = new Set();
  const svgs = new Map();
  for (const lines of printedLists) {
    for (const line of lines) {
      if (line.startsWith("META ")) {
        const m = JSON.parse(line.slice(5));
        if (meta && (meta.parts !== m.parts || meta.names.join("|") !== m.names.join("|")))
          throw new Error("EXPORT_MISMATCH: parts come from different document versions");
        meta = meta ?? m;
        if (seenParts.has(m.part)) throw new Error(`EXPORT_PART_DUPLICATE: ${m.part}`);
        seenParts.add(m.part);
      } else if (line.startsWith("TOKENS ")) {
        if (tokens) throw new Error("EXPORT_TOKENS_DUPLICATE");
        tokens = JSON.parse(line.slice(7));
      } else if (line.startsWith("SVG ")) {
        const rest = line.slice(4);
        const sp = rest.indexOf(" ");
        const name = rest.slice(0, sp);
        const svg = rest.slice(sp + 1);
        if (svgs.has(name)) throw new Error(`EXPORT_SVG_DUPLICATE: ${name}`);
        if (!svg.startsWith("<svg")) throw new Error(`EXPORT_SVG_INVALID: ${name}`);
        svgs.set(name, svg);
      }
    }
  }
  if (!meta) throw new Error("EXPORT_META_MISSING");
  for (let i = 0; i < meta.parts; i++) if (!seenParts.has(i)) throw new Error(`EXPORT_PART_MISSING: ${i}/${meta.parts}`);
  if (!tokens) throw new Error("EXPORT_TOKENS_MISSING");
  const missing = meta.names.filter((n) => !svgs.has(n));
  const extra = [...svgs.keys()].filter((n) => !meta.names.includes(n));
  if (missing.length || extra.length) throw new Error(`EXPORT_SVG_SET: missing ${missing.join(",") || "-"}, extra ${extra.join(",") || "-"}`);
  return { tokens, svgs };
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function main(files) {
  if (!files.length) {
    console.error("usage: node tools/figma-import.mjs <result.json>...");
    process.exit(2);
  }
  const printed = files.map((f) => {
    const d = JSON.parse(readFileSync(f, "utf8"));
    if (!d.ok && d.ok !== undefined) throw new Error(`RELAY_JOB_FAILED: ${f}`);
    return d.output?.printed ?? [];
  });
  const { tokens, svgs } = collect(printed);

  writeAtomic(join(APP, "tokens", "figma.json"), JSON.stringify({ source: "Figma «Postbell»: page «90 Kütüphane» and local variables", ...tokens }, null, 2) + "\n");

  const wanted = new Map();
  for (const [name, svg] of svgs) {
    const { dir, file } = assetPath(name);
    if (!wanted.has(dir)) wanted.set(dir, new Set());
    wanted.get(dir).add(file);
    writeAtomic(join(APP, "src", "ui", "assets", dir, file), svg + "\n");
  }
  let removed = 0;
  for (const { dir } of GROUPS) {
    const d = join(APP, "src", "ui", "assets", dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (f.endsWith(".svg") && !wanted.get(dir)?.has(f)) { rmSync(join(d, f)); removed++; }
  }
  console.log(`figma-import: ${tokens.variables.length} variables, ${tokens.textStyles.length} text styles, ${svgs.size} SVGs, ${removed} old SVGs removed`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
