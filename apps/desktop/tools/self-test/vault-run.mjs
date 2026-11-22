// Saves, reveals and removes a made-up password through the release postbell.exe's UI, and checks the real
// Windows Credential Manager, the data folder, the WebView2 folder and the log:
//   node apps/desktop/tools/self-test/vault-run.mjs <evidence file> [--exe <installed postbell.exe>]
// `--data-dir` makes the exe use the "Postbell test" service, so the run never touches real entries.
// Clicks go through WebView2's debugging port, opened for this process only by WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findPage } from "../cdp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "../..");
const args = process.argv.slice(2);
const OUT = args[0];
if (!OUT) throw new Error("usage: node tools/self-test/vault-run.mjs <evidence file> [--exe <postbell.exe>]");
const given = args.includes("--exe") ? args[args.indexOf("--exe") + 1] : null;
const EXE = given ?? join(APP, "src-tauri/target/release/postbell.exe");
if (!given) {
  const newest = (d) => readdirSync(d, { recursive: true }).map((f) => join(d, f)).filter((f) => statSync(f).isFile() && !f.endsWith(".test.ts")).reduce((m, f) => Math.max(m, statSync(f).mtimeMs), 0);
  if (!existsSync(EXE) || statSync(EXE).mtimeMs < Math.max(newest(join(APP, "src")), newest(join(APP, "src-tauri/src")))) {
    console.log("postbell.exe is missing or older than its sources: run `npm run build` and `npx tauri build --no-bundle` first (or pass an installed exe with --exe)");
    process.exit(2);
  }
}

// Made up for this run; never a real password.
const PW = `ornek-sifre-${Date.now().toString(36)}`;
const TARGET = "initech-x.Postbell test";
const FIX = join(APP, "..", "..", "contracts/fixtures/initech").replaceAll("\\", "/");
const base = join(tmpdir(), `postbell-vault-run-${Date.now()}`);
const data = join(base, "data");
mkdirSync(data, { recursive: true });
const account = (network) => ({ id: `initech-${network}`, brand: "initech", network, handle: "@initech", language: "en", times: {} });
const seed = {
  version: 2,
  brands: [{ id: "initech", name: "Initech", sticker: "camera", folder: FIX }],
  groups: [],
  accounts: [account("x"), account("instagram")],
  records: [],
  settings: {},
  sidebar: { collapsed: false, width: 240, openBrands: ["initech"] },
};
writeFileSync(join(data, "store.json"), JSON.stringify(seed, null, 2), "utf8");

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
const listed = () => execFileSync("cmdkey", ["/list"], { encoding: "utf8" }).includes(TARGET);
const credRead = () => {
  try {
    return execFileSync("python", ["-I", "-X", "utf8", join(HERE, "cred-read.py"), TARGET, PW], { encoding: "utf8" }).trim();
  } catch (e) {
    return String(e.stdout ?? e.message).trim();
  }
};
// Counts files holding the password as UTF-8 or UTF-16; skips files over 64 MB.
function filesWith(dir) {
  if (!existsSync(dir)) return { files: 0, hits: [] };
  const needles = [Buffer.from(PW, "utf8"), Buffer.from(PW, "utf16le")];
  let files = 0;
  const hits = [];
  for (const f of readdirSync(dir, { recursive: true })) {
    const p = join(dir, f);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > 64 * 1024 * 1024) continue;
    let buf;
    try {
      buf = readFileSync(p);
    } catch {
      continue;
    }
    files++;
    if (needles.some((n) => buf.includes(n))) hits.push(p);
  }
  return { files, hits };
}

async function launch(port, report) {
  const p = spawn(EXE, ["--self-test", report, "--self-test-stay", "--data-dir", data], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    stdio: "ignore",
  });
  const kill = () => execFileSync("taskkill", ["/F", "/T", "/PID", String(p.pid)], { stdio: "ignore" });
  const page = await findPage(port, 100);
  if (!page) {
    kill();
    throw new Error("the debugging port did not open (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS did not take)");
  }
  const { ws, send, ev } = await connect(page);
  const waitFor = async (expr, what, ms = 10000) => {
    for (let t = 0; t < ms; t += 100) {
      if (await ev(expr)) return;
      await sleep(100);
    }
    throw new Error(`timed out: ${what}`);
  };
  await send("Runtime.enable");
  say(`  process ${p.pid}`);
  return {
    ev,
    waitFor,
    close: () => {
      ws.close();
      kill();
    },
  };
}

const HELPERS = `
  window.__button = (label) => [...(document.querySelector("aside.panel")?.querySelectorAll("button") ?? []), ...document.querySelectorAll("[role=dialog] button, dialog button")].find((b) => b.innerText.trim() === label && !b.disabled);
  window.__type = (label, value) => {
    const l = [...document.querySelectorAll("aside.panel label")].find((x) => x.textContent.trim() === label);
    const el = document.getElementById(l.htmlFor);
    Object.getOwnPropertyDescriptor(el.constructor.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  };
  window.__cells = () => [...document.querySelectorAll(".account-row")].map((r) => r.querySelector(".account-network").innerText.trim() + "=" + r.querySelector(".account-password").innerText.trim());
  window.__detail = () => Object.fromEntries([...document.querySelectorAll(".account-detail-row")].map((r) => [r.querySelector("dt").innerText, r.querySelector("dd").innerText]));
  true`;

async function press(a, label) {
  await a.waitFor(`!!__button(${JSON.stringify(label)})`, `button «${label}»`);
  await a.ev(`__button(${JSON.stringify(label)}).click()`);
  await sleep(600);
}

try {
  say(`exe ${EXE}; data ${data}; target «${TARGET}»`);
  const a = await launch(9351, join(base, "r1.json"));
  await a.waitFor(`!!document.querySelector('.nav-row[data-brand-page="initech"]')`, "Initech's page rows");
  await a.ev(HELPERS);
  // A run that failed half way may have left the entry.
  await a.ev(`window.__TAURI_INTERNALS__.invoke("vault_delete", { account: "initech-x" }).then(() => true)`);
  await a.ev(`[...document.querySelectorAll('.nav-row[data-brand-page="initech"]')].find((b) => b.innerText.trim() === "Hesaplar").click()`);
  await a.waitFor(`!!document.querySelector('.account-row-main[data-account="initech-x"]')`, "the X account row");
  await sleep(500);
  say(`  table: ${JSON.stringify(await a.ev("__cells()"))}`);
  check(!listed(), "1. before: no entry in Credential Manager (cmdkey /list)");

  await a.ev(`document.querySelector('.account-row-main[data-account="initech-x"]').click()`);
  await press(a, "Bilgileri düzenle");
  await a.ev(`__type("Şifre", ${JSON.stringify(PW)}) && __type("Yedek kodlar", "1111 2222\\n3333 4444")`);
  await press(a, "Kaydet");
  await a.waitFor(`!!document.querySelector(".account-detail")`, "the details panel after saving");
  await sleep(500);
  say(`  table: ${JSON.stringify(await a.ev("__cells()"))}; details: ${JSON.stringify(await a.ev("__detail()"))}`);
  check(listed(), "2. saved: the entry is in Credential Manager");
  check((await a.ev(`__detail()["Yedek kod"]`)) === "2 kod, kasada", "2. the panel counts 2 codes");
  check((await a.ev(`__cells()`)).includes("X=••••••••"), "2. the table shows the password masked");
  const read = credRead();
  say(`  another process (python CredReadW): ${read}`);
  check(/persist Local/.test(read), "3. the entry is kept on this computer only (persist Local)");

  await press(a, "Şifreyi göster");
  check((await a.ev(`__detail()["Şifre"]`)) === PW, "4. «Şifreyi göster» shows the password");
  await press(a, "Şifreyi gizle");
  check((await a.ev(`__detail()["Şifre"]`)) === "••••••••", "4. «Şifreyi gizle» hides it");

  await press(a, "Bilgileri düzenle");
  check((await a.ev(`document.querySelector('aside.panel input[type="password"]').value`)) === "", "5. the edit form never shows the stored password");
  await press(a, "Kaydet");
  await a.waitFor(`!!document.querySelector(".account-detail")`, "the details panel after the empty save");
  await sleep(400);
  await press(a, "Şifreyi göster");
  check((await a.ev(`__detail()["Şifre"]`)) === PW && (await a.ev(`__detail()["Yedek kod"]`)) === "2 kod, kasada", "5. saving with empty fields keeps the password and codes");
  await press(a, "Şifreyi gizle");

  const inData = filesWith(data);
  const webviews = [join(process.env.LOCALAPPDATA ?? "", "app.postbell"), join(process.env.LOCALAPPDATA ?? "", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Local", "app.postbell")];
  const inWeb = webviews.map(filesWith);
  say(`  data folder: ${inData.files} files; WebView2 folders: ${inWeb.map((w, i) => `${webviews[i]} ${w.files} files`).join("; ")}`);
  check(inData.hits.length === 0, `6. the password is in no file of the data folder (store, log): ${inData.hits.length} hits`);
  check(inWeb.every((w) => w.hits.length === 0), `6. the password is in no file of the WebView2 folders: ${inWeb.flatMap((w) => w.hits).join(", ") || "0 hits"}`);

  await press(a, "Bilgileri düzenle");
  await press(a, "Hesabı kaldır…");
  const body = await a.ev(`document.querySelector("[role=dialog], dialog")?.innerText ?? ""`);
  say(`  confirm: ${JSON.stringify(body)}`);
  check(body.includes("kasadaki şifresi"), "7. the confirm says the vault password goes too");
  await press(a, "Hesabı kaldır");
  await sleep(800);
  check(!listed(), "7. removing the account deletes the entry");
  say(`  another process after removal: ${credRead()}`);
  a.close();
} catch (e) {
  ok = false;
  say(`ERROR: ${e.message}`);
}
const log = join(data, "logs", "postbell.log");
const logText = existsSync(log) ? readFileSync(log, "utf8") : "";
say(`  log: ${logText.trim().split(/\r?\n/).join(" | ") || "(none)"}`);
check(!logText.includes(PW), "8. the log never holds the password");
say(`RESULT: ${ok ? "pass" : "FAIL"}`);
writeFileSync(OUT, `${lines.join("\n")}\n`, "utf8");
process.exit(ok ? 0 : 1);
