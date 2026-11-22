import { LANGUAGES, type Platform } from "./manifest.ts";
import { validate, type Schema } from "./schema.ts";
import { FORMATS, formatsOf, NETWORKS, TWO_STEP, type Account, type AccountDetails, type AccountId, type BrandId, type Network, type PlannedAt, type ShareId, type ShareRecord, type Times, type TwoStep } from "./shares.ts";
import { formatLocal, formatTime, parseDate, parseLocal, parseTime, TIME_PATTERN, type LocalMs, type TimeOfDay } from "./time.ts";

// Version 2 added the account details (e-mail, 2-step type, recovery e-mail, note) and the title and planned time on
// records; version 3 the vault backup state. An older file reads as version 3 with the newer fields absent; the next
// save writes version 3.
export const STORE_VERSION = 3;

export type Brand = {
  readonly id: BrandId;
  readonly name: string;
  // An unknown sticker name falls back to one derived from the id, so the file stays readable.
  readonly sticker: string;
  readonly folder: string;
};
export type Group = { readonly id: string; readonly name: string; readonly open: boolean; readonly brands: readonly BrandId[] };
export type Sidebar = { readonly collapsed: boolean; readonly width: number; readonly openBrands: readonly BrandId[] };
// `last`: when the last vault backup was saved. `pending`: what changed in the vault since then, for the reminder on
// Hesaplar; a new account outranks a changed password. `later`: the reminder was put off until the next change.
export type BackupPending = "new-account" | "changed-password";
export const BACKUP_PENDING: readonly BackupPending[] = ["new-account", "changed-password"];
export type BackupState = { readonly last?: LocalMs; readonly pending?: BackupPending; readonly later?: true };

export type StoreFile = {
  readonly version: typeof STORE_VERSION;
  readonly brands: readonly Brand[];
  readonly groups: readonly Group[];
  readonly accounts: readonly Account[];
  readonly records: readonly ShareRecord[];
  // No app setting is stored yet; the empty object is part of the format since version 1.
  readonly settings: Readonly<Record<string, never>>;
  readonly sidebar: Sidebar;
  readonly backup: BackupState;
};

export const EMAIL_MAX = 254;
export const NOTE_MAX = 500;

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
  backup: {},
});

const SLUG = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const str = (maxLength: number, extra: Partial<Schema> = {}): Schema => ({ type: "string", minLength: 1, maxLength, ...extra });
const obj = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const LOCAL_MINUTE = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$";
const LOCAL_DAY = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";

const accountV1: Record<string, Schema> = {
  id: str(80, { pattern: SLUG }),
  brand: str(40, { pattern: SLUG }),
  network: { type: "string", enum: NETWORKS },
  handle: str(100),
  language: { type: "string", enum: LANGUAGES },
  times: obj(Object.fromEntries(FORMATS.map((p) => [p, { type: "string", pattern: TIME_PATTERN }])), []),
};
const accountV2: Record<string, Schema> = { ...accountV1, email: str(EMAIL_MAX), twoStep: { type: "string", enum: TWO_STEP }, recoveryEmail: str(EMAIL_MAX), note: str(NOTE_MAX) };
const recordV1: Record<string, Schema> = {
  share: str(200, { pattern: "^[a-z0-9-]+/[a-z0-9-]+/[a-z-]+$" }),
  status: { type: "string", enum: ["done", "skipped"] },
  at: { type: "string", pattern: LOCAL_MINUTE },
};
const recordV2: Record<string, Schema> = { ...recordV1, title: str(300), planned: { type: "string", pattern: `${LOCAL_MINUTE}|${LOCAL_DAY}` } };

const backupSchema = obj({ last: { type: "string", pattern: LOCAL_MINUTE }, pending: { type: "string", enum: BACKUP_PENDING }, later: { type: "boolean", const: true } }, []);

const storeSchema = (version: 1 | 2 | 3): Schema => {
  const base: Record<string, Schema> = {
  version: { type: "integer", const: version },
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
  accounts: { type: "array", items: version === 1 ? obj(accountV1) : obj(accountV2, Object.keys(accountV1)) },
  records: { type: "array", items: version === 1 ? obj(recordV1) : obj(recordV2, Object.keys(recordV1)) },
  settings: obj({}, []),
  sidebar: obj({
    collapsed: { type: "boolean" },
    width: { type: "integer", minimum: SIDEBAR_MIN, maximum: SIDEBAR_MAX },
    openBrands: { type: "array", items: str(40, { pattern: SLUG }) },
  }),
  };
  return version === 3 ? obj({ ...base, backup: backupSchema }) : obj(base);
};

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
  const v = validate(storeSchema(version === 1 || version === 2 ? version : 3), raw);
  if (v) return { kind: "unreadable", reason: "invalid-shape", path: v.path, rule: v.rule };
  const r = raw as RawStore;
  const records: ShareRecord[] = [];
  for (const [i, rec] of r.records.entries()) {
    const at = parseLocal(rec.at);
    if (at === null) return { kind: "unreadable", reason: "invalid-shape", path: `records[${i}].at`, rule: "calendar" };
    const planned = rec.planned === undefined ? undefined : parsePlanned(rec.planned);
    if (planned === null) return { kind: "unreadable", reason: "invalid-shape", path: `records[${i}].planned`, rule: "calendar" };
    records.push({ share: rec.share as ShareId, status: rec.status, at, ...(rec.title === undefined ? {} : { title: rec.title }), ...(planned ? { planned } : {}) });
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
    accounts.push({ id: a.id as AccountId, brand: a.brand as BrandId, network: a.network, handle: a.handle, language: a.language, times, ...detailsOf(a) });
  }
  for (const [i, b] of r.sidebar.openBrands.entries())
    if (!known.has(b)) return { kind: "unreadable", reason: "invalid-shape", path: `sidebar.openBrands[${i}]`, rule: "brand-ref" };
  const last = r.backup?.last === undefined ? undefined : parseLocal(r.backup.last);
  if (last === null) return { kind: "unreadable", reason: "invalid-shape", path: "backup.last", rule: "calendar" };
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
      backup: { ...(last ? { last } : {}), ...(r.backup?.pending ? { pending: r.backup.pending } : {}), ...(r.backup?.later ? { later: true as const } : {}) },
    },
  };
}

// Versions 1 and 2 are version 3 without the newer fields.
type RawStore = {
  brands: { id: string; name: string; sticker: string; folder: string }[];
  groups: { id: string; name: string; open: boolean; brands: string[] }[];
  accounts: ({ id: string; brand: string; network: Network; handle: string; language: Account["language"]; times: Record<string, string> } & RawDetails)[];
  records: { share: string; status: "done" | "skipped"; at: string; title?: string; planned?: string }[];
  sidebar: { collapsed: boolean; width: number; openBrands: string[] };
  backup?: { last?: string; pending?: BackupPending; later?: true };
};
type RawDetails = { email?: string; twoStep?: TwoStep; recoveryEmail?: string; note?: string };

// An absent field stays absent, so a store read back equals the one written.
function detailsOf(d: AccountDetails): AccountDetails {
  return {
    ...(d.email === undefined ? {} : { email: d.email }),
    ...(d.twoStep === undefined ? {} : { twoStep: d.twoStep }),
    ...(d.recoveryEmail === undefined ? {} : { recoveryEmail: d.recoveryEmail }),
    ...(d.note === undefined ? {} : { note: d.note }),
  };
}

function parsePlanned(s: string): PlannedAt | null {
  if (s.includes("T")) {
    const at = parseLocal(s);
    return at === null ? null : { kind: "at", at };
  }
  const date = parseDate(s);
  return date === null ? null : { kind: "unscheduled", date };
}

const plannedText = (p: PlannedAt): string => (p.kind === "at" ? formatLocal(p.at) : p.date);

const timesText = (t: Times): Record<string, string> =>
  Object.fromEntries(FORMATS.flatMap((p) => (t[p] === undefined ? [] : [[p, formatTime(t[p])]])));

export function serializeStore(s: StoreFile): string {
  const raw = {
    version: s.version,
    brands: s.brands.map((b) => ({ id: b.id, name: b.name, sticker: b.sticker, folder: b.folder })),
    groups: s.groups.map((g) => ({ id: g.id, name: g.name, open: g.open, brands: g.brands })),
    accounts: s.accounts.map((a) => ({ id: a.id, brand: a.brand, network: a.network, handle: a.handle, language: a.language, times: timesText(a.times), ...detailsOf(a) })),
    records: s.records.map((r) => ({
      share: r.share,
      status: r.status,
      at: formatLocal(r.at),
      ...(r.title === undefined ? {} : { title: r.title }),
      ...(r.planned === undefined ? {} : { planned: plannedText(r.planned) }),
    })),
    settings: s.settings,
    sidebar: { collapsed: s.sidebar.collapsed, width: s.sidebar.width, openBrands: s.sidebar.openBrands },
    backup: {
      ...(s.backup.last === undefined ? {} : { last: formatLocal(s.backup.last) }),
      ...(s.backup.pending === undefined ? {} : { pending: s.backup.pending }),
      ...(s.backup.later ? { later: true } : {}),
    },
  };
  return `${JSON.stringify(raw, null, 2)}\n`;
}

export const withRecord = (s: StoreFile, r: ShareRecord): StoreFile => ({
  ...s,
  records: [...s.records.filter((x) => x.share !== r.share), r],
});

export const withoutRecord = (s: StoreFile, share: ShareId): StoreFile =>
  s.records.some((x) => x.share === share) ? { ...s, records: s.records.filter((x) => x.share !== share) } : s;
