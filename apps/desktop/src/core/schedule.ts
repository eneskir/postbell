import { FORMATS, formatsOf, NETWORKS, type Account, type AccountId, type BrandId } from "./shares.ts";
import type { Platform } from "./manifest.ts";
import type { StoreFile } from "./store.ts";
import type { TimeOfDay } from "./time.ts";

export type ScheduleRow = { readonly account: Account; readonly format: Platform; readonly time: TimeOfDay | null };

export function scheduleRows(s: StoreFile, brand: BrandId): ScheduleRow[] {
  const own = s.accounts.filter((a) => a.brand === brand);
  return NETWORKS.flatMap((n) => own.filter((a) => a.network === n)).flatMap((account) =>
    FORMATS.filter((f) => formatsOf(account.network).includes(f)).map((format) => ({ account, format, time: account.times[format] ?? null })),
  );
}

export function setTime(s: StoreFile, account: AccountId, format: Platform, time: TimeOfDay | null): StoreFile {
  const a = s.accounts.find((x) => x.id === account);
  if (!a || !formatsOf(a.network).includes(format) || (a.times[format] ?? null) === time) return s;
  const times = { ...a.times };
  if (time === null) delete times[format];
  else times[format] = time;
  return { ...s, accounts: s.accounts.map((x) => (x.id === account ? { ...x, times } : x)) };
}

// `partial`: the start of a valid time, shown without an error while typing.
export type TimeInput =
  | { readonly kind: "empty" }
  | { readonly kind: "time"; readonly time: TimeOfDay }
  | { readonly kind: "partial" }
  | { readonly kind: "invalid" };

export function readTimeInput(text: string): TimeInput {
  const t = text.trim();
  if (t === "") return { kind: "empty" };
  const m = /^([0-9]{1,2})[:.]([0-9]{2})$/.exec(t);
  if (m) {
    const [h, min] = [Number(m[1]), Number(m[2])];
    return h < 24 && min < 60 ? { kind: "time", time: (h * 60 + min) as TimeOfDay } : { kind: "invalid" };
  }
  return /^[0-9]{1,2}([:.][0-9]?)?$/.test(t) ? { kind: "partial" } : { kind: "invalid" };
}
