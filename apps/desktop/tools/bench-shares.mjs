// Times deriveShares, todayGroups and lateCount over 2,000 shares against a 16 ms median: `node tools/bench-shares.mjs [runs]`.
import { parseManifest } from "../src/core/manifest.ts";
import { deriveShares, lateCount, networkOf, shareIdOf, todayGroups } from "../src/core/shares.ts";
import { at, parseDate, parseTime } from "../src/core/time.ts";

const BUDGET_MS = 16;
const RUNS = Number(process.argv[2] ?? 5);
const PLATFORMS = ["x", "instagram-reels", "tiktok", "youtube-shorts", "pinterest"];
const BRANDS = ["brand-1", "brand-2", "brand-3", "brand-4"];
const DAYS = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];

const contents = [];
for (const brand of BRANDS)
  for (const date of DAYS)
    for (let i = 0; i < 20; i++) {
      const r = parseManifest({
        schemaVersion: 1, id: `${brand}-${date}-${i}`, brand, date, language: i % 2 ? "tr" : "en", title: `content ${i}`, approval: "approved",
        files: [{ id: "main", kind: "image", role: "main", path: "main.png", width: 10, height: 10 }],
        entries: PLATFORMS.map((p) => ({ platform: p, file: "main", text: "text", aiLabel: false })),
        sources: [{ title: "source", url: "https://example.com", license: "CC0-1.0" }],
        aiUsage: { voice: false, visuals: false, text: false },
      });
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      contents.push(r.content);
    }

const times = Object.fromEntries(PLATFORMS.map((p, i) => [p, parseTime(["09:00", "12:00", "15:00", "18:00", "21:00"][i])]));
const accounts = BRANDS.flatMap((brand) => [
  ...PLATFORMS.map((p) => ({ id: `${brand}-${networkOf(p)}`, brand, network: networkOf(p), handle: "@account", language: "en", times: { [p]: times[p] } })),
  { id: `${brand}-instagram-tr`, brand, network: "instagram", handle: "@account.tr", language: "tr", times: { "instagram-reels": times["instagram-reels"] } },
]);
const today = parseDate("2026-11-11");
const records = contents.slice(0, 200).map((c) => ({ share: shareIdOf(c.brand, c.id, "x"), status: "done", at: at(parseDate(c.date), parseTime("09:05")) }));
const missingFiles = new Set(contents.slice(0, 50).map((c) => `${c.brand}/${c.id}/main.png`));
const input = { contents, accounts, records, missingFiles, now: at(today, parseTime("14:20")) };

function once() {
  const t0 = performance.now();
  const shares = deriveShares(input);
  const g = todayGroups(shares, today);
  const late = BRANDS.reduce((n, b) => n + lateCount(shares, b), 0);
  const ms = performance.now() - t0;
  if (shares.length !== 2000) throw new Error(`${shares.length} shares, expected 2000`);
  if (shares.some((s) => s.account === null || s.plannedAt.kind !== "at")) throw new Error("a share has no account or no time: mapping did not run");
  if (!shares.some((s) => s.account?.language === "tr")) throw new Error("no share went to the Turkish account: the language path was not measured");
  if (g.late.length === 0 || g.upcoming.length === 0 || g.finished.length === 0 || late === 0) throw new Error("groups are empty: no work was done");
  return { ms, late, groups: [g.late.length, g.upcoming.length, g.unscheduled.length, g.finished.length] };
}

once(); // JIT warm-up, not counted
const runs = Array.from({ length: RUNS }, once);
const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
const median = ms[Math.floor(ms.length / 2)];
console.log(`shares: 2000, runs: ${RUNS}, groups [late, upcoming, unscheduled, finished]: ${runs[0].groups.join(", ")}, late: ${runs[0].late}`);
console.log(`time ms: ${ms.map((x) => x.toFixed(2)).join(" ")}; median ${median.toFixed(2)}; range ${(ms.at(-1) - ms[0]).toFixed(2)}; budget ${BUDGET_MS}`);
if (median >= BUDGET_MS) {
  console.error(`over budget: median ${median.toFixed(2)} ms >= ${BUDGET_MS} ms`);
  process.exit(1);
}
