// Runs every check step in order, even after a failure, and exits 0 only if all pass: `npm run check`.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const local = join(process.env.USERPROFILE ?? "", ".cargo", "bin", "cargo.exe");
const cargo = existsSync(local) ? `"${local}"` : "cargo";

const steps = [
  ["typecheck", "npx --no-install tsc --noEmit"],
  ["layer rule", "node tools/check-layers.mjs"],
  ["tokens up to date", "node tools/tokens.mjs --check"],
  ["style rule", "node tools/check-styles.mjs"],
  ["contract up to date", "node tools/contract.mjs --check"],
  ["tests", 'node --test "src/**/*.test.ts" "tools/**/*.test.mjs"'],
  ["license notices", "node tools/notices.mjs --check"],
  ["old name", "node tools/check-name.mjs"],
  ["Rust tests", `${cargo} test --locked --offline --manifest-path src-tauri/Cargo.toml`],
];

const failed = [];
for (const [name, cmd] of steps) {
  console.log(`\n== ${name}: ${cmd}`);
  const started = Date.now();
  const r = spawnSync(cmd, { cwd: appDir, shell: true, stdio: "inherit" });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (r.status === 0) console.log(`== ${name}: pass (${secs} s)`);
  else {
    console.log(`== ${name}: FAIL, exit ${r.status ?? r.error?.message} (${secs} s)`);
    failed.push(name);
  }
}
console.log(`\ncheck: ${steps.length} steps, ${failed.length} errors${failed.length ? " (" + failed.join(", ") + ")" : ""}`);
process.exit(failed.length === 0 ? 0 : 1);
