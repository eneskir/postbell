import type { FolderState } from "./packages.ts";
import { plannedDate, todayGroups, type BrandId, type Share, type TodayGroups } from "./shares.ts";
import type { LocalDate, LocalMs } from "./time.ts";

export type DayList = {
  readonly groups: TodayGroups;
  readonly total: number;
  readonly late: number;
  readonly unscheduled: number;
};

export type TodayView = DayList & {
  // When the day is empty: the time of the first timed pending share after today, else null.
  readonly next: LocalMs | null;
  // When the day is empty and nothing timed is next but untimed shares wait on later days: the content count and the first waiting day, else null.
  readonly later: { readonly contents: number; readonly firstDay: LocalDate } | null;
};

function dayList(shares: readonly Share[], today: LocalDate): DayList {
  const groups = todayGroups(shares, today);
  const total = groups.late.length + groups.upcoming.length + groups.unscheduled.length + groups.finished.length;
  return { groups, total, late: groups.late.length, unscheduled: groups.unscheduled.length };
}

export function todayView(shares: readonly Share[], brand: BrandId, today: LocalDate): TodayView {
  const own = shares.filter((s) => s.brand === brand);
  const list = dayList(own, today);
  const next = list.total ? null : nextAfter(own, today);
  const later = list.total || next !== null ? null : laterDay(own, today);
  return { ...list, next, later };
}

function laterDay(shares: readonly Share[], today: LocalDate): TodayView["later"] {
  let first: LocalDate | null = null;
  for (const s of shares) {
    const d = plannedDate(s);
    if (s.status.kind !== "upcoming" || d <= today) continue;
    if (first === null || d < first) first = d;
  }
  return first === null ? null : { contents: new Set(shares.map((s) => s.content.id)).size, firstDay: first };
}

export type BrandProblem =
  | { readonly brand: BrandId; readonly kind: "missing" }
  | { readonly brand: BrandId; readonly kind: "unreadable" }
  | { readonly brand: BrandId; readonly kind: "rejected"; readonly count: number };

export type HomeView = DayList & { readonly problems: readonly BrandProblem[] };

export type BrandState = { readonly brand: BrandId; readonly folder: FolderState; readonly rejected: number };

export function homeView(shares: readonly Share[], brands: readonly BrandState[], today: LocalDate): HomeView {
  const known = new Set(brands.map((b) => b.brand));
  const problems: BrandProblem[] = [];
  for (const b of brands) {
    if (b.folder.kind === "missing" || b.folder.kind === "unreadable") problems.push({ brand: b.brand, kind: b.folder.kind });
    else if (b.rejected > 0) problems.push({ brand: b.brand, kind: "rejected", count: b.rejected });
  }
  return { ...dayList(shares.filter((s) => known.has(s.brand)), today), problems };
}

export type RowTag = { readonly kind: "file-missing" } | { readonly kind: "late"; readonly lateByMin: number } | { readonly kind: "due" } | { readonly kind: "skipped" };

export function rowTagOf(s: Share): RowTag | null {
  const st = s.status;
  if (st.kind === "done") return null;
  if (st.kind === "skipped") return { kind: "skipped" };
  if (s.blockers.includes("file-missing")) return { kind: "file-missing" };
  if (st.kind === "late") return { kind: "late", lateByMin: st.lateByMin };
  if (st.kind === "due") return { kind: "due" };
  return null;
}

function nextAfter(shares: readonly Share[], today: LocalDate): LocalMs | null {
  let best: LocalMs | null = null;
  for (const s of shares) {
    if (s.plannedAt.kind !== "at" || s.status.kind !== "upcoming" || plannedDate(s) <= today) continue;
    if (best === null || s.plannedAt.at < best) best = s.plannedAt.at;
  }
  return best;
}
