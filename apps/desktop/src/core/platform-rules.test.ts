import { test } from "node:test";
import assert from "node:assert/strict";
import type { ContentFile, PlatformEntry } from "./manifest.ts";
import { checksOf, hashtagCount, PLATFORM_RULES, textLength, xLength, type Check } from "./platform-rules.ts";

const video = (width: number, height: number, durationSec: number): ContentFile => ({ id: "main", kind: "video", role: "main", path: "main.mp4", width, height, durationSec });
const image = (width: number, height: number): ContentFile => ({ id: "card", kind: "image", role: "card", path: "card.png", width, height });
const entry = (platform: PlatformEntry["platform"], file: ContentFile, text = "", aiLabel = false): PlatformEntry => ({ platform, file, text, aiLabel });
const measured = (checks: readonly Check[]) =>
  Object.fromEntries(checks.flatMap((c) => (c.kind === "measured" ? [[c.measure, c.ok]] : [])));
const todos = (checks: readonly Check[]) => checks.flatMap((c) => (c.kind === "todo" ? [c.todo] : []));

test("every limit has an https source and a min or a max", () => {
  for (const [platform, rules] of Object.entries(PLATFORM_RULES)) {
    for (const l of rules.limits) {
      assert.match(l.source, /^https:\/\//, platform);
      assert.ok(l.min !== undefined || l.max !== undefined, `${platform} ${l.measure}`);
    }
    if (rules.aiSwitch) assert.match(rules.aiSwitch.source, /^https:\/\//, platform);
  }
});

test("X counts Latin and Turkish letters 1, CJK 2, an emoji sequence 2 and a link 23", () => {
  assert.equal(xLength("Merhaba çağ ışık"), 16);
  assert.equal(xLength("日本"), 4);
  assert.equal(xLength("👍"), 2);
  assert.equal(xLength("👨‍👩‍👧"), 2, "a ZWJ family is one emoji");
  assert.equal(xLength("bak https://example.com/a/very/long/path?x=1"), 4 + 23);
  assert.equal(xLength("é"), 1, "measured after NFC");
  assert.equal(xLength("a".repeat(280)), 280);
});

test("plain text counts code points and YouTube counts UTF-8 bytes", () => {
  assert.equal(textLength("ğ👍", "chars"), 2);
  assert.equal(textLength("ğ", "bytes"), 2);
  assert.equal(textLength("a", "bytes"), 1);
});

test("a hashtag follows a space or punctuation and holds a letter", () => {
  assert.equal(hashtagCount("#sanat ve #çiçek, (#gece) #2026 x#y &#39; #a_1"), 4);
  assert.equal(hashtagCount("hiç yok"), 0);
});

test("X: a 150-second video is over 140 seconds, its ratio fits, and no AI switch is listed", () => {
  const checks = checksOf(entry("x", video(1080, 1920, 150), "metin", true), 600 * 1024 * 1024);
  assert.deepEqual(measured(checks), { text: true, duration: false, size: false, ratio: true });
  assert.deepEqual(todos(checks), ["account"]);
});

test("Instagram Reels: a vertical 1080p video fits, and the AI label is a phone-only to-do", () => {
  const checks = checksOf(entry("instagram-reels", video(1080, 1920, 30), "#a #b", true), undefined);
  assert.deepEqual(measured(checks), { text: true, hashtags: true, duration: true, ratio: true, "short-side": true });
  const ai = checks.find((c) => c.kind === "todo" && c.todo === "ai-label");
  assert.deepEqual(ai && "phoneOnly" in ai ? ai.phoneOnly : null, true);
  assert.equal(measured(checksOf(entry("instagram-reels", video(540, 960, 30), "#a #b #c #d #e #f"), undefined)).hashtags, false);
  assert.equal(measured(checksOf(entry("instagram-reels", video(540, 960, 30)), undefined))["short-side"], false);
});

test("Instagram post: 3:4 is the tallest image, a video gets only text checks", () => {
  assert.equal(measured(checksOf(entry("instagram-post", image(1080, 1440)), undefined)).ratio, true);
  assert.equal(measured(checksOf(entry("instagram-post", image(1080, 1920)), undefined)).ratio, false);
  assert.deepEqual(measured(checksOf(entry("instagram-post", video(1080, 1350, 20)), undefined)), { text: true, hashtags: true });
});

test("YouTube Shorts: wider than square or over 3 minutes fails; Pinterest: under 4 seconds fails", () => {
  assert.deepEqual(measured(checksOf(entry("youtube-shorts", video(1920, 1080, 181)), undefined)), { text: true, hashtags: true, duration: false, ratio: false });
  assert.equal(measured(checksOf(entry("pinterest", video(1080, 1920, 3)), undefined)).duration, false);
  assert.equal(measured(checksOf(entry("pinterest", image(1000, 1500)), 21 * 1024 * 1024)).size, false);
});

test("TikTok: only the duration is measured; no AI label to-do when the entry does not need one", () => {
  const checks = checksOf(entry("tiktok", video(1080, 1920, 61 * 60), "x".repeat(5000)), undefined);
  assert.deepEqual(measured(checks), { duration: false });
  assert.deepEqual(todos(checks), ["account"]);
});
