import type { Platform } from "./manifest.ts";
import { FORMATS, plannedDate, type BrandId, type ContentId, type Share, type ShareId, type ShareRecord } from "./shares.ts";
import { dateOf, timeOf, type LocalDate, type LocalMs, type TimeOfDay } from "./time.ts";

export type HistoryFilter = "all" | "done" | "skipped";
export const HISTORY_FILTERS: readonly HistoryFilter[] = ["all", "done", "skipped"];

export type HistoryRow = {
  readonly share: ShareId;
  readonly brand: BrandId;
  readonly content: ContentId;
  // An unknown platform only comes from a hand-edited store file; the row still shows.
  readonly platform: Platform | null;
  // Null when the content's package is no longer in the brand folder: the row shows the content id and cannot be undone.
  readonly title: string | null;
  readonly status: ShareRecord["status"];
  readonly markedAt: LocalMs;
  // The planned day and time; a record without its package falls back to the day it was marked, with no time.
  readonly day: LocalDate;
  readonly time: TimeOfDay | null;
};

export type HistoryDay = { readonly date: LocalDate; readonly rows: readonly HistoryRow[] };

export type HistoryView = {
  readonly days: readonly HistoryDay[];
  // Counts over every record, whatever the filter.
  readonly total: number;
  readonly skipped: number;
};

function rowOf(r: ShareRecord, share: Share | undefined): HistoryRow {
  const [brand = "", content = "", platform = ""] = r.share.split("/");
  const known = FORMATS.includes(platform as Platform) ? (platform as Platform) : null;
  const base = { share: r.share, brand: brand as BrandId, content: content as ContentId, platform: known, status: r.status, markedAt: r.at };
  if (!share) return { ...base, title: null, day: dateOf(r.at), time: null };
  return { ...base, title: share.content.title, day: plannedDate(share), time: share.plannedAt.kind === "at" ? timeOf(share.plannedAt.at) : null };
}

const order = (p: Platform | null) => (p === null ? FORMATS.length : FORMATS.indexOf(p));

// The newest whole days that reach `limit` rows; drawing every row of a long history at once is too slow (5,000 rows: about 800 ms).
export function firstDays(days: readonly HistoryDay[], limit: number): { readonly days: readonly HistoryDay[]; readonly hidden: number } {
  let shown = 0;
  let n = 0;
  while (n < days.length && shown < limit) shown += days[n++]!.rows.length;
  return { days: days.slice(0, n), hidden: days.slice(n).reduce((sum, d) => sum + d.rows.length, 0) };
}

// Newest day first; inside a day by planned time (no time last), then brand, content and format order.
export function historyView(records: readonly ShareRecord[], shares: readonly Share[], filter: HistoryFilter): HistoryView {
  const byId = new Map(shares.map((s) => [s.id, s]));
  const rows = records.map((r) => rowOf(r, byId.get(r.share)));
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const days = new Map<LocalDate, HistoryRow[]>();
  for (const r of shown) days.set(r.day, [...(days.get(r.day) ?? []), r]);
  const cmp = (a: HistoryRow, b: HistoryRow) =>
    (a.time ?? Infinity) - (b.time ?? Infinity) || a.brand.localeCompare(b.brand) || a.content.localeCompare(b.content) || order(a.platform) - order(b.platform);
  return {
    days: [...days.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, list]) => ({ date, rows: list.sort(cmp) })),
    total: rows.length,
    skipped: rows.filter((r) => r.status === "skipped").length,
  };
}
