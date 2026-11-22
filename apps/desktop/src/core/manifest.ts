import { manifestSchemaV1, type ManifestV1 } from "./manifest.gen.ts";
import { validate } from "./schema.ts";
import { parseDate } from "./time.ts";

export type Platform = ManifestV1["entries"][number]["platform"];
export type Language = ManifestV1["language"];
// A Record so that a missing or extra contract language fails to compile.
const LANGUAGE_SET: Readonly<Record<Language, true>> = { en: true, tr: true };
export const LANGUAGES = Object.keys(LANGUAGE_SET) as readonly Language[];
export type ContentFile = ManifestV1["files"][number];
export type Source = ManifestV1["sources"][number];
export type AiUsage = ManifestV1["aiUsage"];

export type PlatformEntry = {
  readonly platform: Platform;
  readonly file: ContentFile;
  readonly text: string;
  readonly aiLabel: boolean;
};

export type Content = {
  readonly id: string;
  readonly brand: string;
  readonly date: string;
  readonly title: string;
  readonly language: Language;
  readonly files: readonly ContentFile[];
  readonly entries: readonly PlatformEntry[];
  readonly sources: readonly Source[];
  readonly aiUsage: AiUsage;
};

export type ManifestError =
  | { readonly code: "invalid-json" }
  | { readonly code: "unknown-version"; readonly version: unknown }
  | { readonly code: "invalid-shape"; readonly path: string; readonly rule: string }
  | { readonly code: "not-approved"; readonly approval: string };

export type ManifestResult = { readonly ok: true; readonly content: Content } | { readonly ok: false; readonly error: ManifestError };

export const SUPPORTED_VERSION = 1;

const shape = (path: string, rule: string): ManifestResult => ({ ok: false, error: { code: "invalid-shape", path, rule } });

// JSON can carry lone surrogates (`\ud83d`): JS strings keep them, the shell's Rust strings reject them.
function illFormedPath(value: unknown, path: string): string | null {
  if (typeof value === "string") return /\p{Cs}/u.test(value) ? path : null;
  const children: [string, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [`${path}[${i}]`, v])
    : typeof value === "object" && value !== null
      ? Object.entries(value).map(([k, v]) => [path ? `${path}.${k}` : k, v])
      : [];
  for (const [p, v] of children) {
    const bad = illFormedPath(v, p);
    if (bad) return bad;
  }
  return null;
}

export function parseManifestText(text: string): ManifestResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: "invalid-json" } };
  }
  return parseManifest(raw);
}

export function parseManifest(raw: unknown): ManifestResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return shape("$", "type");
  if (!("schemaVersion" in raw)) return shape("schemaVersion", "required");
  const version = (raw as { schemaVersion: unknown }).schemaVersion;
  if (version !== SUPPORTED_VERSION) return { ok: false, error: { code: "unknown-version", version } };

  const violation = validate(manifestSchemaV1, raw);
  if (violation) return shape(violation.path, violation.rule);
  const m = raw as ManifestV1;

  const illFormed = illFormedPath(m, "");
  if (illFormed) return shape(illFormed, "unicode");
  if (parseDate(m.date) === null) return shape("date", "date");
  const files = new Map<string, ContentFile>();
  for (const [i, f] of m.files.entries()) {
    if (files.has(f.id)) return shape(`files[${i}].id`, "unique");
    if (f.kind === "video" && f.durationSec === undefined) return shape(`files[${i}].durationSec`, "required");
    files.set(f.id, f);
  }
  const platforms = new Set<Platform>();
  const entries: PlatformEntry[] = [];
  for (const [i, e] of m.entries.entries()) {
    if (platforms.has(e.platform)) return shape(`entries[${i}].platform`, "unique");
    const file = files.get(e.file);
    if (!file) return shape(`entries[${i}].file`, "reference");
    platforms.add(e.platform);
    entries.push({ platform: e.platform, file, text: e.text, aiLabel: e.aiLabel });
  }

  if (m.approval !== "approved") return { ok: false, error: { code: "not-approved", approval: m.approval } };

  return {
    ok: true,
    content: {
      id: m.id,
      brand: m.brand,
      date: m.date,
      title: m.title,
      language: m.language,
      files: m.files,
      entries,
      sources: m.sources,
      aiUsage: m.aiUsage,
    },
  };
}
