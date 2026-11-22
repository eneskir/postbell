// Installs, updates and uninstalls the setup file under a test root, then checks disk and registry:
//   node apps/desktop/tools/self-test/setup-run.mjs <evidence file> [--old <postbell.exe of 0.1.0>]
// `--setup-root` keeps every path under the root and the registry under `Software\Postbell setup test\`.
// Clicks go through WebView2's debugging port, opened for these processes only by WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findPage } from "../cdp.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const OUT = args[0];
if (!OUT) throw new Error("usage: node tools/self-test/setup-run.mjs <evidence file> [--old <postbell.exe of 0.1.0>]");
const version = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")).version;
const conf = JSON.parse(readFileSync(join(APP, "src-tauri", "tauri.conf.json"), "utf8"));
const publisher = conf.bundle.publisher;
const ID = conf.identifier;
const legacyIds = [...readFileSync(join(APP, "src-tauri", "src", "setup.rs"), "utf8").matchAll(/^pub const LEGACY_IDENTIFIER: &str = "([^"]+)";\r?$/gm)];
if (legacyIds.length !== 1) throw new Error(`setup.rs: expected one LEGACY_IDENTIFIER, found ${legacyIds.length}`);
const LEGACY_ID = legacyIds[0][1];
const SETUP = join(APP, "src-tauri/target/release/bundle/setup", `Postbell_${version}_x64-setup.exe`);
if (!existsSync(SETUP)) {
  console.log(`no setup file: ${SETUP}; run \`npm run package\` first`);
  process.exit(2);
}
const LOCAL = process.env.LOCALAPPDATA ?? "";
const OLD = args.includes("--old") ? args[args.indexOf("--old") + 1] : join(LOCAL, "Postbell", "postbell.exe");

const lines = [];
const say = (...a) => {
  const l = a.join(" ");
  lines.push(l);
  console.log(l);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (cond, what) => {
  ok &&= !!cond;
  say(`  [${cond ? "pass" : "FAIL"}] ${what}`);
};
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const run = (cmd, a) => {
  try {
    return execFileSync(cmd, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    return `(exit ${e.status}) ${String(e.stdout ?? "").trim()}`;
  }
};
const ps = (script) => run("powershell", ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${script}`]);
const fileVersion = (f) => ps(`(Get-Item -LiteralPath '${f}').VersionInfo.FileVersion`);
const lnkTarget = (f) => ps(`(New-Object -ComObject WScript.Shell).CreateShortcut('${f}').TargetPath`);
const lnkAumid = (f) => ps(`(New-Object -ComObject Shell.Application).Namespace('${dirname(f)}').ParseName('${f.split(/[\\/]/).pop()}').ExtendedProperty('System.AppUserModel.ID')`);
const regValue = (key, name) => {
  const m = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*)$`, "m").exec(run("reg", ["query", `HKCU\\${key}`, "/v", name]));
  return m ? m[1].trim() : null;
};
const regExists = (key) => !run("reg", ["query", `HKCU\\${key}`]).startsWith("(exit");
const tasks = (image) => run("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"]).split(/\r?\n/).filter((l) => l.startsWith('"'));

function realState() {
  const list = (d) => (existsSync(d) ? readdirSync(d).map((n) => { const s = statSync(join(d, n)); return `${n} ${s.size} ${s.mtimeMs}`; }) : ["(none)"]);
  const stamp = (f) => (existsSync(f) ? String(statSync(f).mtimeMs) : "(none)");
  return JSON.stringify({
    install: list(join(LOCAL, "Postbell")),
    data: [ID, LEGACY_ID].map((id) => list(join(process.env.APPDATA ?? "", id))),
    start: stamp(join(process.env.APPDATA ?? "", "Microsoft/Windows/Start Menu/Programs/Postbell.lnk")),
    uninstallKey: run("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Postbell", "/s"]),
    nsisKey: run("reg", ["query", "HKCU\\Software\\Rae Software\\Postbell", "/s"]),
    runValue: run("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "Postbell"]),
  });
}

const ROOT = join(tmpdir(), `postbell-setup-run-${Date.now()}`);
const DL = join(ROOT, "Downloads");
mkdirSync(DL, { recursive: true });
const FILE = join(DL, `Postbell_${version}_x64-setup.exe`);
copyFileSync(SETUP, FILE);
const P = {
  dir: join(ROOT, "Local", "Postbell"),
  exe: join(ROOT, "Local", "Postbell", "postbell.exe"),
  start: join(ROOT, "StartMenu", "Postbell.lnk"),
  desktop: join(ROOT, "Desktop", "Postbell.lnk"),
  roaming: join(ROOT, "Roaming", ID),
  local: join(ROOT, "Local", ID),
  legacyRoaming: join(ROOT, "Roaming", LEGACY_ID),
  legacyLocal: join(ROOT, "Local", LEGACY_ID),
};
const TEST_REG = "Software\\Postbell setup test";
const UNINSTALL_KEY = `${TEST_REG}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Postbell`;
const NSIS_KEY = `${TEST_REG}\\Software\\Rae Software\\Postbell`;
const notifKey = (id) => `${TEST_REG}\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\${id}`;
const write = (f, text) => {
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, text);
};
const readOr = (f) => (existsSync(f) ? readFileSync(f, "utf8") : null);

async function launch(exe, extra, port, report) {
  const p = spawn(exe, [...extra, "--setup-root", ROOT, "--self-test", report, "--self-test-stay"], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    stdio: "ignore",
  });
  const spawnError = await new Promise((r) => {
    p.once("error", (e) => r(e));
    p.once("spawn", () => r(null));
  });
  if (spawnError) throw new Error(`did not start: ${spawnError.message}`);
  const exited = new Promise((r) => p.once("exit", (code) => r(code)));
  const page = await findPage(port, 100);
  if (!page) throw new Error("the debugging port did not open");
  const { ws, ev } = await connect(page);
  const closed = new Promise((r) => ws.addEventListener("close", r, { once: true }));
  const waitFor = async (expr, what, ms = 15000) => {
    for (let t = 0; t < ms; t += 50) {
      if (await ev(expr).catch(() => false)) return;
      await sleep(50);
    }
    throw new Error(`timed out: ${what}`);
  };
  const screen = async (name) => {
    await waitFor(`!!document.querySelector(".setup-${name}")`, `screen ${name}`);
    return ev(`(() => { const q = (s) => document.querySelector(s)?.innerText.trim() ?? ""; return [q(".setup .tag"), q(".setup-title"), q(".setup-line"), [...document.querySelectorAll(".setup-actions .button")].map((b) => b.innerText.trim() + (b.disabled ? " (disabled)" : "")).join(" + ")].filter(Boolean).join(" | "); })()`);
  };
  const press = (label) => ev(`[...document.querySelectorAll(".setup-actions .button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)} && !b.disabled).click()`);
  const tick = () => ev(`document.querySelector(".setup-check input").click()`);
  return { pid: p.pid, exited, closed, ev, waitFor, screen, press, tick };
}

async function act(w, label, next) {
  const t0 = performance.now();
  await w.press(label);
  const text = await w.screen(next);
  return { text, ms: Math.round(performance.now() - t0) };
}

// The temp WebView2 folder (and the uninstall temp exe) goes some time after the window closes (`setup.rs` `cleanup_on_exit`).
async function cleaned(pid, extra = []) {
  const dir = join(tmpdir(), `Postbell-setup-${pid}`);
  for (let i = 0; i < 40 && [dir, ...extra].some(existsSync); i++) await sleep(250);
  return ![dir, ...extra].some(existsSync);
}

const before = realState();
try {
  say(`setup file ${FILE} (${statSync(FILE).size} bytes, version ${fileVersion(FILE)}); root ${ROOT}`);
  check(sha(FILE) === sha(join(APP, "src-tauri/target/release/postbell.exe")), "the setup file is byte for byte the built postbell.exe");

  say(`1. first install, with a desktop shortcut; the legacy id (${LEGACY_ID}) has data and a notification setting`);
  check(ID !== LEGACY_ID, `id ${ID}`);
  write(join(P.legacyRoaming, "logs", "postbell.log"), "old log");
  write(join(P.legacyRoaming, "background-notice-shown"), "old-1");
  write(join(P.legacyLocal, "EBWebView", "x"), "webview");
  run("reg", ["add", `HKCU\\${notifKey(LEGACY_ID)}`, "/v", "Enabled", "/t", "REG_DWORD", "/d", "0", "/f"]);
  const a = await launch(FILE, ["--setup"], 9361, join(ROOT, "r1.json"));
  say("  process started; a 64-bit exe with «setup» in its name started without asking for admin rights");
  say(`  screen: ${await a.screen("welcome")}`);
  check(JSON.parse(readFileSync(join(ROOT, "r1.json"), "utf8")).rendered === "setup:welcome", "self-test report: setup:welcome");
  await a.tick();
  const i1 = await act(a, "Kur", "done");
  say(`  screen: ${i1.text}; install ${i1.ms} ms`);
  check(i1.ms < 2000, "install takes under 2 s");
  check(existsSync(P.exe) && sha(P.exe) === sha(FILE), "the installed exe equals the setup file");
  check(existsSync(join(P.dir, "THIRD_PARTY_NOTICES.md")) && readFileSync(join(P.dir, "THIRD_PARTY_NOTICES.md")).equals(readFileSync(join(APP, "THIRD_PARTY_NOTICES.md"))), "the notices file was written from the exe's embedded copy, byte for byte the source");
  check(lnkTarget(P.start).toLowerCase() === P.exe.toLowerCase(), `the Start shortcut points at the installed exe (${lnkTarget(P.start)})`);
  check(lnkTarget(P.desktop).toLowerCase() === P.exe.toLowerCase(), "a desktop shortcut exists and points at the installed exe");
  check(lnkAumid(P.start) === ID && lnkAumid(P.desktop) === ID, `both shortcuts carry the notification id ${ID} (${lnkAumid(P.start)}, ${lnkAumid(P.desktop)})`);
  say(`  uninstall entry: ${run("reg", ["query", `HKCU\\${UNINSTALL_KEY}`]).split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean).join(" | ")}`);
  check(regValue(UNINSTALL_KEY, "Publisher") === publisher, "the uninstall entry has the publisher from tauri.conf.json");
  check(regValue(UNINSTALL_KEY, "DisplayVersion") === version && regValue(UNINSTALL_KEY, "UninstallString") === `"${P.exe}" --uninstall`, "the uninstall entry has the version and the uninstall command");
  check(!existsSync(P.legacyRoaming) && !existsSync(P.legacyLocal), "both legacy id folders are gone");
  check(readOr(join(P.roaming, "logs", "postbell.log")) === "old log" && readOr(join(P.roaming, "background-notice-shown")) === "old-1" && readOr(join(P.local, "EBWebView", "x")) === "webview", "the log, the background notice marker and WebView2 data moved to the new id's folders");
  check(regValue(notifKey(ID), "Enabled") === "0x0", "the notification setting (off) was copied to the new id");
  await a.press("Postbell'i aç");
  const c1 = await Promise.race([a.exited, sleep(5000).then(() => "timeout")]);
  check(c1 === 0 && readFileSync(join(ROOT, "opened.txt"), "utf8") === P.exe, `«Postbell'i aç»: the installed exe would open (a marker file in tests), the window closed (exit ${c1})`);
  check(await cleaned(a.pid), "the temp WebView2 folder was deleted");

  say("2. same version: reinstall; the legacy folder has a file that clashes with the new folder and a file only it has");
  write(join(P.legacyRoaming, "background-notice-shown"), "old-2");
  write(join(P.legacyRoaming, "old-only.txt"), "x");
  const desktopStamp = statSync(P.desktop).mtimeMs;
  await sleep(50);
  const b = await launch(FILE, ["--setup"], 9362, join(ROOT, "r2.json"));
  say(`  screen: ${await b.screen("same")}`);
  const i2 = await act(b, "Yeniden kur", "done");
  say(`  screen: ${i2.text}; ${i2.ms} ms`);
  check(readOr(join(P.roaming, "background-notice-shown")) === "old-1" && readOr(join(P.roaming, "old-only.txt")) === "x", "the file in the new folder was not overwritten, the legacy-only file moved");
  check(existsSync(P.legacyRoaming) && readdirSync(P.legacyRoaming).join(",") === "background-notice-shown", "the clashing file stayed in the legacy folder (no data loss)");
  check(lnkTarget(P.desktop).toLowerCase() === P.exe.toLowerCase(), "reinstalling kept the desktop shortcut");
  check(statSync(P.desktop).mtimeMs > desktopStamp && lnkAumid(P.desktop) === ID, "with the box unticked the existing desktop shortcut was rewritten with the new id");
  await b.press("Kapat");
  check((await Promise.race([b.exited, sleep(5000).then(() => "timeout")])) === 0, "«Kapat» closed the window");

  say("3. uninstall, data stays");
  mkdirSync(P.roaming, { recursive: true });
  writeFileSync(join(P.roaming, "store.json"), "{}");
  mkdirSync(P.local, { recursive: true });
  const u = await launch(P.exe, ["--uninstall"], 9363, join(ROOT, "r3.json"));
  check((await Promise.race([u.exited, sleep(5000).then(() => "timeout")])) === 0, "the installed exe copied itself to a temp folder and exited");
  const temp1 = tasks("Postbell-uninstall-*");
  say(`  temp copy: ${temp1.join(" ")}`);
  say(`  screen: ${await u.screen("confirm")}`);
  const i3 = await act(u, "Kaldır", "done");
  say(`  screen: ${i3.text}; ${i3.ms} ms`);
  check(!existsSync(P.dir) && !existsSync(P.start) && !existsSync(P.desktop), "the install folder and both shortcuts were deleted");
  check(!regExists(UNINSTALL_KEY), "the uninstall entry was deleted");
  check(existsSync(join(P.roaming, "store.json")) && existsSync(P.local) && existsSync(P.legacyRoaming), "data box unticked: the store, the WebView2 folder and the legacy id folder stayed");
  const tempExe = temp1.map((l) => l.split('","')[0].slice(1))[0];
  await u.press("Kapat");
  await u.closed;
  const tempPid = Number(temp1[0]?.split('","')[1]);
  check(await cleaned(tempPid, tempExe ? [join(tmpdir(), tempExe)] : []), `after the window closed the temp copy (${tempExe}) and the WebView2 folder were deleted`);

  say("4. update over a running 0.1.0");
  if (!existsSync(OLD) || !fileVersion(OLD).startsWith("0.1.0")) {
    say(`  skipped: no 0.1.0 exe (${OLD}, version ${existsSync(OLD) ? fileVersion(OLD) : "-"})`);
  } else {
    mkdirSync(P.dir, { recursive: true });
    copyFileSync(OLD, P.exe);
    writeFileSync(join(P.dir, "uninstall.exe"), "old NSIS uninstaller (test)");
    run("reg", ["add", `HKCU\\${NSIS_KEY}`, "/v", "Installer Language", "/t", "REG_SZ", "/d", "1055", "/f"]);
    const oldData = join(ROOT, "old-data");
    mkdirSync(oldData, { recursive: true });
    const old = spawn(P.exe, ["--self-test", join(ROOT, "r-old.json"), "--self-test-stay", "--data-dir", oldData], { stdio: "ignore" });
    const oldExit = new Promise((r) => old.once("exit", (code) => r(code)));
    for (let i = 0; i < 100 && !existsSync(join(ROOT, "r-old.json")); i++) await sleep(100);
    say(`  0.1.0 running (process ${old.pid}, self-test report ${existsSync(join(ROOT, "r-old.json")) ? "written" : "missing"})`);
    const g = await launch(FILE, ["--setup"], 9364, join(ROOT, "r4.json"));
    say(`  screen: ${await g.screen("update")}`);
    const e1 = await act(g, "Güncelle", "error");
    say(`  screen: ${e1.text}`);
    check(e1.text.includes("SETUP_APP_RUNNING") && e1.text.includes("Postbell'i kapat"), "0.1.0 does not know «--quit»: «Postbell kapanmadı» and «Postbell'i kapat»");
    const i4 = await act(g, "Postbell'i kapat", "done");
    say(`  screen: ${i4.text}; ${i4.ms} ms`);
    check((await Promise.race([oldExit, sleep(3000).then(() => "timeout")])) !== "timeout", "the running 0.1.0 was ended");
    check(sha(P.exe) === sha(FILE) && fileVersion(P.exe).startsWith(version), `the exe is now ${version}`);
    check(!existsSync(join(P.dir, "uninstall.exe")) && !regExists(NSIS_KEY), "NSIS leftovers (uninstaller and key) were deleted");
    check(i4.text.startsWith("Postbell güncellendi"), "title «Postbell güncellendi»");
    await g.press("Kapat");
    await g.exited;
  }

  say("5. uninstall with data");
  if (!existsSync(P.exe)) {
    const r = await launch(FILE, ["--setup"], 9365, join(ROOT, "r5a.json"));
    await r.screen("welcome");
    await act(r, "Kur", "done");
    await r.press("Kapat");
    await r.exited;
  }
  const d = await launch(P.exe, ["--uninstall"], 9366, join(ROOT, "r5.json"));
  await d.exited;
  say(`  screen: ${await d.screen("confirm")}`);
  await d.tick();
  const i5 = await act(d, "Kaldır", "done");
  say(`  screen: ${i5.text}; ${i5.ms} ms`);
  check(!existsSync(P.roaming) && !existsSync(P.local) && !existsSync(P.dir), "the store, WebView2 data and the install folder were deleted");
  check(!existsSync(P.legacyRoaming) && !existsSync(P.legacyLocal), "the legacy id folders were deleted too");
  check(existsSync(DL) && existsSync(FILE), "the root's other folders (Downloads) were not touched");
  await d.press("Kapat");
  await d.closed;
} catch (e) {
  ok = false;
  say(`ERROR: ${e.message}`);
}
run("reg", ["delete", `HKCU\\${TEST_REG}`, "/f"]);
check(!regExists(TEST_REG), "the test key was cleaned up");
const after = realState();
check(after === before, "the real install, shortcuts, data folders and registry keys are unchanged");
if (after !== before) say(`  before: ${before}\n  after: ${after}`);
say(`RESULT: ${ok ? "pass" : "FAIL"}`);
writeFileSync(OUT, `${lines.join("\n")}\n`, "utf8");
process.exit(ok ? 0 : 1);
