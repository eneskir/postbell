import { FORMATS, type BrandId, type Share, type ShareId } from "./shares.ts";
import type { Settings } from "./settings.ts";
import { MINUTE, type LocalMs } from "./time.ts";

export type NotifySettings = Pick<Settings, "notifyOnTime" | "reminderInterval">;

export type AlarmKind = "due" | "reminder";

export type Alarm = {
  readonly id: string;
  readonly at: LocalMs;
  readonly kind: AlarmKind;
  readonly share: ShareId;
  readonly brand: BrandId;
  readonly lateByMin: number;
};

// Past alarms stay in the list (the shell skips them); `brands` sets the order and drops brands not in it.
export function alarmsOf(shares: readonly Share[], brands: readonly BrandId[], settings: NotifySettings): Alarm[] {
  if (!settings.notifyOnTime) return [];
  const rank = new Map(brands.map((b, i) => [b, i]));
  const out: { readonly alarm: Alarm; readonly brand: number; readonly format: number }[] = [];
  for (const s of shares) {
    const brand = rank.get(s.brand);
    if (brand === undefined || s.plannedAt.kind !== "at") continue;
    const k = s.status.kind;
    if (k === "done" || k === "skipped") continue;
    const at = s.plannedAt.at;
    const format = FORMATS.indexOf(s.platform);
    out.push({ alarm: { id: `${s.id}#due`, at, kind: "due", share: s.id, brand: s.brand, lateByMin: 0 }, brand, format });
    const later = (at + settings.reminderInterval * MINUTE) as LocalMs;
    const reminder: Alarm = { id: `${s.id}#reminder`, at: later, kind: "reminder", share: s.id, brand: s.brand, lateByMin: settings.reminderInterval };
    out.push({ alarm: reminder, brand, format });
  }
  out.sort((a, b) => a.alarm.at - b.alarm.at || a.brand - b.brand || a.format - b.format || (a.alarm.id < b.alarm.id ? -1 : a.alarm.id > b.alarm.id ? 1 : 0));
  return out.map((e) => e.alarm);
}
