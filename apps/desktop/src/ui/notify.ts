import type { Alarm } from "../core/alarms.ts";
import type { AlarmPlan, WireAlarm } from "../core/port.ts";
import type { BrandId, Share } from "../core/shares.ts";
import type { LocalMs } from "../core/time.ts";
import { text } from "./text.ts";

export function alarmPlan(alarms: readonly Alarm[], shares: readonly Share[], brandName: (b: BrandId) => string, instant: (l: LocalMs) => number): AlarmPlan {
  const byId = new Map(shares.map((s) => [s.id, s]));
  const out: WireAlarm[] = [];
  for (const a of alarms) {
    const s = byId.get(a.share);
    if (!s?.account) continue;
    const { handle } = s.account;
    out.push({
      id: a.id,
      at: instant(a.at),
      title: a.kind === "due" ? text.notify.due(handle, s.platform) : text.notify.late(a.lateByMin, handle, s.platform),
      body: s.content.title,
      brand: brandName(a.brand),
      label: text.notify.format(s.platform),
      target: { brand: a.brand, share: a.share },
    });
  }
  return { alarms: out, texts: { open: text.notify.open, openHome: text.notify.openHome, many: text.notify.many } };
}
