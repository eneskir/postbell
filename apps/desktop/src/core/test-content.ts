import { parseManifest, type Content, type Language } from "./manifest.ts";

export type ContentSpec = {
  readonly id: string;
  readonly platforms: readonly string[];
  readonly brand?: string;
  readonly date?: string;
  readonly language?: Language;
  readonly title?: string;
  // A 38-second main.mp4 instead of a main.png image.
  readonly video?: boolean;
};

// Tests only: a content package built through the real manifest parser, one main file shared by every platform.
export function testContent({ id, platforms, brand = "initech", date = "2026-11-11", language = "en", title = id, video = false }: ContentSpec): Content {
  const r = parseManifest({
    schemaVersion: 1, id, brand, date, language, title, approval: "approved",
    files: [
      video
        ? { id: "main", kind: "video", role: "main", path: "main.mp4", width: 1080, height: 1920, durationSec: 38 }
        : { id: "main", kind: "image", role: "main", path: "main.png", width: 10, height: 10 },
    ],
    entries: platforms.map((p) => ({ platform: p, file: "main", text: "text", aiLabel: false })),
    sources: [{ title: "source", url: "https://example.com", license: "CC0-1.0" }],
    aiUsage: { voice: false, visuals: false, text: false },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.content;
}
