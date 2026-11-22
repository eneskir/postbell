import { test } from "node:test";
import assert from "node:assert/strict";
import { alarmsOf, DEFAULT_NOTIFY } from "../core/alarms.ts";
import { parseManifest, type Content } from "../core/manifest.ts";
import { parseAlarmTarget } from "../core/port.ts";
import { deriveShares, type Account, type AccountId, type BrandId } from "../core/shares.ts";
import { at, parseDate, parseTime, type LocalDate, type LocalMs, type TimeOfDay } from "../core/time.ts";
import { instantOf, localNow } from "./clock.ts";
import { alarmPlan } from "./notify.ts";
import { text } from "./text.ts";

const P = "initech" as BrandId;
const day = parseDate("2026-11-12") as LocalDate;
const T = (s: string) => parseTime(s) as TimeOfDay;

function content(id: string, title: string, platforms: readonly string[]): Content {
  const r = parseManifest({
    schemaVersion: 1, id, brand: P, date: day, language: "en", title, approval: "approved",
    files: [{ id: "main", kind: "image", role: "main", path: "main.png", width: 10, height: 10 }],
    entries: platforms.map((p) => ({ platform: p, file: "main", text: "metin", aiLabel: false })),
    sources: [{ title: "kaynak", url: "https://example.com", license: "CC0-1.0" }],
    aiUsage: { voice: false, visuals: false, text: false },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.content;
}

const accounts: Account[] = [
  { id: "p-x" as AccountId, brand: P, network: "x", handle: "@initech", language: "en", times: { x: T("09:00") } },
  { id: "p-tt" as AccountId, brand: P, network: "tiktok", handle: "@initech", language: "en", times: { tiktok: T("18:30") } },
];

test("notification texts match the design; local time becomes a real instant; the format is the shell's contract", () => {
  const shares = deriveShares({
    contents: [content("dog", "The dog that should not be there", ["x"]), content("mirror", "The self-portrait hidden in the mirror", ["tiktok"])],
    accounts,
    records: [],
    missingFiles: new Set(),
    now: at(day, T("08:00")),
  });
  const plan = alarmPlan(alarmsOf(shares, [P], DEFAULT_NOTIFY), shares, () => "Initech", (l) => l + 1);
  assert.deepEqual(
    plan.alarms.map((a) => [a.title, a.body, a.label]),
    [
      ["Saati geldi: @initech · X", "The dog that should not be there", "X"],
      ["30 dakika gecikti: @initech · X", "The dog that should not be there", "X"],
      ["Saati geldi: @initech · TikTok", "The self-portrait hidden in the mirror", "TikTok"],
      ["30 dakika gecikti: @initech · TikTok", "The self-portrait hidden in the mirror", "TikTok"],
    ],
  );
  // Must match `plan_parses_the_ui_contract` in `src-tauri/src/alarms.rs`.
  assert.deepEqual(plan.alarms[0], {
    id: "initech/dog/x#due",
    at: at(day, T("09:00")) + 1,
    title: "Saati geldi: @initech · X",
    body: "The dog that should not be there",
    brand: "Initech",
    label: "X",
    target: { brand: "initech", share: "initech/dog/x" },
  });
  assert.deepEqual(plan.texts, { open: "Aç", openHome: "Ana sayfayı aç", many: "{n} paylaşımın saati geldi" });
  const hour = alarmPlan(alarmsOf(shares, [P], { enabled: true, remindAfter: 60 }), shares, () => "Initech", (l) => l);
  assert.equal(hour.alarms[1]?.title, "1 saat gecikti: @initech · X");
});

test("tray texts use the shell's format", () => {
  // Must match `texts_parse_the_ui_contract` in `src-tauri/src/tray.rs`.
  assert.equal(
    JSON.stringify(text.tray),
    `{"open":"Postbell'i aç","quit":"Çık","tooltip":"Postbell","hiddenTitle":"Postbell arka planda çalışıyor","hiddenBody":"Bildirimler gelmeye devam eder. Kapatmak için simgedeki menüden Çık'ı seç."}`,
  );
});

test("local wall-clock time converts to a real instant and back", () => {
  const local = at(day, T("14:20"));
  const instant = instantOf(local);
  const d = new Date(instant);
  assert.deepEqual([d.getHours(), d.getMinutes(), d.getDate()], [14, 20, 12]);
  assert.equal(localNow(d), local as LocalMs);
});

test("a target from the shell is validated at the boundary: invalid means Home", () => {
  assert.deepEqual(parseAlarmTarget({ brand: "initech", share: "initech/dog/x" }), { brand: "initech", share: "initech/dog/x" });
  assert.equal(parseAlarmTarget(null), null);
  assert.equal(parseAlarmTarget({ brand: "initech" }), null);
  assert.equal(parseAlarmTarget("initech"), null);
});
