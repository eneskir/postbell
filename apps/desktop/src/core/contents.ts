import type { Content, ContentFile } from "./manifest.ts";
import { contentKeyOf, FORMATS, plannedDate, recordOf, type BrandId, type ContentId, type ContentKey, type Share, type ShareRecord } from "./shares.ts";
import { at, type LocalDate, type LocalMs, type TimeOfDay } from "./time.ts";

const LAST_MINUTE = (24 * 60 - 1) as TimeOfDay;

// `today`: something is left on a day up to today; `planned`: everything left is on a later day; `done`: nothing is left.
export type ContentGroup = "today" | "planned" | "done";
export const CONTENT_GROUPS: readonly ContentGroup[] = ["today", "planned", "done"];

export type ContentTag = { readonly kind: "late"; readonly count: number } | { readonly kind: "file-missing" } | { readonly kind: "due" } | { readonly kind: "skipped" };

export type ContentRow = {
  readonly key: ContentKey;
  readonly brand: BrandId;
  readonly content: Content;
  readonly file: ContentFile;
  readonly group: ContentGroup;
  // Sorted by planned time, then format.
  readonly shares: readonly Share[];
  readonly done: number;
  // The first share still left, by planned time; null when nothing is left.
  readonly next: Share | null;
  // The share Bugün should open: the first late one, else the next one when it is on Bugün; null for a planned or finished content.
  readonly goTo: Share | null;
  readonly tag: ContentTag | null;
};

export type ContentsView = {
  readonly groups: Readonly<Record<ContentGroup, readonly ContentRow[]>>;
  readonly total: number;
};

const finished = (s: Share) => s.status.kind === "done" || s.status.kind === "skipped";
// A share with no time sorts after the timed ones of its day.
const timeKey = (s: Share): number => (s.plannedAt.kind === "at" ? s.plannedAt.at : at(s.plannedAt.date, LAST_MINUTE) + 1);
const byTime = (a: Share, b: Share) => timeKey(a) - timeKey(b) || FORMATS.indexOf(a.platform) - FORMATS.indexOf(b.platform);
const finishedAt = (r: ContentRow): number => Math.max(...r.shares.map((s) => (s.status.kind === "done" || s.status.kind === "skipped" ? s.status.at : 0)));

// The preview file: the package's main file, which every manifest has.
const mainFile = (c: Content): ContentFile => c.files.find((f) => f.role === "main") ?? c.files[0]!;

function tagOf(left: readonly Share[], done: number): ContentTag | null {
  const late = left.filter((s) => s.status.kind === "late").length;
  if (late) return { kind: "late", count: late };
  if (left.some((s) => s.blockers.includes("file-missing"))) return { kind: "file-missing" };
  if (left.some((s) => s.status.kind === "due")) return { kind: "due" };
  if (left.length === 0 && done === 0) return { kind: "skipped" };
  return null;
}

function rowOf(key: ContentKey, shares: Share[], today: LocalDate): ContentRow {
  const first = shares[0]!;
  const sorted = shares.sort(byTime);
  const left = sorted.filter((s) => !finished(s));
  const done = sorted.filter((s) => s.status.kind === "done").length;
  const next = left[0] ?? null;
  const group: ContentGroup = !next ? "done" : left.some((s) => plannedDate(s) <= today) ? "today" : "planned";
  const goTo = left.find((s) => s.status.kind === "late") ?? (group === "today" ? next : null);
  return { key, brand: first.brand, content: first.content, file: mainFile(first.content), group, shares: sorted, done, next, goTo, tag: tagOf(left, done) };
}

export function contentsView(shares: readonly Share[], brand: BrandId, today: LocalDate): ContentsView {
  const byContent = new Map<ContentKey, Share[]>();
  for (const s of shares) {
    if (s.brand !== brand) continue;
    const key = contentKeyOf(s.brand, s.content.id as ContentId);
    const list = byContent.get(key);
    if (list) list.push(s);
    else byContent.set(key, [s]);
  }
  const groups: Record<ContentGroup, ContentRow[]> = { today: [], planned: [], done: [] };
  for (const [key, list] of byContent) {
    const row = rowOf(key, list, today);
    groups[row.group].push(row);
  }
  const byNext = (a: ContentRow, b: ContentRow) => byTime(a.next!, b.next!) || a.content.title.localeCompare(b.content.title, "tr");
  groups.today.sort(byNext);
  groups.planned.sort(byNext);
  groups.done.sort((a, b) => finishedAt(b) - finishedAt(a) || a.content.title.localeCompare(b.content.title, "tr"));
  return { groups, total: byContent.size };
}

export const contentRowOf = (view: ContentsView, key: ContentKey): ContentRow | null =>
  CONTENT_GROUPS.flatMap((g) => view.groups[g]).find((r) => r.key === key) ?? null;

// «Kalan paylaşımları atla»: a skip record for each share still left.
export const skipLeft = (row: ContentRow, when: LocalMs): ShareRecord[] => row.shares.filter((s) => !finished(s)).map((s) => recordOf(s, "skipped", when));
