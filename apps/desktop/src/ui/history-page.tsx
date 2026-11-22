import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { firstDays, HISTORY_FILTERS, historyView, type HistoryFilter, type HistoryRow } from "../core/history.ts";
import type { BrandId, Share, ShareId, ShareRecord } from "../core/shares.ts";
import { formatTime, type LocalDate } from "../core/time.ts";
import { stickers } from "./assets.gen.ts";
import { Button, EmptyState, SkeletonList, Tag } from "./components.tsx";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./menu.tsx";
import type { BrandLabel } from "./share-list.tsx";
import { text } from "./text.ts";

type Props = {
  readonly records: readonly ShareRecord[];
  // Null while the brand folders are being read: titles and planned times come from the packages.
  readonly shares: readonly Share[] | null;
  readonly today: LocalDate;
  readonly brandOf: (brand: BrandId) => BrandLabel;
  readonly undo: (share: ShareId) => void;
};

const TIP_DELAY = 500;
const MENU_SIDE = 4;
// Rows drawn at first and added by each «Daha eskileri göster»: about 30 ms in a production build.
const PAGE = 200;

type Tip = { readonly text: string; readonly left: number; readonly top: number };

export function HistoryPage({ records, shares, today, brandOf, undo }: Props) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [tip, setTip] = useState<Tip | null>(null);
  const tipTimer = useRef<number | undefined>(undefined);
  const focusAfter = useRef<ShareId | null>(null);
  const loading = shares === null;
  const view = historyView(records, shares ?? [], filter);
  const page = firstDays(view.days, limit);
  const rows = page.days.flatMap((d) => d.rows);
  // After an undo the row is gone: focus moves to the next row's button, else the previous one, else the page.
  useEffect(() => {
    const id = focusAfter.current;
    if (id === null) return;
    focusAfter.current = null;
    document.querySelector<HTMLElement>(`[data-undo="${CSS.escape(id)}"]`)?.focus();
  });
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);
  const undoAndFocus = (id: ShareId) => {
    const i = rows.findIndex((r) => r.share === id);
    const next = rows.slice(i + 1).find((r) => !r.gone) ?? rows.slice(0, i).reverse().find((r) => !r.gone);
    focusAfter.current = next?.share ?? null;
    setTip(null);
    undo(id);
    if (!next) document.querySelector<HTMLElement>("main.page")?.focus();
  };
  // One tip for the whole list: a tooltip component per row made 5,000 rows take seconds to open.
  const showTip = (target: EventTarget, wait: number) => {
    window.clearTimeout(tipTimer.current);
    const row = target instanceof Element ? target.closest<HTMLElement>(".share-row[data-tip]") : null;
    if (!row) return setTip(null);
    tipTimer.current = window.setTimeout(() => {
      const r = row.getBoundingClientRect();
      setTip({ text: row.dataset.tip ?? "", left: r.left, top: r.top });
    }, wait);
  };
  const hideTip = () => {
    window.clearTimeout(tipTimer.current);
    setTip(null);
  };
  if (!loading && view.total === 0) return <EmptyState drawing="spiral-1" title={text.history.emptyTitle} body={text.history.emptyBody} />;
  return (
    <div className="history">
      <div className="history-bar">
        <p className="page-summary" role={loading ? "status" : undefined}>
          {loading ? text.history.loading : text.history.summary(view.total, view.skipped)}
        </p>
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="button button-tertiary history-filter" disabled={loading} aria-label={`${text.history.filterLabel}: ${text.history.filters[filter]}`}>
              {text.history.filters[filter]}
              <span className="history-caret" aria-hidden="true">
                ▾
              </span>
            </button>
          </MenuTrigger>
          <MenuContent sideOffset={MENU_SIDE} alignOffset={0}>
            <MenuRadioGroup value={filter}>
              {HISTORY_FILTERS.map((f) => (
                <MenuRadioItem
                  key={f}
                  value={f}
                  onSelect={() => {
                    setFilter(f);
                    setLimit(PAGE);
                  }}
                >
                  {text.history.filters[f]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      </div>
      {loading ? (
        <SkeletonList />
      ) : page.days.length === 0 ? (
        <p className="page-summary">{text.history.noMatch[filter]}</p>
      ) : (
        <div
          className="today-groups"
          onPointerOver={(e: PointerEvent) => showTip(e.target, TIP_DELAY)}
          onPointerLeave={hideTip}
          onFocus={(e: FocusEvent) => showTip(e.target, 0)}
          onBlur={hideTip}
        >
          {page.days.map((d) => (
            <section key={d.date} className="share-group" aria-labelledby={`history-${d.date}`}>
              <h2 id={`history-${d.date}`} className="share-group-label">
                {text.history.day(d.date, today)} <span className="share-group-count">{d.rows.length}</span>
              </h2>
              <ul className="share-list">
                {d.rows.map((r) => (
                  <Row key={r.share} row={r} brand={brandOf(r.brand)} undo={undoAndFocus} />
                ))}
              </ul>
            </section>
          ))}
          {page.hidden > 0 && (
            <div className="history-more">
              <Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>
                {text.history.more(page.hidden)}
              </Button>
            </div>
          )}
        </div>
      )}
      {tip && (
        <div className="tip history-tip" role="tooltip" style={{ left: tip.left, top: tip.top }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

function Row({ row: r, brand, undo }: { row: HistoryRow; brand: BrandLabel; undo: (id: ShareId) => void }) {
  const format = r.platform === null ? (r.share.split("/").at(-1) ?? "") : text.formats[r.platform];
  const marked = text.history.marked(r.status, r.markedAt);
  const note = r.gone ? `${marked}. ${text.history.gone}` : marked;
  return (
    <li className="share-row share-row-finished" data-tip={note}>
      <div className="share-row-main">
        <span className="share-time">{r.time === null ? text.today.noTime : formatTime(r.time)}</span>
        <span className="share-platform">{format}</span>
        <span className="share-brand">
          <img className="share-brand-sticker" src={stickers[brand.sticker]} alt="" />
          <span className="share-brand-name">{brand.name}</span>
        </span>
        <span className="share-title">{r.title ?? r.content}</span>
        <span className="share-status">{r.status === "skipped" && <Tag tone="neutral">{text.today.skipped}</Tag>}</span>
      </div>
      <button
        type="button"
        className="share-undo"
        data-undo={r.share}
        disabled={r.gone}
        aria-label={text.today.undoLabel(r.title ?? r.content, format)}
        aria-description={note}
        onClick={() => undo(r.share)}
      >
        {text.today.undo}
      </button>
    </li>
  );
}
