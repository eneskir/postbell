// Read-only Figma plugin script that prints a frame's node tree; send it with
// `const FRAMES = ["today/V2 · default"]; const ROOT = "body"; const DEPTH = 7;` on top.
if (typeof FRAMES === "undefined") throw new Error("FRAMES is not defined");
if (figma.root.name !== "Postbell") throw new Error("Wrong file: " + figma.root.name);
const des = figma.root.children.find((p) => p.name === "02 Tasarımlar");
await des.loadAsync();
const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const varName = async (id) => {
  const v = await figma.variables.getVariableByIdAsync(id);
  return v ? v.name : "?";
};
async function paint(list, bound) {
  if (!Array.isArray(list) || list.length === 0) return "";
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.visible === false) continue;
    const b = bound && bound[i] && bound[i].id ? await varName(bound[i].id) : null;
    out.push(b ? "$" + b : p.type === "SOLID" ? hex(p.color) + (p.opacity !== undefined && p.opacity < 1 ? "/" + p.opacity.toFixed(2) : "") : p.type);
  }
  return out.join("+");
}
async function line(n, frame, d) {
  const abs = n.absoluteTransform, f = frame.absoluteTransform;
  const x = Math.round(abs[0][2] - f[0][2]), y = Math.round(abs[1][2] - f[1][2]);
  let s = "  ".repeat(d) + n.name + " [" + n.type + (n.type === "INSTANCE" && n.mainComponent ? ":" + n.mainComponent.name : "") + "] ";
  s += Math.round(n.width) + "x" + Math.round(n.height) + " @" + x + "," + y;
  if (n.visible === false) s += " HIDDEN";
  if (n.opacity !== undefined && n.opacity < 1) s += " op" + n.opacity.toFixed(2);
  if (n.layoutMode && n.layoutMode !== "NONE")
    s += " " + n.layoutMode[0] + " gap" + n.itemSpacing + " pad" + [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].join("/") + " " + (n.primaryAxisAlignItems || "") + "/" + (n.counterAxisAlignItems || "");
  if (n.layoutSizingHorizontal) s += " " + n.layoutSizingHorizontal[0] + n.layoutSizingVertical[0];
  if ("fills" in n && n.type !== "TEXT") {
    const p = await paint(n.fills, n.boundVariables && n.boundVariables.fills);
    if (p) s += " fill " + p;
  }
  if ("strokes" in n && n.strokes.length) s += " stroke " + (await paint(n.strokes, n.boundVariables && n.boundVariables.strokes)) + " w" + (typeof n.strokeWeight === "number" ? n.strokeWeight : "mix");
  if (typeof n.cornerRadius === "number" && n.cornerRadius) s += " r" + n.cornerRadius;
  if (n.type === "TEXT") {
    const fn = n.fontName === figma.mixed ? "mix" : n.fontName.style;
    const lh = n.lineHeight === figma.mixed ? "mix" : n.lineHeight.unit === "AUTO" ? "auto" : Math.round(n.lineHeight.value);
    s += " «" + n.characters.replace(/\n/g, " / ").slice(0, 60) + "» " + (n.fontSize === figma.mixed ? "mix" : n.fontSize) + "/" + fn + "/lh" + lh;
    s += " " + (await paint(n.fills, n.boundVariables && n.boundVariables.fills));
    if (n.textStyleId && typeof n.textStyleId === "string") {
      const st = await figma.getStyleByIdAsync(n.textStyleId);
      if (st) s += " style:" + st.name;
    }
  }
  print(s);
}
async function walk(n, frame, d) {
  await line(n, frame, d);
  if (d >= DEPTH || !("children" in n)) return;
  for (const c of n.children) await walk(c, frame, d + 1);
}
for (const name of FRAMES) {
  const frame = des.findOne((x) => x.type === "FRAME" && x.name === name);
  if (!frame) { print("MISSING " + name); continue; }
  const root = typeof ROOT === "string" ? frame.findOne((x) => x.name === ROOT) || frame : frame;
  print("== " + name + " " + Math.round(frame.width) + "x" + Math.round(frame.height) + " · root " + root.name);
  await walk(root, frame, 0);
}
