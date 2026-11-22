import { useEffect, useRef, type ReactNode } from "react";
import type { BrandId, Share, ShareId, TodayGroups } from "../core/shares.ts";
import { formatTime, timeOf } from "../core/time.ts";
import { rowTagOf, type RowTag } from "../core/today.ts";
import { stickers, type StickerName } from "./assets.gen.ts";
import { Tag } from "./components.tsx";
import { assertNever } from "./route.ts";
import { text } from "./text.ts";

export type BrandLabel = { readonly name: string; readonly sticker: StickerName };

type Props = {
  readonly groups: TodayGroups;
  readonly selected: ShareId | null;
  readonly openPanel: (share: ShareId) => void;
  readonly undo: (share: ShareId) => void;
  readonly brandOf?: (brand: BrandId) => BrandLabel;
};

const GROUPS: readonly (keyof TodayGroups)[] = ["late", "upcoming", "unscheduled", "finished"];

export function ShareGroups({ groups, selected, openPanel, undo, brandOf }: Props) {
  const focusAfter = useRef<ShareId | null>(null);
  useEffect(() => {
    const id = focusAfter.current;
    if (id === null) return;
    focusAfter.current = null;
    document.querySelector<HTMLElement>(`[data-share="${CSS.escape(id)}"]`)?.focus();
  });
  const undoAndFocus = (id: ShareId) => {
    focusAfter.current = id;
    undo(id);
  };
  return (
    <div className="today-groups">
      {GROUPS.map((g) =>
        groups[g].length === 0 ? null : (
          <section key={g} className="share-group" aria-labelledby={`today-${g}`}>
            <h2 id={`today-${g}`} className="share-group-label">
              {text.today.groups[g]} <span className="share-group-count">{groups[g].length}</span>
            </h2>
            <ul className="share-list">
              {groups[g].map((s) => (
                <ShareRow key={s.id} share={s} brand={brandOf?.(s.brand)} selected={s.id === selected} openPanel={openPanel} undo={undoAndFocus} />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

function rowTime(s: Share): string {
  const st = s.status;
  if (st.kind === "done" || st.kind === "skipped") return formatTime(timeOf(st.at));
  return s.plannedAt.kind === "at" ? formatTime(timeOf(s.plannedAt.at)) : text.today.noTime;
}

function statusTag(t: RowTag | null): ReactNode {
  if (t === null) return null;
  switch (t.kind) {
    case "file-missing":
      return <Tag tone="danger">{text.today.fileMissing}</Tag>;
    case "late":
      return <Tag tone="danger">{text.delay(t.lateByMin)}</Tag>;
    case "due":
      return <Tag tone="warning">{text.today.due}</Tag>;
    case "skipped":
      return <Tag tone="neutral">{text.today.skipped}</Tag>;
    default:
      return assertNever(t);
  }
}

type RowProps = { share: Share; brand: BrandLabel | undefined; selected: boolean; openPanel: (id: ShareId) => void; undo: (id: ShareId) => void };

function ShareRow({ share: s, brand, selected, openPanel, undo }: RowProps) {
  const done = s.status.kind === "done";
  const finished = done || s.status.kind === "skipped";
  const format = text.formats[s.platform];
  return (
    <li className={`share-row${finished ? " share-row-finished" : ""}${selected ? " share-row-selected" : ""}`}>
      <button type="button" className="share-row-main" data-share={s.id} aria-current={selected ? "true" : undefined} onClick={() => openPanel(s.id)}>
        <span className="share-time">{rowTime(s)}</span>
        <span className="share-platform">{format}</span>
        {brand && (
          <span className="share-brand">
            <img className="share-brand-sticker" src={stickers[brand.sticker]} alt="" />
            <span className="share-brand-name">{brand.name}</span>
          </span>
        )}
        <span className="share-title">{s.content.title}</span>
        <span className="share-status">{statusTag(rowTagOf(s))}</span>
      </button>
      {done && (
        <button type="button" className="share-undo" aria-label={text.today.undoLabel(s.content.title, format)} onClick={() => undo(s.id)}>
          {text.today.undo}
        </button>
      )}
    </li>
  );
}
