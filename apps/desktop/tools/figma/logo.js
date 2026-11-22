// Figma plugin script that writes to the file: rebuilds logo/postbell/sticker from the geometry below; rerunning gives the same result.
if (figma.root.name !== "Postbell") rae.dur("wrong file: " + figma.root.name);
const lib = figma.root.children.find((p) => p.name === "90 Kütüphane");
await lib.loadAsync();
const stk = lib.findOne((x) => x.type === "COMPONENT" && x.name === "logo/postbell/sticker");
if (!stk) rae.dur("component missing: logo/postbell/sticker");
const art = stk.children.length === 1 && stk.children[0].type === "FRAME" && stk.children[0].name === "art" ? stk.children[0] : null;
if (!art) rae.dur("the sticker's only child is not the art frame");
if (Math.abs(art.width - stk.width) > 0.01 || Math.abs(art.x) > 0.01 || Math.abs(art.y) > 0.01) rae.dur("art does not fill the component");

const vars = await figma.variables.getLocalVariablesAsync();
const val = (v) => v.valuesByMode[Object.keys(v.valuesByMode)[0]];
const varOf = (name) => { const v = vars.find((x) => x.name === "color/" + name); if (!v) rae.dur("variable missing: " + name); return v; };
const paint = (name) => { const v = varOf(name), c = val(v); return figma.variables.setBoundVariableForPaint({ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: 1 }, "color", v); };

const G = 116, k = stk.width / G;
const PATHS = [
  "M 46.5 58 L 46.5 29 C 46.5 21 53.5 17 58.5 20 C 61.5 22 60.5 26 57.5 26",
  "M 46.5 58 L 46.5 87 C 46.5 95 39.5 99 34.5 96 C 31.5 94 32.5 90 35.5 90",
  "M 46.5 59 C 46.5 47 54.5 39 65.5 39 C 76.5 39 84.5 47 84.5 58 C 84.5 69 76.5 77 65.5 77 C 57.5 77 52.5 72 52.5 65 C 52.5 58 57.5 53 63.5 53 C 68.5 53 71.5 57 69.5 61",
];
const DISC = { cx: 65.5, cy: 58, r: 17 }, HALO_W = 18, LINE_W = 6;
const scaled = (d, f) => d.split(" ").map((t) => (/^[A-Z]$/.test(t) ? t : String(Math.round(+t * f * 10000) / 10000))).join(" ");

function stroked(parent, f) {
  const out = { halo: [], line: [], disc: null };
  const vec = (d, kind) => {
    const v = figma.createVector(); parent.appendChild(v);
    v.vectorPaths = [{ windingRule: "NONZERO", data: scaled(d, f) }];
    v.fills = []; v.strokes = [paint(kind === "halo" ? "paper" : "on-accent")]; v.strokeWeight = (kind === "halo" ? HALO_W : LINE_W) * f;
    v.strokeCap = "ROUND"; v.strokeJoin = "ROUND"; v.strokeAlign = "CENTER"; v.name = kind; return v;
  };
  for (const d of PATHS) out.halo.push(vec(d, "halo"));
  const e = figma.createEllipse(); parent.appendChild(e); e.name = "disc";
  e.resize(2 * DISC.r * f, 2 * DISC.r * f); e.x = (DISC.cx - DISC.r) * f; e.y = (DISC.cy - DISC.r) * f; e.fills = [paint("paper")]; e.strokes = [];
  out.disc = e;
  for (const d of PATHS) out.line.push(vec(d, "line"));
  return out;
}

for (const ch of [...art.children]) ch.remove();
const s = stroked(art, k);
const sx = stk.absoluteTransform[0][2], sy = stk.absoluteTransform[1][2];
const ax = art.absoluteTransform[0][2], ay = art.absoluteTransform[1][2];
// outlineStroke puts the new node at the current page's root, so it is moved into art and placed on the render bounds.
const outline = (v) => {
  const rb = v.absoluteRenderBounds;
  const o = v.outlineStroke(); if (!o) rae.dur("no outline came out: " + v.name);
  if (o.parent !== art) art.appendChild(o);
  o.x = rb.x - ax; o.y = rb.y - ay;
  const ob = o.absoluteBoundingBox;
  if (Math.abs(ob.x - rb.x) > 0.02 || Math.abs(ob.y - rb.y) > 0.02 || Math.abs(ob.width - rb.width) > 0.05 || Math.abs(ob.height - rb.height) > 0.05)
    rae.dur("outline bounds do not match: " + v.name);
  v.remove(); return o;
};
const haloParts = s.halo.map(outline), lineParts = s.line.map(outline);
const halo = figma.flatten([figma.union([...haloParts, s.disc], art)], art, 0);
halo.name = "halo"; halo.fills = [paint("paper")]; halo.strokes = [];
const line = figma.flatten([figma.union(lineParts, art)], art, 1);
line.name = "line"; line.fills = [paint("on-accent")]; line.strokes = [];
for (const n of [halo, line]) n.constraints = { horizontal: "SCALE", vertical: "SCALE" };
art.constraints = { horizontal: "SCALE", vertical: "SCALE" };
if (art.children.map((c) => c.name).join(",") !== "halo,line") rae.dur("art order: " + art.children.map((c) => c.name).join(","));
const rel = (n) => { const b = n.absoluteBoundingBox; return [b.x - sx, b.y - sy, b.width, b.height].map((v) => v.toFixed(3)).join(" "); };
print("NEW halo " + rel(halo) + " · line " + rel(line) + " · k " + k.toFixed(5));

const ref = figma.createFrame(); stk.parent.appendChild(ref); ref.name = "tmp/logo-ref"; ref.resize(stk.width, stk.height); ref.fills = []; ref.clipsContent = false;
ref.x = stk.x; ref.y = stk.y + stk.height + 4000;
stroked(ref, k);
for (const sc of [1, 4]) {
  const a = await rae.snap(stk, { scale: sc }), b = await rae.snap(ref, { scale: sc });
  print("SNAP main@" + sc + " => " + (a.ok ? a.path : a.error));
  print("SNAP ref@" + sc + " => " + (b.ok ? b.path : b.error));
}
ref.remove();

print("SVG-BEGIN");
print(await stk.exportAsync({ format: "SVG_STRING", svgIdAttribute: false }));
print("SVG-END");
print("INSTANCES " + (await stk.getInstancesAsync()).length);
