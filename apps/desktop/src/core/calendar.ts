import { FORMATS, plannedDate, type BrandId, type Share } from "./shares.ts";
import { DAY, dateOf, weekOf, type LocalDate, type LocalMs } from "./time.ts";

export type WeekDay = { readonly date: LocalDate; readonly shares: readonly Share[] };

export type WeekView = {
  readonly days: readonly WeekDay[];
  readonly total: number;
  // Shared or skipped.
  readonly finished: number;
};

// A share with no time goes after the timed ones of its day.
const minuteKey = (s: Share): number => (s.plannedAt.kind === "at" ? s.plannedAt.at : Number.MAX_SAFE_INTEGER);
const byTime = (a: Share, b: Share) => minuteKey(a) - minuteKey(b) || a.content.id.localeCompare(b.content.id) || FORMATS.indexOf(a.platform) - FORMATS.indexOf(b.platform);

export function weekView(shares: readonly Share[], brand: BrandId, day: LocalDate): WeekView {
  const dates = weekOf(day);
  const byDay = new Map<LocalDate, Share[]>(dates.map((d) => [d, []]));
  for (const s of shares) {
    if (s.brand === brand) byDay.get(plannedDate(s))?.push(s);
  }
  const days = dates.map((date) => ({ date, shares: (byDay.get(date) ?? []).sort(byTime) }));
  const all = days.flatMap((d) => d.shares);
  return { days, total: all.length, finished: all.filter((s) => s.status.kind === "done" || s.status.kind === "skipped").length };
}

// The Monday `weeks` weeks away from the week holding `day`.
export function weekStart(day: LocalDate, weeks: number): LocalDate {
  const monday = weekOf(day)[0]!;
  return dateOf((Date.parse(`${monday}T00:00:00Z`) + weeks * 7 * DAY) as LocalMs);
}
