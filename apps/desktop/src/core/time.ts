// Local wall-clock milliseconds: 2026-11-11 14:20 local is Date.UTC(2026, 10, 11, 14, 20).
// The shell converts real time; this assumes no daylight saving time (Turkey).
export type LocalMs = number & { readonly __brand: "LocalMs" };
// Minute of the day, 0-1439.
export type TimeOfDay = number & { readonly __brand: "TimeOfDay" };
// Calendar day, YYYY-MM-DD.
export type LocalDate = string & { readonly __brand: "LocalDate" };

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

export function parseTime(s: string): TimeOfDay | null {
  const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(s);
  return m ? ((Number(m[1]) * 60 + Number(m[2])) as TimeOfDay) : null;
}

export function formatTime(t: TimeOfDay): string {
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function parseDate(s: string): LocalDate | null {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? (s as LocalDate) : null;
}

export function at(date: LocalDate, time: TimeOfDay): LocalMs {
  return (Date.parse(`${date}T00:00:00Z`) + time * MINUTE) as LocalMs;
}

export function dateOf(ms: LocalMs): LocalDate {
  return new Date(ms).toISOString().slice(0, 10) as LocalDate;
}

export function timeOf(ms: LocalMs): TimeOfDay {
  return Math.floor((((ms % DAY) + DAY) % DAY) / MINUTE) as TimeOfDay;
}

// The store's instant format: YYYY-MM-DDTHH:MM, local, minute resolution.
export function formatLocal(ms: LocalMs): string {
  return `${dateOf(ms)}T${formatTime(timeOf(ms))}`;
}

export function parseLocal(s: string): LocalMs | null {
  const [d, t, ...rest] = s.split("T");
  if (rest.length || d === undefined || t === undefined) return null;
  const date = parseDate(d);
  const time = parseTime(t);
  return date === null || time === null ? null : at(date, time);
}

// The seven days of the Monday-first week holding `date`.
export function weekOf(date: LocalDate): readonly LocalDate[] {
  const start = Date.parse(`${date}T00:00:00Z`);
  const weekday = (new Date(start).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => dateOf((start + (i - weekday) * DAY) as LocalMs));
}
