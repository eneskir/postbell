import { LANGUAGES, type Platform } from "./manifest.ts";
import { validate, type Schema } from "./schema.ts";
import { FORMATS, formatsOf, NETWORKS, type Account, type AccountId, type BrandId, type Network, type ShareId, type ShareRecord, type Times } from "./shares.ts";
import { formatLocal, formatTime, parseLocal, parseTime, type LocalMs, type TimeOfDay } from "./time.ts";

export const STORE_VERSION = 1;

export type Brand = {
  readonly id: BrandId;
  readonly name: string;
  // An unknown sticker name falls back to one derived from the id, so the file stays readable.
  readonly sticker: string;
  readonly folder: string;
};
export type Group = { readonly id: string; readonly name: string; readonly open: boolean; readonly brands: readonly BrandId[] };
export type Sidebar = { readonly collapsed: boolean; readonly width: number; readonly openBrands: readonly BrandId[] };

export type StoreFile = {
  readonly version: typeof STORE_VERSION;
  readonly brands: readonly Brand[];
  readonly groups: readonly Group[];
  readonly accounts: readonly Account[];
  readonly records: readonly ShareRecord[];
  readonly settings: Readonly<Record<string, never>>;
  readonly sidebar: Sidebar;
};

export const SIDEBAR_MIN = 224;
export const SIDEBAR_DEFAULT = 240;
export const SIDEBAR_MAX = 280;

export const emptyStore = (): StoreFile => ({
  version: STORE_VERSION,
  brands: [],
  groups: [],
  accounts: [],
  records: [],
  settings: {},
  sidebar: { collapsed: false, width: SIDEBAR_DEFAULT, openBrands: [] },
});

const SLUG = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const TIME = "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$";
const str = (maxLength: number, extra: Partial<Schema> = {}): Schema => ({ type: "string", minLength: 1, maxLength, ...extra });
const obj = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const storeSchemaV1: Schema = obj({
  version: { type: "integer", const: 1 },
  brands: {
    type: "array",
    items: obj({
      id: str(40, { pattern: SLUG }),
      name: str(80),
      sticker: str(40, { pattern: SLUG }),
      folder: str(1000),
    }),
  },
  groups: {
    type: "array",
    items: obj({ id: str(40, { pattern: SLUG }), name: str(80), open: { type: "boolean" }, brands: { type: "array", items: str(40, { pattern: SLUG }) } }),
  },
  accounts: {
    type: "array",
    items: obj({
      id: str(80, { pattern: SLUG }),
      brand: str(40, { pattern: SLUG }),
      network: { type: "string", enum: NETWORKS },
      handle: str(100),
      language: { type: "string", enum: LANGUAGES },
      times: obj(Object.fromEntries(FORMATS.map((p) => [p, { type: "string", pattern: TIME }])), []),
    }),
  },
  records: {
    type: "array",
    items: obj({
      share: str(200, { pattern: "^[a-z0-9-]+/[a-z0-9-]+/[a-z-]+$" }),
      status: { type: "string", enum: ["done", "skipped"] },
      at: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$" },
    }),
  },
  settings: obj({}, []),
  sidebar: obj({
    collapsed: { type: "boolean" },
    width: { type: "integer", minimum: SIDEBAR_MIN, maximum: SIDEBAR_MAX },
    openBrands: { type: "array", items: str(40, { pattern: SLUG }) },
  }),
});

export type StoreState =
  | { readonly kind: "empty" }
  | { readonly kind: "ready"; readonly store: StoreFile }
  | { readonly kind: "unreadable"; readonly reason: "invalid-json" | "invalid-shape"; readonly path?: string; readonly rule?: string }
  | { readonly kind: "newer-version"; readonly version: number };

export const canWrite = (s: StoreState): boolean => s.kind === "empty" || s.kind === "ready";

export function parseStoreText(text: string | null): StoreState {
  if (text === null) return { kind: "empty" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: "unreadable", reason: "invalid-json" };
  }
  const version = typeof raw === "object" && raw !== null ? (raw as { version?: unknown }).version : undefined;
  if (typeof version === "number" && Number.isInteger(version) && version > STORE_VERSION) return { kind: "newer-version", version };
  const v = validate(storeSchemaV1, raw);
  if (v) return { kind: "unreadable", reason: "invalid-shape", path: v.path, rule: v.rule };
  const r = raw as RawStoreV1;
  const records: ShareRecord[] = [];
  for (const [i, rec] of r.records.entries()) {
    const at = parseLocal(rec.at);
    if (at === null) return { kind: "unreadable", reason: "invalid-shape", path: `records[${i}].at`, rule: "calendar" };
    records.push({ share: rec.share as ShareId, status: rec.status, at });
  }
  const brands: Brand[] = [];
  for (const [i, b] of r.brands.entries()) {
    if (brands.some((x) => x.id === b.id)) return { kind: "unreadable", reason: "invalid-shape", path: `brands[${i}].id`, rule: "unique" };
    brands.push({ id: b.id as BrandId, name: b.name, sticker: b.sticker, folder: b.folder });
  }
  const known = new Set<string>(brands.map((b) => b.id));
  const groupIds = new Set<string>();
  const grouped = new Set<string>();
  for (const [i, g] of r.groups.entries()) {
    if (groupIds.has(g.id)) return { kind: "unreadable", reason: "invalid-shape", path: `groups[${i}].id`, rule: "unique" };
    groupIds.add(g.id);
    for (const [j, b] of g.brands.entries()) {
      if (!known.has(b)) return { kind: "unreadable", reason: "invalid-shape", path: `groups[${i}].brands[${j}]`, rule: "brand-ref" };
      if (grouped.has(b)) return { kind: "unreadable", reason: "invalid-shape", path: `groups[${i}].brands[${j}]`, rule: "unique" };
      grouped.add(b);
    }
  }
  const accounts: Account[] = [];
  for (const [i, a] of r.accounts.entries()) {
    if (accounts.some((x) => x.id === a.id)) return { kind: "unreadable", reason: "invalid-shape", path: `accounts[${i}].id`, rule: "unique" };
    if (!known.has(a.brand)) return { kind: "unreadable", reason: "invalid-shape", path: `accounts[${i}].brand`, rule: "brand-ref" };
    const own = formatsOf(a.network);
    const times: Partial<Record<Platform, TimeOfDay>> = {};
    for (const [p, t] of Object.entries(a.times)) {
      if (!own.includes(p as Platform)) return { kind: "unreadable", reason: "invalid-shape", path: `accounts[${i}].times.${p}`, rule: "network" };
      times[p as Platform] = parseTime(t) as TimeOfDay;
    }
    accounts.push({ id: a.id as AccountId, brand: a.brand as BrandId, network: a.network, handle: a.handle, language: a.language, times });
  }
  for (const [i, b] of r.sidebar.openBrands.entries())
    if (!known.has(b)) return { kind: "unreadable", reason: "invalid-shape", path: `sidebar.openBrands[${i}]`, rule: "brand-ref" };
  return {
    kind: "ready",
    store: {
      version: STORE_VERSION,
      brands,
      groups: r.groups.map((g) => ({ id: g.id, name: g.name, open: g.open, brands: g.brands as BrandId[] })),
      accounts,
      records,
      settings: {},
      sidebar: { collapsed: r.sidebar.collapsed, width: r.sidebar.width, openBrands: r.sidebar.openBrands as BrandId[] },
    },
  };
}

type RawStoreV1 = {
  brands: { id: string; name: string; sticker: string; folder: string }[];
  groups: { id: string; name: string; open: boolean; brands: string[] }[];
  accounts: { id: string; brand: string; network: Network; handle: string; language: Account["language"]; times: Record<string, string> }[];
  records: { share: string; status: "done" | "skipped"; at: string }[];
  sidebar: { collapsed: boolean; width: number; openBrands: string[] };
};

const timesText = (t: Times): Record<string, string> =>
  Object.fromEntries(FORMATS.flatMap((p) => (t[p] === undefined ? [] : [[p, formatTime(t[p])]])));

export function serializeStore(s: StoreFile): string {
  const raw = {
    version: s.version,
    brands: s.brands.map((b) => ({ id: b.id, name: b.name, sticker: b.sticker, folder: b.folder })),
    groups: s.groups.map((g) => ({ id: g.id, name: g.name, open: g.open, brands: g.brands })),
    accounts: s.accounts.map((a) => ({ id: a.id, brand: a.brand, network: a.network, handle: a.handle, language: a.language, times: timesText(a.times) })),
    records: s.records.map((r) => ({ share: r.share, status: r.status, at: formatLocal(r.at as LocalMs) })),
    settings: s.settings,
    sidebar: { collapsed: s.sidebar.collapsed, width: s.sidebar.width, openBrands: s.sidebar.openBrands },
  };
  return `${JSON.stringify(raw, null, 2)}\n`;
}

export const withRecord = (s: StoreFile, r: ShareRecord): StoreFile => ({
  ...s,
  records: [...s.records.filter((x) => x.share !== r.share), r],
});

export const withoutRecord = (s: StoreFile, share: ShareId): StoreFile =>
  s.records.some((x) => x.share === share) ? { ...s, records: s.records.filter((x) => x.share !== share) } : s;
