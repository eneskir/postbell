// Turkish casing (i to İ, I to ı) by hand rather than through the runtime locale.
export const NAME_MAX = 80;

export const upper = (c: string) => (c === "i" ? "İ" : c === "ı" ? "I" : c.toUpperCase());
export const lower = (c: string) => (c === "I" ? "ı" : c === "İ" ? "i" : c.toLowerCase());
export const lowerWord = (w: string) => [...w].map(lower).join("");

export function cleanName(name: string): string | null {
  const t = name.trim().replace(/\s+/g, " ");
  return t === "" ? null : [...t].slice(0, NAME_MAX).join("");
}

// Dotted and dotless i compare equal: Turkish casing turns "INITECH" into "ınıtech".
const nameKey = (n: string) => lowerWord(cleanName(n) ?? "").replaceAll("ı", "i");
export const sameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b);

const ASCII: Readonly<Record<string, string>> = { ç: "c", ğ: "g", ı: "i", i: "i", ö: "o", ş: "s", ü: "u" };

// At most 36 characters, leaving room for a number suffix within the 40-character id limit.
export function slug(name: string, fallback: string): string {
  const s = [...name]
    .map(lower)
    .map((c) => ASCII[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/, "");
  return s === "" ? fallback : s;
}

export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
