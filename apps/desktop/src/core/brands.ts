import { cleanName, sameName, slug, uniqueId } from "./names.ts";
import type { BrandId } from "./shares.ts";
import { HOME } from "./settings.ts";
import { moveBrand } from "./sidebar.ts";
import type { Brand, StoreFile } from "./store.ts";

export type BrandDraft = { readonly name: string; readonly sticker: string; readonly folder: string | null };

export type BrandProblem =
  | { readonly field: "name"; readonly code: "empty" | "taken" }
  | { readonly field: "folder"; readonly code: "missing" }
  | { readonly field: "folder"; readonly code: "taken"; readonly by: string };

// Windows paths are case-insensitive; separator style and a trailing separator are spelling differences.
// Only a clash check: the shell's allowlist (`packages.rs`, on canonical paths) is the access boundary.
export const folderKey = (f: string): string => f.trim().replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();

export function brandProblems(s: StoreFile, d: BrandDraft, self?: BrandId): BrandProblem[] {
  const out: BrandProblem[] = [];
  const others = s.brands.filter((b) => b.id !== self);
  const name = cleanName(d.name);
  if (name === null) out.push({ field: "name", code: "empty" });
  else if (others.some((b) => sameName(b.name, name))) out.push({ field: "name", code: "taken" });
  const folder = d.folder?.trim() ?? "";
  if (folder === "") out.push({ field: "folder", code: "missing" });
  else {
    const other = others.find((b) => folderKey(b.folder) === folderKey(folder));
    if (other) out.push({ field: "folder", code: "taken", by: other.name });
  }
  return out;
}

// The id must match the packages' `brand`, which the content pipeline takes from the brand folder name.
export function brandIdFor(s: StoreFile, folder: string, name: string): BrandId {
  const base = folder.split(/[\\/]/).filter((p) => p !== "").pop() ?? "";
  return uniqueId(slug(base, "") || slug(name, "marka"), new Set(s.brands.map((b) => b.id))) as BrandId;
}

export type AddBrandResult =
  | { readonly ok: true; readonly store: StoreFile; readonly id: BrandId }
  | { readonly ok: false; readonly problems: readonly BrandProblem[] };

export function addBrand(s: StoreFile, d: BrandDraft, group?: string): AddBrandResult {
  const problems = brandProblems(s, d);
  const name = cleanName(d.name);
  const folder = d.folder?.trim();
  if (problems.length || name === null || !folder) return { ok: false, problems };
  const id = brandIdFor(s, folder, name);
  const brand: Brand = { id, name, sticker: d.sticker, folder };
  const next: StoreFile = { ...s, brands: [...s.brands, brand] };
  const target = group === undefined ? undefined : next.groups.find((g) => g.id === group);
  return { ok: true, id, store: target ? moveBrand(next, id, { group: target.id, index: target.brands.length }) : next };
}

export type BrandPatch = Partial<Pick<Brand, "name" | "sticker" | "folder">>;

export type UpdateBrandResult = { readonly ok: true; readonly store: StoreFile } | { readonly ok: false; readonly problems: readonly BrandProblem[] };

export function updateBrand(s: StoreFile, id: BrandId, patch: BrandPatch): UpdateBrandResult {
  const b = s.brands.find((x) => x.id === id);
  if (!b) return { ok: true, store: s };
  const draft: BrandDraft = { name: patch.name ?? b.name, sticker: patch.sticker ?? b.sticker, folder: patch.folder ?? b.folder };
  const problems = brandProblems(s, draft, id).filter((p) => patch[p.field] !== undefined);
  if (problems.length) return { ok: false, problems };
  const next: Brand = { id, name: cleanName(draft.name) ?? b.name, sticker: draft.sticker, folder: draft.folder?.trim() || b.folder };
  if (next.name === b.name && next.sticker === b.sticker && next.folder === b.folder) return { ok: true, store: s };
  return { ok: true, store: { ...s, brands: s.brands.map((x) => (x.id === id ? next : x)) } };
}

export function removeBrand(s: StoreFile, id: BrandId): StoreFile {
  if (!s.brands.some((b) => b.id === id)) return s;
  const own = `${id}/`;
  return {
    ...s,
    brands: s.brands.filter((b) => b.id !== id),
    groups: s.groups.map((g) => (g.brands.includes(id) ? { ...g, brands: g.brands.filter((x) => x !== id) } : g)),
    accounts: s.accounts.filter((a) => a.brand !== id),
    records: s.records.filter((r) => !r.share.startsWith(own)),
    sidebar: { ...s.sidebar, openBrands: s.sidebar.openBrands.filter((x) => x !== id) },
    lastPage: "brand" in s.lastPage && s.lastPage.brand === id ? HOME : s.lastPage,
  };
}
