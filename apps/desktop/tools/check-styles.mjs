// Fails on raw colors, off-scale sizes and untokened type in src/ui styles: `npm run styles`.
// A size (never a color) is exempt when its line ends with `/* off-token: <reason> */`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const HEX = /#[0-9a-f]{3,8}\b/i;
const NAMED = /\b(?:white|black|red|green|blue|gray|grey|yellow|orange|purple|pink|silver|navy|teal|maroon|olive|lime|aqua|fuchsia|brown|gold)\b/i;
const TYPO = new Set(["font", "font-size", "line-height", "font-weight", "font-family", "letter-spacing"]);
const ALLOWED_PX = new Set([0, 1, 2]);

export function checkCss(source) {
  const out = [];
  let inFontFace = false;
  let inComment = false;
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    let code = raw;
    if (inComment) {
      const end = code.indexOf("*/");
      if (end < 0) return;
      code = code.slice(end + 2);
      inComment = false;
    }
    const exempt = /\/\*\s*off-token:\s*\S/.test(code);
    code = code.replace(/\/\*.*?\*\//g, "");
    const open = code.indexOf("/*");
    if (open >= 0) { code = code.slice(0, open); inComment = true; }
    if (/@font-face\s*\{/.test(code)) inFontFace = true;
    if (inFontFace) { if (code.includes("}")) inFontFace = false; return; }
    const m = /^\s*([a-z-]+)\s*:\s*(.+?)\s*;?\s*$/i.exec(code);
    if (!m) return;
    const [, prop, value] = m;
    if (prop.startsWith("--")) return;
    if (HEX.test(value) || COLOR_FN.test(value) || NAMED.test(value)) out.push({ line, rule: "raw color", text: raw.trim() });
    if (TYPO.has(prop) && !/^(?:var\(--text-[a-z0-9-]+\)|inherit)$/.test(value)) out.push({ line, rule: "untokened type", text: raw.trim() });
    if (exempt) return;
    for (const n of value.matchAll(/(-?\d*\.?\d+)(px|rem|em|pt)\b/g)) {
      if (n[2] !== "px" || !ALLOWED_PX.has(Math.abs(Number(n[1])))) { out.push({ line, rule: "off-scale size", text: raw.trim() }); break; }
    }
  });
  return out;
}

export function checkTs(source) {
  const out = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    if (/["'`][^"'`]*#[0-9a-f]{3,8}\b/i.test(raw) || COLOR_FN.test(raw)) out.push({ line: i + 1, rule: "raw color", text: raw.trim() });
  });
  return out;
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function main() {
  const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const files = walk(join(app, "src", "ui")).filter((f) => /\.(css|tsx?)$/.test(f) && !/\.gen\.(css|ts)$/.test(f) && !/\.d\.ts$/.test(f));
  let count = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const found = f.endsWith(".css") ? checkCss(src) : checkTs(src);
    for (const v of found) console.error(`${relative(app, f)}:${v.line}: ${v.rule}: ${v.text}`);
    count += found.length;
  }
  console.log(`styles: ${files.length} files, ${count} violations`);
  process.exit(count ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
