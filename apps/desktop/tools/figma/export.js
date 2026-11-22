// Read-only Figma plugin script that exports tokens and SVGs; send it with a `const PART = <n>;` line on top.
// Plugin output is capped at about 100k characters per job, so the SVGs are split into parts.
if (typeof PART !== "number") throw new Error("PART is not defined: put `const PART = 0;` at the top of the script");
if (figma.root.name !== "Postbell") throw new Error("Wrong file: " + figma.root.name);

const BUDGET = 80000; // SVG characters per part, leaving room under the plugin output cap
// The prefixes of ASSET_GROUPS in tools/tokens.mjs; a plugin script cannot import it.
const WANTED = /^(icon\/nav\/|icon\/brand\/|illustration\/empty\/|logo\/postbell\/)/;

const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

const lib = figma.root.children.find((p) => p.name === "90 Kütüphane");
if (!lib) throw new Error("page 90 Kütüphane is missing");
await lib.loadAsync();
const comps = lib.findAll((n) => n.type === "COMPONENT" && WANTED.test(n.name));
comps.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const names = comps.map((c) => c.name);
if (new Set(names).size !== names.length) throw new Error("two components share a name");

const svgs = [];
for (const c of comps) svgs.push({ name: c.name, svg: await c.exportAsync({ format: "SVG_STRING" }) });

const parts = [[]];
let used = 0;
for (const s of svgs) {
  if (s.svg.length > BUDGET) throw new Error("one SVG is over the budget: " + s.name + " " + s.svg.length);
  if (used + s.svg.length > BUDGET && parts[parts.length - 1].length) { parts.push([]); used = 0; }
  parts[parts.length - 1].push(s);
  used += s.svg.length;
}
if (PART < 0 || PART >= parts.length) throw new Error("PART " + PART + " does not exist; part count " + parts.length);

print("META " + JSON.stringify({ part: PART, parts: parts.length, components: names.length, names }));

if (PART === 0) {
  const vars = await figma.variables.getLocalVariablesAsync();
  const variables = [];
  for (const v of vars) {
    const modes = Object.keys(v.valuesByMode);
    if (modes.length !== 1) throw new Error("expected a single mode: " + v.name);
    let value = v.valuesByMode[modes[0]];
    if (value && value.type === "VARIABLE_ALIAS") throw new Error("alias variables are not supported: " + v.name);
    if (v.resolvedType === "COLOR") {
      if (value.a !== undefined && value.a !== 1) throw new Error("transparent colors are not supported: " + v.name);
      value = hex(value);
    } else if (v.resolvedType !== "FLOAT") throw new Error("unsupported type: " + v.resolvedType + " " + v.name);
    variables.push({ name: v.name, type: v.resolvedType, value });
  }
  const textStyles = [];
  for (const s of await figma.getLocalTextStylesAsync()) {
    if (s.lineHeight.unit !== "PIXELS") throw new Error("line height is not in pixels: " + s.name);
    if (s.letterSpacing.value !== 0) throw new Error("letter spacing is not 0: " + s.name);
    textStyles.push({ name: s.name, family: s.fontName.family, style: s.fontName.style, size: s.fontSize, lineHeight: s.lineHeight.value });
  }
  variables.sort((a, b) => (a.name < b.name ? -1 : 1));
  textStyles.sort((a, b) => (a.name < b.name ? -1 : 1));
  print("TOKENS " + JSON.stringify({ variables, textStyles }));
}

for (const s of parts[PART]) print("SVG " + s.name + " " + s.svg.replace(/\r?\n/g, " "));
