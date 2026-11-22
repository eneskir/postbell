import { test } from "node:test";
import assert from "node:assert/strict";
import { parseManifest, type Content } from "../core/manifest.ts";
import { deriveShares, lateCount, networkOf, shareIdOf, todayGroups, type Account, type AccountId, type BrandId, type ContentId, type Share } from "../core/shares.ts";
import { at, formatTime, parseDate, parseTime, timeOf, type LocalDate, type TimeOfDay } from "../core/time.ts";
import { atSuffix, duration, fileSize, possessive, possessiveGenitive, text } from "./text.ts";

const day = parseDate("2026-11-11") as LocalDate;
const T = (s: string) => parseTime(s) as TimeOfDay;
const brand = "initech" as BrandId;

function pkg(id: string, title: string, platforms: readonly string[]): Content {
  const r = parseManifest({
    schemaVersion: 1, id, brand: "initech", date: "2026-11-11", language: "en", title, approval: "approved",
    files: [{ id: "main", kind: "video", role: "main", path: "main.mp4", width: 1080, height: 1920, durationSec: 38 }],
    entries: platforms.map((p) => ({ platform: p, file: "main", text: "metin", aiLabel: true })),
    sources: [{ title: "kaynak", url: "https://example.com", license: "CC0-1.0" }],
    aiUsage: { voice: true, visuals: false, text: true },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.content;
}

const contents = [
  pkg("dog", "The dog that should not be there", ["x", "instagram-reels"]),
  pkg("mirror", "The self-portrait hidden in the mirror", ["instagram-reels", "tiktok", "youtube-shorts"]),
  pkg("storm", "A storm painted from memory", ["pinterest"]),
];
const times = { x: "09:00", "instagram-reels": "14:15", tiktok: "18:30", "youtube-shorts": "19:00", pinterest: "20:00" } as const;
const accounts: Account[] = Object.entries(times).map(([p, t]) => {
  const network = networkOf(p as keyof typeof times);
  return { id: `initech-${network}` as AccountId, brand, network, handle: "@initech", language: "en", times: { [p]: T(t) } };
});

const PLATFORM_NAME: Record<string, string> = { x: "X", "instagram-reels": "Instagram Reels", tiktok: "TikTok", "youtube-shorts": "YouTube Shorts", pinterest: "Pinterest" };

function row(s: Share): string {
  const time = s.status.kind === "done" || s.status.kind === "skipped" ? timeOf(s.status.at) : s.plannedAt.kind === "at" ? timeOf(s.plannedAt.at) : null;
  const tag = s.status.kind === "late" ? text.delay(s.status.lateBy) : s.status.kind === "due" ? text.today.due : s.status.kind === "done" ? text.today.undo : "";
  return [time === null ? "--:--" : formatTime(time), PLATFORM_NAME[s.platform], s.content.title, tag].join(" | ");
}

test("sample day: same groups, same order, same texts as the design", () => {
  const shares = deriveShares({
    contents,
    accounts,
    records: [{ share: shareIdOf(brand, "dog" as ContentId, "instagram-reels"), status: "done", at: at(day, T("09:00")) }],
    missingFiles: new Set(),
    now: at(day, T("14:20")),
  });
  const g = todayGroups(shares, day);
  const total = g.late.length + g.upcoming.length + g.unscheduled.length + g.finished.length;
  assert.equal(text.todaySummary(total, g.late.length), "6 paylaşım, 1'i gecikti.");
  assert.equal(text.lateBadge(lateCount(shares, brand)), "1 gecikti");
  assert.deepEqual(g.late.map(row), ["09:00 | X | The dog that should not be there | 5 sa 20 dk"]);
  assert.deepEqual(g.upcoming.map(row), [
    "14:15 | Instagram Reels | The self-portrait hidden in the mirror | Saati geldi",
    "18:30 | TikTok | The self-portrait hidden in the mirror | ",
    "19:00 | YouTube Shorts | The self-portrait hidden in the mirror | ",
    "20:00 | Pinterest | A storm painted from memory | ",
  ]);
  assert.deepEqual(g.unscheduled, []);
  assert.deepEqual(g.finished.map(row), ["09:00 | Instagram Reels | The dog that should not be there | Geri al"]);
  assert.equal(g.late[0]?.account?.handle, "@initech");
});

test("possessive suffix on a number follows the last word of how it is read", () => {
  const cases: Array<[number, string]> = [[1, "i"], [2, "si"], [3, "ü"], [4, "ü"], [5, "i"], [6, "sı"], [7, "si"], [8, "i"], [9, "u"], [10, "u"], [20, "si"], [30, "u"], [40, "ı"], [50, "si"], [60, "ı"], [70, "i"], [80, "i"], [90, "ı"], [100, "ü"], [1000, "i"], [12, "si"]];
  for (const [n, s] of cases) assert.equal(possessive(n), s, String(n));
  assert.equal(text.todaySummary(3, 0), "3 paylaşım.");
  assert.equal(text.delay(45), "45 dk");
  assert.equal(text.delay(120), "2 sa");
});

test("genitive suffix follows the last vowel of the possessive (1'inin)", () => {
  const cases: Array<[number, string]> = [[1, "inin"], [2, "sinin"], [3, "ünün"], [6, "sının"], [9, "unun"], [10, "unun"], [40, "ının"], [100, "ünün"]];
  for (const [n, s] of cases) assert.equal(possessiveGenitive(n), s, String(n));
  assert.equal(text.todaySummary(6, 1, 1), "6 paylaşım, 1'i gecikti, 1'inin saati yok.");
  assert.equal(text.todaySummary(6, 0, 2), "6 paylaşım, 2'sinin saati yok.");
  assert.equal(text.todaySummary(6, 3), "6 paylaşım, 3'ü gecikti.");
});

test("locative suffix on a time: the minute's reading when not zero, otherwise the hour's", () => {
  const cases: Array<[string, string]> = [
    ["00:00", "da"], ["01:00", "de"], ["02:00", "de"], ["03:00", "te"], ["04:00", "te"], ["05:00", "te"], ["06:00", "da"], ["07:00", "de"], ["08:00", "de"], ["09:00", "da"],
    ["10:00", "da"], ["12:00", "de"], ["13:00", "te"], ["16:00", "da"], ["19:00", "da"], ["20:00", "de"], ["23:00", "te"],
    ["14:15", "te"], ["14:10", "da"], ["14:20", "de"], ["14:30", "da"], ["18:40", "ta"], ["18:50", "de"], ["09:05", "te"], ["09:01", "de"], ["09:06", "da"], ["09:59", "da"],
  ];
  for (const [t, s] of cases) assert.equal(atSuffix(T(t)), s, t);
});

test("empty day sentence: tomorrow or a dated day", () => {
  assert.equal(text.today.next(at(parseDate("2026-11-12") as LocalDate, T("09:00")), day), "Sıradaki yarın 09:00'da.");
  assert.equal(text.today.next(at(parseDate("2026-11-14") as LocalDate, T("14:15")), day), "Sıradaki 14 Kasım Cumartesi 14:15'te.");
  assert.equal(text.today.next(at(parseDate("2027-01-01") as LocalDate, T("20:00")), parseDate("2026-12-31") as LocalDate), "Sıradaki yarın 20:00'de.");
});

test("panel eyebrow: account, format and time; shares without a time or an account", () => {
  const now = at(day, T("14:20"));
  const all = deriveShares({ contents, accounts, records: [], missingFiles: new Set(), now });
  const late = all.find((s) => s.id === shareIdOf(brand, "dog" as ContentId, "x"));
  assert.ok(late && late.status.kind === "late");
  assert.equal(text.share.eyebrow(late), "@initech · X · 09:00");
  assert.equal(text.share.late(late.status.lateBy), "5 sa 20 dk gecikti");
  const other = accounts.filter((a) => a.network !== "x").map((a) => (a.network === "pinterest" ? { ...a, times: {} } : a));
  const some = deriveShares({ contents, accounts: other, records: [], missingFiles: new Set(), now });
  const storm = some.find((s) => s.platform === "pinterest");
  const noAccount = some.find((s) => s.platform === "x");
  assert.ok(storm && noAccount);
  assert.equal(text.share.eyebrow(storm), "@initech · Pinterest · saat yok");
  assert.equal(text.share.noTimeNotice(storm.platform), "Pinterest için saat girilmemiş.");
  assert.equal(text.share.eyebrow(noAccount), "X · hesap eklenmedi · saat yok");
});

test("file line: duration or dimensions and size; a missing file", () => {
  const video = contents[0]!.files[0]!;
  const MB = 1024 * 1024;
  assert.equal(text.share.fileLine(video, 24 * MB), "main.mp4 · 0:38 · 24 MB");
  assert.equal(text.share.fileLine(video, null), "main.mp4 · bulunamadı");
  const image = { id: "card", kind: "image", role: "card", path: "images/initech-0141-pinterest.jpg", width: 1000, height: 1500 } as const;
  assert.equal(text.share.fileLine(image, 2 * MB), "initech-0141-pinterest.jpg · 1000 x 1500 · 2 MB");
  const sizes: Array<[number, string]> = [[0, "0 bayt"], [216, "216 bayt"], [1024, "1 KB"], [1536, "1,5 KB"], [Math.round(2.4 * MB), "2,4 MB"], [Math.round(10.4 * MB), "10 MB"], [3 * 1024 * MB, "3 GB"]];
  for (const [n, s] of sizes) assert.equal(fileSize(n), s, String(n));
  const times: Array<[number, string]> = [[0, "0:00"], [38, "0:38"], [42.5, "0:43"], [725, "12:05"], [3723, "1:02:03"]];
  for (const [n, s] of times) assert.equal(duration(n), s, String(n));
});

test("panel steps: network name and locative suffix", () => {
  assert.equal(text.share.open("@initech", "x"), "@initech olarak X'te aç");
  assert.equal(text.share.open("@initech", "pinterest"), "@initech olarak Pinterest'te aç");
  assert.equal(text.share.open("@initech", "instagram-reels"), "@initech olarak Instagram'da aç");
  assert.equal(text.share.open("@initech", "tiktok"), "@initech olarak TikTok'ta aç");
  assert.equal(text.share.open("@initech", "youtube-shorts"), "@initech olarak YouTube'da aç");
  assert.equal(text.share.accountCheck("@initech", "x"), "X'te açık hesap @initech mu, bir bak.");
  assert.equal(text.share.accountCheck("@initech", "pinterest"), "Pinterest'te açık hesap @initech mu, bir bak.");
  assert.equal(text.share.addAccount("x"), "X hesabını ekle");
  assert.equal(text.share.noAccount("x"), "Bu markada X hesabı yok.");
  assert.equal(text.share.addAccount("instagram-post"), "Instagram hesabını ekle");
});
