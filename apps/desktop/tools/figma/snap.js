// Read-only Figma plugin script that snapshots design frames for visual pairs; a `const ONLY = "<regex>";` line on top narrows the frames.
if (figma.root.name !== "Postbell") rae.dur("wrong file: " + figma.root.name);
const des = figma.root.children.find((p) => p.name === "02 Tasarımlar");
await des.loadAsync();
const re =
  typeof ONLY === "string"
    ? new RegExp(ONLY)
    : /( · nav-|^brand-new\/V\d · |^brand-settings\/V\d · |^contents\/V\d · (error|empty)$|^today\/V\d · (brand-created|default|no-selection|empty|loading|error|file-missing|account-missing|hover-focus|unscheduled|unscheduled-selected|toast)$|^today-all\/V\d · (default|empty|loading|first-run)$)/;
const frames = des.findAll((x) => x.type === "FRAME" && x.parent && x.parent.type !== "INSTANCE" && re.test(x.name));
print("FRAMES " + frames.length);
for (const f of frames) {
  const s = await rae.snap(f, { scale: 1 });
  print(`SNAP ${f.name} | ${Math.round(f.width)}x${Math.round(f.height)} => ${s.path || "ERROR " + s.error}`);
}
