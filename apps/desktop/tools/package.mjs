// Builds the release exe and copies it as the setup file: `npm run package` (clean tree) or `npm run package -- --allow-dirty`.
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dependentLoadFlags } from "./pe.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Git Bash may not have the user's .cargo\bin on PATH.
const cargoBin = join(process.env.USERPROFILE ?? "", ".cargo", "bin");
const env = { ...process.env, PATH: existsSync(cargoBin) ? `${cargoBin}${delimiter}${process.env.PATH ?? ""}` : process.env.PATH };
const sh = (cmd) => execSync(cmd, { cwd: APP, env, stdio: "inherit" });
const out = (cmd, args) => execFileSync(cmd, args, { cwd: APP, env, encoding: "utf8" }).trim();
const fail = (message) => {
  console.error(`package: ${message}`);
  process.exit(1);
};

const dirty = out("git", ["status", "--porcelain", "--untracked-files=all"]);
if (dirty && !process.argv.includes("--allow-dirty")) fail("the working tree is not clean; commit, or pass --allow-dirty for a trial:\n" + dirty);
const commit = out("git", ["rev-parse", "--short=10", "HEAD"]) + (dirty ? " (dirty tree)" : "");
const version = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")).version;

sh("npm run check");
// `beforeBuildCommand` builds the UI; `--ci` asks no questions and `--no-bundle` builds only the exe.
sh("npx --no-install tauri build --ci --no-bundle");

const exe = join(APP, "src-tauri", "target", "release", "postbell.exe");
const dir = join(APP, "src-tauri", "target", "release", "bundle", "setup");
const name = `Postbell_${version}_x64-setup.exe`;
const file = join(dir, name);
mkdirSync(dir, { recursive: true });
copyFileSync(exe, file);

const bytes = readFileSync(file);
const sha = createHash("sha256").update(bytes).digest("hex");
const exeSha = createHash("sha256").update(readFileSync(exe)).digest("hex");
if (sha !== exeSha) fail(`the copy differs from the exe: ${sha} / ${exeSha}`);

// The setup reads the installed version from the exe's Windows version info (`setup_win::file_version`).
const info = JSON.parse(out("powershell", ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; (Get-Item -LiteralPath '${file}').VersionInfo | Select-Object FileVersion, ProductName, CompanyName, LegalCopyright | ConvertTo-Json -Compress`]));
if (!String(info.FileVersion ?? "").startsWith(version)) fail(`the exe's version info is ${info.FileVersion}, expected ${version}`);

// tauri-build embeds `bundle.icon` even with `--no-bundle`; without it Windows shows its default icon.
const ico = readFileSync(join(APP, "src-tauri", "icons", "postbell-logo.ico"));
const images = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
  const e = 6 + i * 16;
  return ico.subarray(ico.readUInt32LE(e + 12), ico.readUInt32LE(e + 12) + ico.readUInt32LE(e + 8));
});
const missing = images.filter((img) => bytes.indexOf(img) < 0).length;
if (!images.length || missing) fail(`${missing} of the icon's ${images.length} images are missing from the exe`);

// build.rs links with /DEPENDENTLOADFLAG:0x800: the setup exe runs from the download folder, so its own DLL imports come
// from System32 only.
const flags = dependentLoadFlags(bytes);
if (flags !== 0x800) fail(`the exe's DependentLoadFlags is ${flags === null ? "missing" : `0x${flags.toString(16)}`}, expected 0x800 (System32 only)`);

console.log(
  `\npackage: ${name}\n  version ${version} (exe: ${info.FileVersion}, ${info.ProductName}, ${info.CompanyName}, ${info.LegalCopyright}), commit ${commit}\n` +
    `  ${(statSync(file).size / 1024 / 1024).toFixed(2)} MB, icon ${images.length} images\n  SHA-256 ${sha} (same as postbell.exe)\n  path ${file}`,
);
