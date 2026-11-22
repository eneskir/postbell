import { cleanName, lower, lowerWord, slug, uniqueId, upper } from "./names.ts";
import type { BrandId } from "./shares.ts";
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, type Brand, type Sidebar, type StoreFile } from "./store.ts";

export const SIDEBAR_STRIP = 48;
export const COLLAPSE_BELOW = (SIDEBAR_STRIP + SIDEBAR_MIN) / 2;

export function resize(s: Sidebar, requested: number): Sidebar {
  if (requested < COLLAPSE_BELOW) return { ...s, collapsed: true };
  return { ...s, collapsed: false, width: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(requested))) };
}

export const resetWidth = (s: Sidebar): Sidebar => ({ ...s, collapsed: false, width: SIDEBAR_DEFAULT });

export const toggleCollapsed = (s: Sidebar): Sidebar => ({ ...s, collapsed: !s.collapsed });

export const toggleBrand = (s: StoreFile, brand: BrandId): StoreFile => {
  const open = s.sidebar.openBrands;
  return { ...s, sidebar: { ...s.sidebar, openBrands: open.includes(brand) ? open.filter((b) => b !== brand) : [...open, brand] } };
};

export const openBrand = (s: StoreFile, brand: BrandId): StoreFile => (s.sidebar.openBrands.includes(brand) ? s : toggleBrand(s, brand));

export const toggleGroup = (s: StoreFile, id: string): StoreFile => ({
  ...s,
  groups: s.groups.map((g) => (g.id === id ? { ...g, open: !g.open } : g)),
});

export function ungrouped(s: StoreFile): Brand[] {
  const grouped = new Set(s.groups.flatMap((g) => g.brands));
  return s.brands.filter((b) => !grouped.has(b.id));
}

export function sidebarOrder(s: StoreFile): Brand[] {
  const byId = new Map(s.brands.map((b) => [b.id, b]));
  return [...ungrouped(s), ...s.groups.flatMap((g) => g.brands.flatMap((id) => byId.get(id) ?? []))];
}

export function addGroup(s: StoreFile, name: string): { readonly store: StoreFile; readonly id: string } {
  const clean = cleanName(name) ?? NEW_GROUP;
  const id = uniqueId(slug(clean, "grup"), new Set(s.groups.map((g) => g.id)));
  return { store: { ...s, groups: [...s.groups, { id, name: clean, open: true, brands: [] }] }, id };
}

export function renameGroup(s: StoreFile, id: string, name: string): StoreFile {
  const clean = cleanName(name);
  return clean === null ? s : { ...s, groups: s.groups.map((g) => (g.id === id ? { ...g, name: clean } : g)) };
}

export function removeGroup(s: StoreFile, id: string): StoreFile {
  const group = s.groups.find((g) => g.id === id);
  if (!group) return s;
  const freed = new Set<string>(group.brands);
  const back = group.brands.flatMap((b) => s.brands.filter((x) => x.id === b));
  return { ...s, brands: [...s.brands.filter((b) => !freed.has(b.id)), ...back], groups: s.groups.filter((g) => g.id !== id) };
}

// `group` null means ungrouped; `index` is the position in the target list.
export function moveBrand(s: StoreFile, brand: BrandId, to: { readonly group: string | null; readonly index: number }): StoreFile {
  const groups = s.groups.map((g) => ({ ...g, brands: g.brands.filter((b) => b !== brand) }));
  if (to.group !== null) {
    return { ...s, groups: groups.map((g) => (g.id === to.group ? { ...g, brands: insert(g.brands, brand, to.index) } : g)) };
  }
  const next = { ...s, groups };
  const others = ungrouped(next).filter((b) => b.id !== brand);
  const before = others[Math.max(0, to.index)]?.id;
  const moving = s.brands.find((b) => b.id === brand);
  if (!moving) return s;
  const rest = s.brands.filter((b) => b.id !== brand);
  const at = before === undefined ? rest.length : rest.findIndex((b) => b.id === before);
  return { ...next, brands: [...rest.slice(0, at), moving, ...rest.slice(at)] };
}

// `boundary` is a gap in the list that still holds the dragged item (0 before the first, n after the last); `from` is its index there, or null.
// Returns the index in the list without the item, or null for no move.
export function dropIndex(from: number | null, boundary: number): number | null {
  if (from === null) return boundary;
  if (boundary === from || boundary === from + 1) return null;
  return boundary > from ? boundary - 1 : boundary;
}

export function moveGroup(s: StoreFile, id: string, index: number): StoreFile {
  const moving = s.groups.find((g) => g.id === id);
  if (!moving) return s;
  return { ...s, groups: insert(s.groups.filter((g) => g.id !== id), moving, index) };
}

export function abbreviations(names: readonly string[]): string[] {
  const words = names.map((n) => n.trim().split(/\s+/).slice(0, 2));
  const take = words.map((w) => w.map((x) => (w.length === 1 ? Math.min(2, [...x].length) : 1)));
  const code = (i: number) =>
    words[i]!.map((w, k) => {
      const letters = [...w];
      return upper(letters[0] ?? "") + letters.slice(1, take[i]![k]).map(lower).join("");
    }).join("");
  // Each round adds a letter and letters run out, so the loop ends.
  for (;;) {
    let changed = false;
    for (let i = 0; i < words.length; i++)
      for (let j = i + 1; j < words.length; j++) {
        if (code(i) !== code(j) || names[i] === names[j]) continue;
        let k = 0;
        while (k < 1 && lowerWord(words[i]![k] ?? "") === lowerWord(words[j]![k] ?? "")) k++;
        for (const x of [i, j]) {
          const w = words[x]![k];
          const n = take[x]![k] ?? 0;
          if (w !== undefined && n < [...w].length) {
            take[x]![k] = n + 1;
            changed = true;
          }
        }
      }
    if (!changed) break;
  }
  return names.map((_, i) => code(i));
}

const NEW_GROUP = "Yeni grup";

function insert<T>(list: readonly T[], item: T, index: number): T[] {
  const at = Math.min(list.length, Math.max(0, index));
  return [...list.slice(0, at), item, ...list.slice(at)];
}
