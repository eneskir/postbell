// Marks, undoes and skips shares in the release postbell.exe, then checks the store after a reopen:
//   node apps/desktop/tools/self-test/records-run.mjs <evidence file> [--exe <installed postbell.exe>]
// Clicks go through WebView2's debugging port, opened for this process only by WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const OUT = args[0];
if (!OUT) throw new Error("usage: node tools/self-test/records-run.mjs <evidence file> [--exe <postbell.exe>]");
const given = args.includes("--exe") ? args[args.indexOf("--exe") + 1] : null;
const EXE = given ?? join(APP, "src-tauri/target/release/postbell.exe");
if (!given) {
  const newest = (d) => readdirSync(d, { recursive: true }).map((f) => join(d, f)).filter((f) => statSync(f).isFile() && !f.endsWith(".test.ts")).reduce((m, f) => Math.max(m, statSync(f).mtimeMs), 0);
  if (!existsSync(EXE) || statSync(EXE).mtimeMs < Math.max(newest(join(APP, "src")), newest(join(APP, "src-tauri/src")))) {
    console.log("postbell.exe is missing or older than its sources: run `npm run build` and `npx tauri build --no-bundle` first (or pass an installed exe with --exe)");
    process.exit(2);
  }
}

const FIX = join(APP, "..", "..", "contracts/fixtures/initech").replaceAll("\\", "/");
const base = join(tmpdir(), `postbell-records-run-${Date.now()}`);
const data = join(base, "data");
mkdirSync(data, { recursive: true });
const seed = {
  version: 1,
  brands: [{ id: "initech", name: "Initech", sticker: "camera", folder: FIX }],
  groups: [],
  accounts: [{ id: "initech-x", brand: "initech", network: "x", handle: "@initech", language: "en", times: { x: "09:00" } }],
  records: [],
  settings: {},
  sidebar: { collapsed: false, width: 240, openBrands: ["initech"] },
};
const storePath = join(data, "store.json");
writeFileSync(storePath, JSON.stringify(seed, null, 2), "utf8");

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
const records = () => JSON.parse(readFileSync(storePath, "utf8")).records;
const digest = () => createHash("sha256").update(readFileSync(storePath)).digest("hex").slice(0, 16);

async function launch(port, report) {
  const p = spawn(EXE, ["--self-test", report, "--self-test-stay", "--data-dir", data], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    stdio: "ignore",
  });
  const kill = () => execFileSync("taskkill", ["/F", "/T", "/PID", String(p.pid)], { stdio: "ignore" });
  let targets = [];
  for (let i = 0; i < 100 && !targets.some((t) => t.type === "page"); i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch {
    }
    await sleep(200);
  }
  const page = targets.find((t) => t.type === "page");
  if (!page) {
    kill();
    throw new Error("the debugging port did not open (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS did not take)");
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (!m.id || !pending.has(m.id)) return;
    const q = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) q.rej(new Error(JSON.stringify(m.error)));
    else q.res(m.result);
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++seq;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr, what, ms = 10000) => {
    for (let t = 0; t < ms; t += 100) {
      if (await ev(expr)) return;
      await sleep(100);
    }
    throw new Error(`timed out: ${what}`);
  };
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
  window.__panel = (label) => [...(document.querySelector("aside.panel")?.querySelectorAll("button") ?? [])].find((b) => b.innerText.trim() === label && !b.disabled);
  window.__rows = () => [...document.querySelectorAll(".share-row-main")].map((r) => r.innerText.replace(/\\s+/g, " "));
  true`;
const xRow = (n) => `[...document.querySelectorAll(".share-row-main")].filter((r) => / X /.test(" " + r.innerText.replace(/\\s+/g, " ") + " "))[${n}]`;

async function openToday(a) {
  await a.waitFor(`!!document.querySelector('.nav-row[data-brand-page="initech"]')`, "Initech's page rows");
  await a.ev(HELPERS);
  await a.ev(`[...document.querySelectorAll('.nav-row[data-brand-page="initech"]')].find((b) => b.innerText.trim() === "Bugün").click()`);
  await a.waitFor(`document.querySelectorAll(".share-row-main").length > 0`, "Today rows");
}
async function press(a, label) {
  await a.waitFor(`!!__panel(${JSON.stringify(label)})`, `panel button «${label}»`);
  await a.ev(`__panel(${JSON.stringify(label)}).click()`);
  await sleep(600);
  say(`  «${label}» → records ${JSON.stringify(records().map((r) => [r.share, r.status]))}`);
}

try {
  say(`exe ${EXE}; data ${data}`);
  say("1. mark, undo, mark again, skip the other X");
  const a = await launch(9341, join(base, "r1.json"));
  await openToday(a);
  say(`  Today: ${JSON.stringify(await a.ev("__rows()"))}`);
  check(await a.ev(`!!${xRow(1)}`), "at least two X rows in Today (fixtures are 12-14 November, today is 12 November or later)");
  await a.ev(`${xRow(0)}.click()`);
  await sleep(300);
  check(await a.ev(`!!document.querySelector("aside.panel")`), "clicking a row opens the panel");
  await a.ev(`${xRow(0)}.click()`);
  await sleep(300);
  check(await a.ev(`!document.querySelector("aside.panel")`), "clicking the open row again closes the panel");
  await a.ev(`${xRow(0)}.click()`);
  await press(a, "Paylaşıldı olarak işaretle");
  check(records().length === 1 && records()[0].status === "done", "mark: one done record");
  await press(a, "Geri al");
  check(records().length === 0, "undo: the record is gone");
  await press(a, "Paylaşıldı olarak işaretle");
  const first = records()[0]?.share;
  await a.ev(`${xRow(0)}.click()`);
  await press(a, "Bu paylaşımı atla");
  const r1 = records();
  check(r1.length === 2 && r1.some((r) => r.share === first && r.status === "done") && r1.some((r) => r.share !== first && r.status === "skipped"), "two records: the marked one done, the other skipped");
  check(!readdirSync(data).some((f) => f.includes(".tmp")), "no temp file left");
  const h1 = digest();
  a.close();
  say(`  process force killed; store hash ${h1}`);
  await sleep(1500);

  say("2. reopen");
  const b = await launch(9342, join(base, "r2.json"));
  await openToday(b);
  const rows = await b.ev("__rows()");
  say(`  Today: ${JSON.stringify(rows)}`);
  const groups = await b.ev(`[...document.querySelectorAll(".share-group-title, h2")].map((h) => h.innerText.replace(/\\s+/g, " ")).join(" | ")`);
  say(`  groups: ${groups}`);
  check(rows.some((t) => t.includes("Atlandı")), "the skipped X has the «Atlandı» label");
  check(digest() === h1, "the store file is unchanged after reopening");
  check(JSON.stringify(records()) === JSON.stringify(r1), "the same two records after reopening");
  b.close();
} catch (e) {
  ok = false;
  say(`ERROR: ${e.message}`);
}
const log = join(data, "logs", "postbell.log");
say(`  log: ${existsSync(log) ? readFileSync(log, "utf8").trim().split(/\r?\n/).join(" | ") : "(none)"}`);
say(`RESULT: ${ok ? "pass" : "FAIL"}`);
writeFileSync(OUT, `${lines.join("\n")}\n`, "utf8");
process.exit(ok ? 0 : 1);
