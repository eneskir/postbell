import { useState, type KeyboardEvent } from "react";
import { weekStart, weekView } from "../core/calendar.ts";
import type { BrandId, Share, ShareId } from "../core/shares.ts";
import { formatTime, timeOf, type LocalDate } from "../core/time.ts";
import type { BrandReading } from "./brand-data.ts";
import { Button, EmptyState } from "./components.tsx";
import { folderBlock, RejectedNotice } from "./pages.tsx";
import type { Route } from "./route.ts";
import { text } from "./text.ts";

type Props = {
  readonly brand: BrandId;
  readonly reading: BrandReading | null;
  readonly shares: readonly Share[];
  readonly today: LocalDate;
  readonly selected: ShareId | null;
  // With the panel open the columns narrow and cards drop to their short form.
  readonly compact: boolean;
  readonly openPanel: (share: ShareId) => void;
  readonly go: (r: Route) => void;
  readonly reread: () => void;
};

const SKELETON_DAYS = 5;
const SKELETON_CARDS = 3;

export function CalendarPage({ brand, reading, shares, today, selected, compact, openPanel, go, reread }: Props) {
  const [weeks, setWeeks] = useState(0);
  const block = reading && folderBlock(brand, reading, go, reread);
  if (block) return block;
  const view = weekView(shares, brand, weekStart(today, weeks));
  const loading = reading === null;
  const empty = !loading && view.total === 0;
  return (
    <div className={`calendar${compact ? " calendar-compact" : ""}`}>
      {reading && <RejectedNotice reading={reading} reread={reread} />}
      {!empty && (
        <p className="page-summary" role={loading ? "status" : undefined}>
          {loading ? text.calendar.loading : text.calendar.summary(view.total, view.finished)}
        </p>
      )}
      <div className="calendar-bar">
        <h2 className="calendar-range">{text.calendar.range(view.days[0]!.date, view.days[6]!.date)}</h2>
        <div className="calendar-nav">
          <Button variant="tertiary" label={text.calendar.previous} onClick={() => setWeeks((w) => w - 1)}>
            ‹
          </Button>
          <Button variant="tertiary" onClick={() => setWeeks(0)}>
            {text.calendar.thisWeek}
          </Button>
          <Button variant="tertiary" label={text.calendar.next} onClick={() => setWeeks((w) => w + 1)}>
            ›
          </Button>
        </div>
      </div>
      <div className="calendar-head" aria-hidden={empty || undefined}>
        {view.days.map((d) => (
          <span key={d.date} className={`calendar-day${d.date === today ? " calendar-day-today" : ""}`}>
            {text.calendar.day(d.date)}
            {d.date === today && !compact && ` · ${text.calendar.today}`}
          </span>
        ))}
      </div>
      {empty ? (
        <EmptyState drawing="spiral-4" title={text.calendar.emptyTitle} body={text.calendar.emptyBody} />
      ) : (
        <div className="calendar-grid" onKeyDown={moveFocus} aria-busy={loading || undefined}>
          {view.days.map((d, day) => (
            <section key={d.date} className={`calendar-column${d.date === today ? " calendar-column-today" : ""}`} aria-label={text.calendar.day(d.date)}>
              {loading
                ? day < SKELETON_DAYS && Array.from({ length: SKELETON_CARDS }, (_, i) => <span key={i} className="chip chip-skeleton" />)
                : d.shares.map((s, i) => <Chip key={s.id} share={s} day={day} index={i} compact={compact} selected={s.id === selected} openPanel={openPanel} />)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

type ChipProps = { share: Share; day: number; index: number; compact: boolean; selected: boolean; openPanel: (id: ShareId) => void };

function Chip({ share: s, day, index, compact, selected, openPanel }: ChipProps) {
  const st = s.status.kind;
  const status = st === "upcoming" ? null : text.calendar.status[st];
  const time = s.plannedAt.kind === "at" ? formatTime(timeOf(s.plannedAt.at)) : text.calendar.noTime;
  const tone = st === "late" || st === "due" ? ` chip-${st}` : st === "done" || st === "skipped" ? " chip-finished" : "";
  // The short card swaps the title for the status word when the share needs action.
  const urgent = compact && (st === "late" || st === "due");
  return (
    <button
      type="button"
      className={`chip${tone}${selected ? " chip-selected" : ""}`}
      data-share={s.id}
      data-day={day}
      data-index={index}
      aria-current={selected ? "true" : undefined}
      aria-label={[time, text.formats[s.platform], s.content.title, status].filter(Boolean).join(", ")}
      onClick={() => openPanel(s.id)}
    >
      <span className="chip-meta">{compact || !status ? time : `${time} · ${status}`}</span>
      <span className="chip-platform">{compact ? text.calendar.shortFormats[s.platform] : text.formats[s.platform]}</span>
      <span className={urgent ? "chip-status" : "chip-title"}>{urgent ? status : s.content.title}</span>
    </button>
  );
}

// Arrow keys move between cards: up and down within a day, left and right to the nearest card of the next day that has any.
function moveFocus(e: KeyboardEvent<HTMLDivElement>) {
  const from = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(".chip[data-day]") : null;
  if (!from) return;
  const day = Number(from.dataset.day);
  const index = Number(from.dataset.index);
  const card = (d: number, i: number) => e.currentTarget.querySelector<HTMLElement>(`.chip[data-day="${d}"][data-index="${i}"]`);
  const count = (d: number) => e.currentTarget.querySelectorAll(`.chip[data-day="${d}"]`).length;
  let to: HTMLElement | null = null;
  if (e.key === "ArrowUp") to = card(day, index - 1);
  else if (e.key === "ArrowDown") to = card(day, index + 1);
  else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const step = e.key === "ArrowLeft" ? -1 : 1;
    for (let d = day + step; d >= 0 && d < 7 && !to; d += step) {
      const n = count(d);
      if (n) to = card(d, Math.min(index, n - 1));
    }
  } else return;
  e.preventDefault();
  to?.focus();
}
