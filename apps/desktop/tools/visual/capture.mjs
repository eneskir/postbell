// Captures the fake shell's screens in headless Edge over CDP, with no window: run `npm run dev`, then
// `node tools/visual/capture.mjs <out folder> [--only <regex>]`.
// File names follow the Figma frame (`today/V2 · nav-min` → `today_v2--nav-min.png`); app-only screens start with `app--`.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, findPage } from "../cdp.mjs";

const args = process.argv.slice(2);
const out = args[0];
const only = args.includes("--only") ? new RegExp(args[args.indexOf("--only") + 1]) : null;
if (!out) throw new Error("usage: node tools/visual/capture.mjs <out folder> [--only <regex>]");
mkdirSync(out, { recursive: true });
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!EDGE) throw new Error("Edge not found");
const PORT = 9334;
const BASE = "http://localhost:5173/";
const profile = join(tmpdir(), "postbell-visual-edge");
const proc = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const say = (...a) => {
  const l = a.join(" ");
  log.push(l);
  console.log(l);
};

const { ws, send, ev } = await connect(await findPage(PORT, 60));

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
// The clock starts at 14:20 on 2026-11-12 like the Figma mockups, or at `clock=HH:MM:ss` from the URL; the app never reads `clock`.
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => { const R = Date; const [h, m, s] = (new URLSearchParams(location.search).get("clock") ?? "14:20:00").split(":").map(Number); const off = new R(2026, 10, 12, h, m, s || 0).getTime() - R.now(); class D extends R { constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); } static now() { return R.now() + off; } } globalThis.Date = D; })();`,
});
// Headless Edge denies clipboard writes unless granted.
await send("Browser.grantPermissions", { origin: new URL(BASE).origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch((e) => say("clipboard permission failed:", e.message));

const at = async (sel, text) => {
  const p = await ev(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const t = ${JSON.stringify(text ?? null)};
    const name = (e) => (e.innerText || "").trim();
    const e = t === null ? els[0] : els.find((e) => name(e) === t || e.getAttribute("aria-label") === t) ?? els.find((e) => name(e).includes(t));
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!p) throw new Error(`not found: ${sel} «${text ?? ""}»`);
  return p;
};
// Real mouse events: Radix menus open on pointer down, not on click.
const mouse = (type, x, y, down) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !down ? "none" : "left", buttons: down ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
const hover = async (sel, text) => {
  const p = await at(sel, text);
  await mouse("mouseMoved", p.x, p.y);
  await sleep(150);
  return p;
};
const tap = async (sel, text) => {
  const p = await hover(sel, text);
  await mouse("mousePressed", p.x, p.y, true);
  await mouse("mouseReleased", p.x, p.y, false);
  await sleep(300);
};
const key = async (k, code, vk) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
  await sleep(200);
};
const enter = () => key("Enter", "Enter", 13);
const esc = () => key("Escape", "Escape", 27);
const retype = async (value) => {
  const tag = await ev(`(() => { const a = document.activeElement; if (a && a.select) a.select(); return a ? a.tagName + "." + a.className : "none"; })()`);
  if (!tag.startsWith("INPUT")) throw new Error("focus is not in a field: " + tag);
  await send("Input.insertText", { text: value });
  await sleep(200);
};
const dragTo = async (from, x, y) => {
  await mouse("mouseMoved", from.x, from.y);
  await mouse("mousePressed", from.x, from.y, true);
  const n = 8;
  for (let i = 1; i <= n; i++) {
    await mouse("mouseMoved", from.x + ((x - from.x) * i) / n, from.y + ((y - from.y) * i) / n, true);
    await sleep(30);
  }
  await sleep(300);
};
const cancelDrag = async () => {
  await esc();
  await mouse("mouseReleased", 1300, 600);
};

const open = async (brand = "Initech", page = "Bugün") => {
  await tap(".nav-brand", brand);
  await tap(".nav-row", page);
};
const groupMenu = async (g = "Müşteri A") => {
  await hover(".nav-group", g);
  await tap(`[aria-label="${g} grubunun menüsü"]`);
};
const ungroup = async () => {
  await groupMenu();
  await tap('[role="menuitem"]', "Grubu sil");
};
const collapse = () => tap(".nav-row", "Daralt");
const away = () => mouse("mouseMoved", 1300, 600);
const brandSettings = async (brand = "Initech") => {
  await hover(".nav-brand", brand);
  await tap(`[aria-label="${brand} menüsü"]`);
  await tap('[role="menuitem"]', "Marka ayarları");
};
const settings = async (brand = "Initech") => {
  await open(brand);
  await brandSettings(brand);
};
// After the group menu Chromium keeps keyboard focus mode, so the blur keeps a :focus-visible ring out of the shot.
const expand = async (brand = "Initech") => {
  await tap(".nav-brand", brand);
  await ev(`document.activeElement?.blur()`);
};
const noDump = () => ev(`document.querySelectorAll(".dev-dump").forEach((e) => (e.closest(".page-body").style.display = "none"))`);
const row = (t) => tap(".share-row-main", t);
const pick = async (label, value) => {
  await ev(`(() => { const l = [...document.querySelectorAll("aside.panel label")].find((x) => x.innerText.trim() === ${JSON.stringify(label)}); const s = document.getElementById(l.htmlFor); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await sleep(200);
};
const keyboard = () => key("Shift", "ShiftLeft", 16);
const clearTime = async (format) => {
  await brandSettings();
  await ev(`(() => { const f = [...document.querySelectorAll(".setting-row")].find((e) => e.innerText.includes(${JSON.stringify(format)})).querySelector(".field-time"); f.focus(); f.select(); })()`);
  await key("Backspace", "Backspace", 8);
  await ev(`document.activeElement.blur()`);
  await tap(".nav-row", "Bugün");
};

const SETUP = { width: 560, height: 360 };
const press = async (label, until) => {
  await tap(".setup-actions .button", label);
  for (let i = 0; i < 50 && !(await ev(`!!document.querySelector(${JSON.stringify(until)})`)); i++) await sleep(100);
  if (!(await ev(`!!document.querySelector(${JSON.stringify(until)})`))) throw new Error(`timed out: ${until}`);
  await mouse("mouseMoved", 0, 0);
};

const scenes = [
  ["today_v2--nav-groups", "", async () => { await open(); await away(); }],
  ["today_v2--nav-collapsed", "", async () => { await open(); await collapse(); await away(); }],
  ["today_v2--nav-min", "", async () => { await open(); await ungroup(); const h = await at(".nav-handle"); await dragTo(h, 180, h.y); await mouse("mouseReleased", 180, h.y); await away(); }],
  ["today_v2--nav-max-drag", "", async () => { await open(); await ungroup(); const h = await at(".nav-handle"); await dragTo(h, 330, h.y); return () => mouse("mouseReleased", 330, h.y); }],
  ["today_v2--nav-group-closed", "", async () => { await open(); await tap(".nav-group-toggle", "Müşteri A"); await away(); }],
  ["today_v2--nav-group-menu", "", async () => { await open(); await groupMenu(); }],
  ["today_v2--nav-group-rename", "", async () => { await open(); await groupMenu(); await tap('[role="menuitem"]', "Yeniden adlandır"); await away(); }],
  ["today_v2--nav-brand-drag", "", async () => { await open(); const p = await at(".nav-brand", "Initech"); await dragTo(p, p.x + 96, 308); return cancelDrag; }],
  ["today_v2--nav-toggle-hover", "", async () => { await open(); await ungroup(); await away(); await hover(".nav-row", "Daralt"); }],
  ["today_v2--nav-collapsed-tooltip", "", async () => { await open(); await collapse(); await away(); await hover(".nav-group"); await sleep(900); }],
  ["today_v2--nav-collapsed-clash", "", async () => {
    await open();
    await groupMenu();
    await tap('[role="menuitem"]', "Yeniden adlandır");
    await retype("Müşteri Ayva");
    await enter();
    await groupMenu("Müşteri Ayva");
    await tap('[role="menuitem"]', "Yeni grup");
    await retype("Müşteri Ağaç");
    await enter();
    await collapse();
    await away();
  }],
  ["today_v2--nav-resize-hover", "", async () => { await open(); await ungroup(); await away(); await hover(".nav-handle"); }],
  ["today_v2--nav-group-drag", "?store=groups", async () => { await open(); const p = await at(".nav-group-toggle", "Müşteri B"); await dragTo(p, p.x + 96, 235); return cancelDrag; }],
  ["contents_v1--nav-collapsed", "", async () => { await open("Initech", "İçerikler"); await ungroup(); await collapse(); await away(); }],
  ["settings_v1--nav-collapsed", "", async () => { await open(); await ungroup(); await tap(".nav-row", "Ayarlar"); await collapse(); await away(); }],
  ["app--drag-over-badge", "", async () => {
    await open();
    const p = await at(".nav-brand", "Globex");
    const q = await at(".nav-brand", "Initech");
    await dragTo(p, q.x, q.y);
    say("  check:", await ev(`(() => { const r = document.querySelector('.nav-brand[data-brand="initech"]'); const row = r.closest(".nav-brand-row"); const b = r.querySelector(".nav-badge").getBoundingClientRect(); return "badge right " + Math.round(b.right) + ", ⋯ opacity " + getComputedStyle(row.querySelector(".nav-actions")).opacity + ", row background " + getComputedStyle(r).backgroundColor; })()`));
    return cancelDrag;
  }],
  ["contents_v1--empty", "?packages=empty", async () => { await open("Initech", "İçerikler"); await away(); }],
  ["contents_v1--error", "?packages=missing", async () => { await open("Initech", "İçerikler"); await away(); }],
  ["app--contents-unreadable", "?packages=unreadable", async () => { await open("Initech", "İçerikler"); await away(); }],
  ["app--contents-rejected", "", async () => { await open("Initech", "İçerikler"); await away(); }],
  ["contents_v1--default", "", async () => { await ungroup(); await open("Initech", "İçerikler"); await tap(".share-row-main", "The dog hiding in the corner"); await away(); }],
  ["contents_v1--no-selection", "", async () => { await ungroup(); await open("Initech", "İçerikler"); await away(); }],
  ["contents_v1--loading", "?packages=wait", async () => { await ungroup(); await open("Initech", "İçerikler"); await away(); }],
  ["app--contents-go-late", "", async () => {
    await ungroup();
    await open("Initech", "İçerikler");
    await tap(".share-row-main", "The dog hiding in the corner");
    await tap("aside.panel button", "Geciken paylaşıma git");
    await away();
  }],
  ["app--contents-skip-left", "", async () => {
    await ungroup();
    await open("Initech", "İçerikler");
    await tap(".share-row-main", "The dog hiding in the corner");
    await tap("aside.panel button", "Kalan paylaşımları atla");
    await away();
  }],
  ["calendar_v1--week", "", async () => { await ungroup(); await open("Initech", "Takvim"); await away(); }],
  ["calendar_v1--empty", "", async () => { await ungroup(); await open("Initech", "Takvim"); await tap(".calendar-nav .button", "›"); await away(); }],
  ["calendar_v1--selected", "", async () => {
    await ungroup();
    await open("Initech", "Takvim");
    await tap(".chip-late");
    await away();
    say("  check:", await ev(`(() => { const w = [...document.querySelectorAll(".calendar-column")].map((c) => c.getBoundingClientRect().width.toFixed(1)); const over = [...document.querySelectorAll(".chip, .chip *, .calendar-day")].filter((e) => e.scrollWidth > e.clientWidth + 1).length; return "columns " + [...new Set(w)].join("/") + " x" + w.length + ", overflowing " + over; })()`));
  }],
  ["calendar_v1--loading", "?packages=wait", async () => { await ungroup(); await open("Initech", "Takvim"); await away(); }],
  ["calendar_v1--error", "?packages=missing", async () => { await ungroup(); await open("Initech", "Takvim"); await away(); }],
  ["calendar_v1--unscheduled", "", async () => { await ungroup(); await open(); await clearTime("Pinterest"); await tap(".nav-row", "Takvim"); await away(); }],
  ["app--calendar-finished", "", async () => {
    await ungroup();
    await open("Initech", "Takvim");
    await tap(".chip-late");
    await tap("aside.panel button", "Paylaşıldı olarak işaretle");
    await esc();
    await away();
    say("  check:", await ev(`document.querySelector(".page-summary").innerText + " | finished cards " + document.querySelectorAll(".chip-finished").length`));
  }],
  ["app--calendar-keys", "", async () => {
    await ungroup();
    await open("Initech", "Takvim");
    await ev(`document.querySelector(".chip-late").focus()`);
    await keyboard();
    const order = [];
    for (const [k, c, n] of [["ArrowDown", "ArrowDown", 40], ["ArrowRight", "ArrowRight", 39], ["ArrowUp", "ArrowUp", 38], ["ArrowLeft", "ArrowLeft", 37], ["ArrowLeft", "ArrowLeft", 37]]) {
      await key(k, c, n);
      order.push(k + " → " + (await ev(`document.activeElement.dataset.day + "/" + document.activeElement.dataset.index`)));
    }
    say("  keys:", order.join(", "));
    // A button activates on the key's text, so Enter is sent with it.
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await sleep(300);
    say("  enter:", await ev(`document.querySelector("aside.panel h2")?.innerText ?? "no panel"`));
  }],
  ["brand-new_v1--default", "", async () => { await tap(".nav-row", "Marka ekle"); await away(); }],
  ["brand-settings_v1--default", "", async () => { await settings(); await away(); }],
  ["brand-settings_v1--remove-confirm", "", async () => { await settings(); await tap("button", "Kaldır…"); await away(); }],
  ["brand-settings_v1--sticker-picker", "", async () => { await settings(); await tap("button", "Başka seç"); await away(); }],
  ["brand-settings_v1--schedule-error", "", async () => {
    await settings();
    await ev(`[...document.querySelectorAll(".setting-row")].find((e) => e.innerText.includes("Pinterest")).querySelector("input").focus()`);
    await retype("25:00");
    await away();
  }],
  ["brand-settings_v1--schedule-empty", "", async () => {
    await settings();
    const n = await ev(`document.querySelectorAll(".field-time").length`);
    for (let i = 0; i < n; i++) {
      await ev(`(() => { const f = document.querySelectorAll(".field-time")[${i}]; f.focus(); f.select(); })()`);
      await key("Backspace", "Backspace", 8);
    }
    await ev(`document.activeElement.blur()`);
    await away();
  }],
  ["app--brand-times-no-accounts", "", async () => { await settings("Globex"); await away(); }],
  ["today_v2--default", "", async () => { await open(); await ungroup(); await row("09:00"); await away(); }],
  ["today_v2--no-selection", "", async () => { await open(); await ungroup(); await away(); }],
  ["today_v2--empty", "?packages=future", async () => { await open(); await ungroup(); await away(); }],
  ["today_v2--brand-created", "?packages=future", async () => { await ungroup(); await open("Globex"); await away(); }],
  ["today_v2--loading", "?packages=wait", async () => { await open(); await ungroup(); await away(); }],
  ["today_v2--error", "?store=corrupt", async () => { await away(); }],
  ["today_v2--file-missing", "?packages=no-files", async () => { await open(); await ungroup(); await row("09:00"); await away(); }],
  ["today_v2--account-missing", "", async () => { await ungroup(); await open("Globex"); await row("X"); await away(); }],
  ["today_v2--hover-focus", "", async () => {
    await open();
    await ungroup();
    await row("09:00");
    await keyboard();
    await ev(`[...document.querySelectorAll("aside.panel button")].find((b) => b.innerText.trim() === "Paylaşıldı olarak işaretle").focus()`);
    await hover(".share-row-main", "Instagram Reels");
  }],
  ["today_v2--unscheduled", "", async () => { await open(); await ungroup(); await clearTime("TikTok"); await row("09:00"); await away(); }],
  ["today_v2--unscheduled-selected", "", async () => { await open(); await ungroup(); await clearTime("TikTok"); await row("TikTok"); await away(); }],
  ["today_v2--toast", "", async () => { await open(); await ungroup(); await row("09:00"); await tap("aside.panel button", "Metni kopyala"); await sleep(200); await away(); }],
  ["today-all_v1--default", "", async () => { await ungroup(); await expand(); await row("09:00"); await noDump(); await away(); }],
  ["today-all_v1--empty", "?packages=future", async () => { await ungroup(); await expand(); await noDump(); await away(); }],
  ["today-all_v1--loading", "?packages=wait", async () => { await ungroup(); await expand(); await away(); }],
  ["today-all_v1--first-run", "?store=missing", async () => { await noDump(); await away(); }],
  ["app--home-partial-error", "?packages=mixed", async () => { await ungroup(); await noDump(); await away(); }],
  ["app--home-partial-error-panel", "?packages=mixed", async () => { await ungroup(); await expand(); await row("09:00"); await noDump(); await sleep(300); await away(); }],
  ["accounts_v1--default", "", async () => { await ungroup(); await open("Initech", "Hesaplar"); await away(); }],
  ["accounts_v1--empty", "?packages=empty", async () => { await ungroup(); await open("Globex", "Hesaplar"); await away(); }],
  ["accounts_v1--loading", "?packages=wait", async () => { await ungroup(); await open("Globex", "Hesaplar"); await away(); }],
  ["accounts_v1--add-form", "", async () => { await ungroup(); await open("Globex", "Hesaplar"); await tap(".account-row", "Instagram"); await away(); }],
  ["accounts_v1--add-form-error", "", async () => {
    await ungroup();
    await open("Globex", "Hesaplar");
    await tap(".account-row", "Instagram");
    await tap("aside.panel button", "Hesabı kaydet");
    await away();
  }],
  ["accounts_v1--edit-form", "", async () => { await ungroup(); await open("Initech", "Hesaplar"); await tap(".account-row-main", "Instagram @initech, düzenle"); await away(); }],
  ["accounts_v1--remove-confirm", "", async () => {
    await ungroup();
    await open("Initech", "Hesaplar");
    await tap(".account-row-main", "Instagram @initech, düzenle");
    await tap("aside.panel button", "Hesabı kaldır…");
    await away();
  }],
  ["app--account-add-general", "", async () => {
    await ungroup();
    await open("Initech", "Hesaplar");
    await tap(".accounts > .button", "Hesap ekle");
    await pick("Platform", "instagram");
    await pick("İçerik dili", "tr");
    await away();
  }],
  ["app--close-hover", "", async () => { await open(); await ungroup(); await row("09:00"); await hover(".window-button-close"); }],
  ["setup_v1--welcome", "?setup=setup", async () => {}, SETUP],
  ["setup_v1--installing", "?setup=setup&wait", async () => { await press("Kur", ".setup-busy"); await sleep(400); }, SETUP],
  ["setup_v1--done", "?setup=setup", async () => { await press("Kur", ".setup-done"); }, SETUP],
  ["setup_v1--update", "?setup=setup&installed=older", async () => {}, SETUP],
  ["setup_v1--same", "?setup=setup&installed=same", async () => {}, SETUP],
  ["setup_v1--newer", "?setup=setup&installed=newer", async () => {}, SETUP],
  ["setup_v1--error", "?setup=setup&error=SETUP_APP_RUNNING", async () => { await press("Kur", ".setup-error"); }, SETUP],
  ["uninstall_v1--confirm", "?setup=uninstall", async () => {}, SETUP],
  ["uninstall_v1--done", "?setup=uninstall", async () => { await press("Kaldır", ".setup-done"); }, SETUP],
  ["uninstall_v1--error", "?setup=uninstall&error=UNINSTALL_DIR_LOCKED", async () => { await press("Kaldır", ".setup-error"); }, SETUP],
  // «Saati geldi» must appear from the timer alone: shoot before 18:30, then wait past it with no input events.
  ["app--time-due", "?clock=18:29:35", async () => {
    await open();
    await ungroup();
    await away();
    const tiktokRow = `[...document.querySelectorAll(".share-row")].map((r) => r.innerText.replace(/\\s+/g, " ")).find((t) => t.includes("TikTok")) ?? "-"`;
    const clock = `new Date().toTimeString().slice(0, 8)`;
    say("  before:", await ev(clock), "|", await ev(tiktokRow));
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(out, "app--time-due-before.png"), Buffer.from(shot.data, "base64"));
    const left = await ev(`new Date(2026, 10, 12, 18, 30, 2).getTime() - Date.now()`);
    if (left < 0) throw new Error(`the before shot came after 18:30 (${await ev(clock)})`);
    await sleep(left);
    say("  after:", await ev(clock), "|", await ev(tiktokRow));
  }],
];

let failed = 0;
for (const [name, query, setup, size] of scenes) {
  if (only && !only.test(name)) continue;
  try {
    const { width, height } = size ?? { width: 1440, height: 900 };
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: BASE + query });
    // Up to 20 s: Vite's first page after a cold start can take over 5 s.
    for (let i = 0; i < 200; i++) {
      if (await ev(`document.readyState === "complete" && !!document.querySelector(".nav-list .nav-brand, .setup")`).catch(() => false)) break;
      await sleep(100);
    }
    await sleep(300);
    const after = await setup();
    await sleep(400);
    await ev(`document.getAnimations().forEach((a) => a.finish())`);
    await sleep(100);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(out, `${name}.png`), Buffer.from(shot.data, "base64"));
    const state = await ev(`(() => { const a = document.activeElement; const crumbs = document.querySelector(".crumbs")?.innerText.replace(/\\s+/g, " ") ?? ""; return "path: " + crumbs + " | focus: " + (a ? a.tagName + (a.className ? "." + String(a.className).split(" ")[0] : "") : "-") + " | menu width: " + Math.round(document.querySelector(".nav")?.getBoundingClientRect().width ?? 0); })()`);
    say("ok", name, "|", state);
    if (after) await after();
  } catch (e) {
    failed++;
    say("ERROR", name, String(e.message ?? e).slice(0, 300));
  }
}
writeFileSync(join(out, "capture.txt"), log.join("\n") + "\n");
ws.close();
proc.kill();
await sleep(500);
process.exit(failed ? 1 : 0);
