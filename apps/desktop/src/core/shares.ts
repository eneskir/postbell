import type { Content, ContentFile, Language, Platform } from "./manifest.ts";
import { at, dateOf, MINUTE, parseDate, type LocalDate, type LocalMs, type TimeOfDay } from "./time.ts";

export type BrandId = string & { readonly __brand: "BrandId" };
export type AccountId = string & { readonly __brand: "AccountId" };
export type ContentId = string & { readonly __brand: "ContentId" };
// Stored in the store file, so the format must stay stable.
export type ShareId = string & { readonly __brand: "ShareId" };

export const shareIdOf = (brand: BrandId, content: ContentId, platform: Platform) => `${brand}/${content}/${platform}` as ShareId;

export const contentKeyOf = (brand: BrandId, content: ContentId) => `${brand}/${content}`;

export const fileKeyOf = (brand: BrandId, content: ContentId, path: string) => `${brand}/${content}/${path}`;

// A package `platform` is a format of a network; Threads has none because the content pipeline makes no Threads packages.
export type Network = "x" | "instagram" | "threads" | "tiktok" | "youtube" | "pinterest";
// A Record so that each network is listed exactly once.
const NETWORK_SET: Readonly<Record<Network, true>> = { x: true, instagram: true, threads: true, tiktok: true, youtube: true, pinterest: true };
export const NETWORKS = Object.keys(NETWORK_SET) as readonly Network[];
const NETWORK_OF: Readonly<Record<Platform, Network>> = {
  x: "x",
  "instagram-reels": "instagram",
  "instagram-post": "instagram",
  tiktok: "tiktok",
  "youtube-shorts": "youtube",
  pinterest: "pinterest",
};
export const networkOf = (p: Platform): Network => NETWORK_OF[p];
export const FORMATS = Object.keys(NETWORK_OF) as readonly Platform[];
export const formatsOf = (n: Network): readonly Platform[] => FORMATS.filter((p) => NETWORK_OF[p] === n);

export type Times = Partial<Readonly<Record<Platform, TimeOfDay>>>;

export type Account = {
  readonly id: AccountId;
  readonly brand: BrandId;
  readonly network: Network;
  readonly handle: string;
  readonly language: Language;
  readonly times: Times; // only `formatsOf(network)`, checked at the store boundary
};

export function accountFor(accounts: readonly Account[], brand: BrandId, platform: Platform, language: Language): Account | null {
  const network = networkOf(platform);
  const same = accounts.filter((a) => a.brand === brand && a.network === network);
  if (same.length === 1) return same[0]!;
  return same.find((a) => a.language === language) ?? null;
}

export type ShareRecord = { readonly share: ShareId; readonly status: "done" | "skipped"; readonly at: LocalMs };

export type PlannedAt = { readonly kind: "at"; readonly at: LocalMs } | { readonly kind: "unscheduled"; readonly date: LocalDate };

export type ShareStatus =
  | { readonly kind: "upcoming" }
  | { readonly kind: "due" }
  | { readonly kind: "late"; readonly lateBy: number } // minutes after the planned time
  | { readonly kind: "done"; readonly at: LocalMs }
  | { readonly kind: "skipped"; readonly at: LocalMs };

export type ShareBlocker = "file-missing" | "account-missing";

export type Share = {
  readonly id: ShareId;
  readonly content: Content;
  readonly brand: BrandId;
  readonly platform: Platform;
  readonly account: Account | null;
  readonly plannedAt: PlannedAt;
  readonly file: ContentFile;
  readonly text: string;
  readonly aiLabel: boolean;
  readonly status: ShareStatus;
  readonly blockers: readonly ShareBlocker[];
};

export const LATE_AFTER_MIN = 30;

export type DeriveInput = {
  readonly contents: readonly Content[];
  readonly accounts: readonly Account[];
  readonly records: readonly ShareRecord[];
  // Files not found in the folder, keyed by `fileKeyOf`.
  readonly missingFiles: ReadonlySet<string>;
  readonly now: LocalMs;
};

export function statusOf(planned: PlannedAt, record: ShareRecord | undefined, now: LocalMs): ShareStatus {
  if (record) return { kind: record.status, at: record.at };
  if (planned.kind === "unscheduled") return { kind: "upcoming" };
  if (now < planned.at) return { kind: "upcoming" };
  const lateBy = Math.floor((now - planned.at) / MINUTE);
  return lateBy < LATE_AFTER_MIN ? { kind: "due" } : { kind: "late", lateBy };
}

export function deriveShares(input: DeriveInput): Share[] {
  const records = new Map(input.records.map((r) => [r.share, r]));
  const out: Share[] = [];
  for (const content of input.contents) {
    const brand = content.brand as BrandId;
    const date = parseDate(content.date);
    if (!date) throw new Error(`SHARES_DATE_INVALID: ${content.id}`);
    for (const entry of content.entries) {
      const id = shareIdOf(brand, content.id as ContentId, entry.platform);
      const account = accountFor(input.accounts, brand, entry.platform, content.language);
      const time = account?.times[entry.platform];
      const plannedAt: PlannedAt = time === undefined ? { kind: "unscheduled", date } : { kind: "at", at: at(date, time) };
      const blockers: ShareBlocker[] = [];
      if (input.missingFiles.has(fileKeyOf(brand, content.id as ContentId, entry.file.path))) blockers.push("file-missing");
      if (!account) blockers.push("account-missing");
      out.push({
        id,
        content,
        brand,
        platform: entry.platform,
        account,
        plannedAt,
        file: entry.file,
        text: entry.text,
        aiLabel: entry.aiLabel,
        status: statusOf(plannedAt, records.get(id), input.now),
        blockers,
      });
    }
  }
  return out;
}

export const plannedDate = (s: Share): LocalDate => (s.plannedAt.kind === "at" ? dateOf(s.plannedAt.at) : s.plannedAt.date);

export type TodayGroups = {
  readonly late: readonly Share[];
  readonly upcoming: readonly Share[];
  readonly unscheduled: readonly Share[];
  readonly finished: readonly Share[];
};

const sortKey = (s: Share): number => (s.plannedAt.kind === "at" ? s.plannedAt.at : Number.MAX_SAFE_INTEGER);
const finishedAt = (s: Share): number => (s.status.kind === "done" || s.status.kind === "skipped" ? s.status.at : 0);
const byContent = (a: Share, b: Share) =>
  a.content.id.localeCompare(b.content.id) || FORMATS.indexOf(a.platform) - FORMATS.indexOf(b.platform) || a.id.localeCompare(b.id);
const byTime = (a: Share, b: Share) => sortKey(a) - sortKey(b) || byContent(a, b);

export function todayGroups(shares: readonly Share[], today: LocalDate): TodayGroups {
  const late: Share[] = [];
  const upcoming: Share[] = [];
  const unscheduled: Share[] = [];
  const finished: Share[] = [];
  for (const s of shares) {
    const day = plannedDate(s);
    const k = s.status.kind;
    if (k === "late") late.push(s);
    else if (k === "done" || k === "skipped") {
      if (day === today) finished.push(s);
    } else if (s.plannedAt.kind === "unscheduled") {
      if (day <= today) unscheduled.push(s);
    } else if (day === today || k === "due") upcoming.push(s);
  }
  return {
    late: late.sort(byTime),
    upcoming: upcoming.sort(byTime),
    unscheduled: unscheduled.sort(byContent),
    finished: finished.sort((a, b) => finishedAt(a) - finishedAt(b) || byContent(a, b)),
  };
}

export function lateCount(shares: readonly Share[], brand: BrandId): number {
  return shares.filter((s) => s.brand === brand && s.status.kind === "late").length;
}
