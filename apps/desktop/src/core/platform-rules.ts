import type { ContentFile, Platform, PlatformEntry } from "./manifest.ts";

// Taslak A: the share panel's checklist. Each limit is from the platform's own help or developer page, read on
// `RULES_READ`; a limit no official page states is left out rather than guessed. Platforms change these, so re-read
// every source before a release.
export const RULES_READ = "2026-11-23";

// `text`: the share text's length (`Counting`); `hashtags`: over the limit the platform drops or ignores them;
// `ratio`: width / height; `short-side`: the smaller of width and height in pixels; `size`: file bytes.
export type Measure = "text" | "hashtags" | "duration" | "ratio" | "short-side" | "size";
// Code points; X's weighted count (`xLength`); UTF-8 bytes (YouTube's description).
export type Counting = "chars" | "x-weighted" | "bytes";
type Limit = {
  readonly measure: Measure;
  // Media limits apply only to that kind of file.
  readonly kind?: ContentFile["kind"];
  // Both ends included.
  readonly min?: number;
  readonly max?: number;
  readonly source: string;
};
export type PlatformRules = {
  readonly counting: Counting;
  readonly limits: readonly Limit[];
  // The platform's creator switch for AI content, and whether only its phone app has it; null when no official page describes one.
  readonly aiSwitch: { readonly phoneOnly: boolean; readonly source: string } | null;
};

const X_COUNTING = "https://docs.x.com/fundamentals/counting-characters";
const X_VIDEO = "https://help.x.com/en/using-x/x-videos";
const X_MEDIA = "https://docs.x.com/x-api/media/quickstart/best-practices";
const IG_API = "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media";
const IG_HASHTAGS = "https://www.socialmediatoday.com/news/instagram-implements-new-limits-on-hashtag-use/808309/";
const IG_REELS = "https://help.instagram.com/2720958398006062";
const IG_REELS_SPECS = "https://help.instagram.com/1038071743007909";
const IG_IMAGE = "https://help.instagram.com/1631821640426723";
const IG_AI = "https://help.instagram.com/761121959519495";
const TIKTOK_UPLOAD = "https://www.tiktok.com/support/faq_detail?id=7581821547946580492";
const TIKTOK_AI = "https://www.tiktok.com/creator-academy/en/article/ai-generated-content-label";
const YT_API = "https://developers.google.com/youtube/v3/docs/videos";
const YT_HASHTAGS = "https://support.google.com/youtube/answer/6390658";
const YT_SHORTS = "https://support.google.com/youtube/answer/15424877";
const YT_AI = "https://support.google.com/youtube/answer/14328491";
const PIN_SPECS = "https://help.pinterest.com/en/article/review-pin-specs";
const PIN_AI = "https://help.pinterest.com/en/article/create-a-pin-from-an-image-or-video";

const MB = 1024 * 1024;
// Five since December 2025, from Instagram's own post quoted by the press; the API page still says 30.
const IG_HASHTAG_LIMIT: Limit = { measure: "hashtags", max: 5, source: IG_HASHTAGS };

export const PLATFORM_RULES: Readonly<Record<Platform, PlatformRules>> = {
  // A free account sharing through the app or web; the API allows more.
  x: {
    counting: "x-weighted",
    limits: [
      { measure: "text", max: 280, source: X_COUNTING },
      { measure: "duration", kind: "video", max: 140, source: X_VIDEO },
      { measure: "size", kind: "video", max: 512 * MB, source: X_VIDEO },
      { measure: "ratio", kind: "video", min: 1 / 3, max: 3, source: X_MEDIA },
      { measure: "size", kind: "image", max: 5 * MB, source: X_MEDIA },
    ],
    // "Made with AI" is known only from user posts and the API's `made_with_ai`.
    aiSwitch: null,
  },
  "instagram-reels": {
    counting: "chars",
    limits: [
      { measure: "text", max: 2200, source: IG_API },
      IG_HASHTAG_LIMIT,
      { measure: "duration", kind: "video", max: 20 * 60, source: IG_REELS },
      { measure: "ratio", kind: "video", min: 9 / 16, max: 1.91, source: IG_REELS_SPECS },
      // "Minimum resolution of 720 pixels", read as the short side.
      { measure: "short-side", kind: "video", min: 720, source: IG_REELS_SPECS },
    ],
    aiSwitch: { phoneOnly: true, source: IG_AI },
  },
  // Feed video has no official limits of its own, so only images are measured.
  "instagram-post": {
    counting: "chars",
    limits: [
      { measure: "text", max: 2200, source: IG_API },
      IG_HASHTAG_LIMIT,
      // The app page; the API page allows only 4:5 to 1.91:1, but Postbell's shares go through the app.
      { measure: "ratio", kind: "image", min: 3 / 4, max: 1.91, source: IG_IMAGE },
    ],
    aiSwitch: { phoneOnly: true, source: IG_AI },
  },
  // TikTok's caption limit in the app, its ratios and hashtag cap are on no official page.
  tiktok: {
    counting: "chars",
    limits: [{ measure: "duration", kind: "video", max: 60 * 60, source: TIKTOK_UPLOAD }],
    aiSwitch: { phoneOnly: false, source: TIKTOK_AI },
  },
  // The share text goes to the description; a Short is square or vertical and at most 3 minutes.
  "youtube-shorts": {
    counting: "bytes",
    limits: [
      { measure: "text", max: 5000, source: YT_API },
      { measure: "hashtags", max: 60, source: YT_HASHTAGS },
      { measure: "duration", kind: "video", max: 3 * 60, source: YT_SHORTS },
      { measure: "ratio", kind: "video", max: 1, source: YT_SHORTS },
    ],
    aiSwitch: { phoneOnly: false, source: YT_AI },
  },
  // The share text goes to the description. Video: 9:16 recommended, 1:2 to 1:1 allowed.
  pinterest: {
    counting: "chars",
    limits: [
      { measure: "text", max: 800, source: PIN_SPECS },
      { measure: "duration", kind: "video", min: 4, max: 5 * 60, source: PIN_SPECS },
      { measure: "ratio", kind: "video", min: 1 / 2, max: 1, source: PIN_SPECS },
      { measure: "size", kind: "image", max: 20 * MB, source: PIN_SPECS },
    ],
    aiSwitch: { phoneOnly: false, source: PIN_AI },
  },
};

// X's counting page, with the ranges of twitter-text's `config/v3.json`: these count 1, any other code point 2,
// an emoji sequence 2, a link 23.
const X_LIGHT: readonly (readonly [number, number])[] = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];
const X_LINK = 23;
// Links with a scheme or `www.`; X also links bare domains such as `example.com`, which this count treats as text.
const LINK = /\b(?:https?:\/\/|www\.)\S+/giu;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function xLength(text: string): number {
  let links = 0;
  const rest = text.normalize("NFC").replace(LINK, () => {
    links++;
    return " ";
  });
  // The space standing in for each link is not counted.
  let n = links * (X_LINK - 1);
  for (const { segment } of graphemes.segment(rest)) {
    if (/\p{Extended_Pictographic}/u.test(segment)) {
      n += 2;
      continue;
    }
    for (const ch of segment) {
      const c = ch.codePointAt(0) ?? 0;
      n += X_LIGHT.some(([lo, hi]) => c >= lo && c <= hi) ? 1 : 2;
    }
  }
  return n;
}

export function textLength(text: string, counting: Counting): number {
  if (counting === "x-weighted") return xLength(text);
  if (counting === "bytes") return new TextEncoder().encode(text).length;
  return [...text].length;
}

// A hashtag starts after a space or punctuation and holds at least one letter (`#1` is not one).
const HASHTAG = /(?:^|[^\p{L}\p{N}_&])#[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*/gu;
export const hashtagCount = (text: string): number => text.match(HASHTAG)?.length ?? 0;

export type Check =
  | { readonly kind: "measured"; readonly measure: Measure; readonly value: number; readonly min?: number; readonly max?: number; readonly ok: boolean; readonly source: string }
  // `account`: the platform is open on the right account; `ai-label`: the entry needs the platform's AI switch.
  | { readonly kind: "todo"; readonly todo: "account" }
  | { readonly kind: "todo"; readonly todo: "ai-label"; readonly phoneOnly: boolean; readonly source: string };

// `size` is the file's bytes when the package folder has the file; without it the size limit is not checked.
export function checksOf(entry: PlatformEntry, size: number | undefined): readonly Check[] {
  const rules = PLATFORM_RULES[entry.platform];
  const f = entry.file;
  const valueOf = (m: Measure): number | undefined => {
    switch (m) {
      case "text":
        return textLength(entry.text, rules.counting);
      case "hashtags":
        return hashtagCount(entry.text);
      case "duration":
        return f.durationSec;
      case "ratio":
        return f.width / f.height;
      case "short-side":
        return Math.min(f.width, f.height);
      case "size":
        return size;
    }
  };
  const out: Check[] = [{ kind: "todo", todo: "account" }];
  for (const l of rules.limits) {
    if (l.kind !== undefined && l.kind !== f.kind) continue;
    const value = valueOf(l.measure);
    if (value === undefined) continue;
    const ok = (l.min === undefined || value >= l.min) && (l.max === undefined || value <= l.max);
    out.push({ kind: "measured", measure: l.measure, value, min: l.min, max: l.max, ok, source: l.source });
  }
  if (entry.aiLabel && rules.aiSwitch) out.push({ kind: "todo", todo: "ai-label", phoneOnly: rules.aiSwitch.phoneOnly, source: rules.aiSwitch.source });
  return out;
}
