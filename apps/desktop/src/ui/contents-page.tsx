import { useEffect, useRef, useState } from "react";
import { CONTENT_GROUPS, type ContentRow, type ContentsView, type ContentTag } from "../core/contents.ts";
import type { ContentFile } from "../core/manifest.ts";
import type { ContentKey, Share } from "../core/shares.ts";
import { formatTime, timeOf, type LocalDate } from "../core/time.ts";
import type { BrandReading } from "./brand-data.ts";
import { Button, EmptyState, SkeletonList, Tag, type Tone } from "./components.tsx";
import { folderBlock, RejectedNotice } from "./pages.tsx";
import { assertNever, type Route } from "./route.ts";
import { Preview } from "./share-panel.tsx";
import { text } from "./text.ts";

const TAG_TONE: Readonly<Record<ContentTag["kind"], Tone>> = { late: "danger", "file-missing": "danger", due: "warning", skipped: "neutral" };

type PageProps = {
  readonly brand: ContentRow["brand"];
  readonly reading: BrandReading | null;
  readonly view: ContentsView;
  readonly today: LocalDate;
  readonly selected: ContentKey | null;
  readonly thumbUrl: (row: ContentRow) => string | null;
  readonly openPanel: (content: ContentKey) => void;
  readonly go: (r: Route) => void;
  readonly reread: () => void;
};

export function ContentsPage({ brand, reading, view, today, selected, thumbUrl, openPanel, go, reread }: PageProps) {
  if (!reading)
    return (
      <div className="page-body">
        <SkeletonList label={text.contents.loading} />
      </div>
    );
  const block = folderBlock(brand, reading, go, reread);
  if (block) return block;
  if (view.total === 0)
    return (
      <>
        {reading.rejected.length > 0 && (
          <div className="page-body">
            <RejectedNotice reading={reading} reread={reread} />
          </div>
        )}
        <EmptyState drawing="whirl-3" title={text.folder.emptyTitle} body={text.folder.emptyBody} action={{ label: text.folder.settings, onClick: () => go({ kind: "brand-settings", brand }) }} />
      </>
    );
  return (
    <div className="contents">
      <RejectedNotice reading={reading} reread={reread} />
      <p className="page-summary">{text.contents.summary(view.total, view.groups.today.length)}</p>
      <div className="today-groups">
        {CONTENT_GROUPS.map((g) =>
          view.groups[g].length === 0 ? null : (
            <section key={g} className="share-group" aria-labelledby={`contents-${g}`}>
              <h2 id={`contents-${g}`} className="share-group-label">
                {text.contents.groups[g]} <span className="share-group-count">{view.groups[g].length}</span>
              </h2>
              <ul className="share-list">
                {view.groups[g].map((r) => (
                  <ContentRowView key={r.key} row={r} today={today} url={thumbUrl(r)} selected={r.key === selected} openPanel={openPanel} />
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    </div>
  );
}

type RowProps = { row: ContentRow; today: LocalDate; url: string | null; selected: boolean; openPanel: (content: ContentKey) => void };

function ContentRowView({ row: r, today, url, selected, openPanel }: RowProps) {
  return (
    <li className={`share-row${r.group === "done" ? " share-row-finished" : ""}${selected ? " share-row-selected" : ""}`}>
      <button type="button" className="share-row-main" data-content={r.key} aria-current={selected ? "true" : undefined} onClick={() => openPanel(r.key)}>
        <Thumb file={r.file} url={url} />
        <span className="share-title">{r.content.title}</span>
        <span className="content-count">{text.contents.shared(r.done, r.shares.length)}</span>
        <span className="content-next">{r.next ? text.contents.next(r.next, today) : text.contents.none}</span>
        <span className="share-status">{r.tag && <Tag tone={TAG_TONE[r.tag.kind]}>{text.contents.tag(r.tag)}</Tag>}</span>
      </button>
    </li>
  );
}

// A video loads its first frame only once its row scrolls into view; Bitenler grows with every finished content.
function Thumb({ file, url }: { file: ContentFile; url: string | null }) {
  const box = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(file.kind === "image");
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const el = box.current;
    if (seen || !el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const show = url !== null && seen && failed !== url;
  return (
    <span ref={box} className="content-thumb" aria-hidden="true">
      {show &&
        (file.kind === "image" ? (
          <img className="content-thumb-media" src={url} alt="" loading="lazy" onError={() => setFailed(url)} />
        ) : (
          <video className="content-thumb-media" src={`${url}#t=0.1`} muted playsInline preload="metadata" onError={() => setFailed(url)} />
        ))}
    </span>
  );
}

export type ContentActions = {
  readonly reveal: () => void;
  readonly goTo: (share: Share) => void;
  readonly skipLeft: () => void;
};

type PanelProps = { readonly row: ContentRow; readonly size: number | null; readonly url: string | null; readonly actions: ContentActions };

export function ContentPanel({ row: r, size, url, actions }: PanelProps) {
  const missing = size === null;
  const left = r.shares.some((s) => s.status.kind !== "done" && s.status.kind !== "skipped");
  return (
    <>
      <div className="share-head">
        {r.tag && <Tag tone={TAG_TONE[r.tag.kind]}>{text.contents.tag(r.tag)}</Tag>}
        <h2 className="panel-heading">{r.content.title}</h2>
      </div>
      <Preview file={r.file} url={missing ? null : url} />
      <p className={`share-file${missing ? " share-file-missing" : ""}`}>{text.share.fileLine(r.file, size)}</p>
      {!missing && (
        <Button variant="tertiary" onClick={actions.reveal}>
          {text.share.reveal}
        </Button>
      )}
      <hr className="share-divider" />
      <section className="share-step">
        <h3 className="share-step-title">{text.contents.sharesTitle(r.done, r.shares.length)}</h3>
        <ul className="share-minis">
          {r.shares.map((s) => (
            <li key={s.id} className={`share-mini${s.status.kind === "done" || s.status.kind === "skipped" ? " share-mini-finished" : ""}`}>
              <span className="share-mini-name">{text.contents.shareLine(s)}</span>
              <span className="share-mini-time">{s.plannedAt.kind === "at" ? formatTime(timeOf(s.plannedAt.at)) : text.today.noTime}</span>
              <span className="share-mini-status">{miniTag(s)}</span>
            </li>
          ))}
        </ul>
      </section>
      {r.goTo && (
        <Button variant="primary" onClick={() => r.goTo && actions.goTo(r.goTo)}>
          {r.goTo.status.kind === "late" ? text.contents.goLate(r.goTo.platform) : text.contents.goNext(r.goTo.platform)}
        </Button>
      )}
      {left && (
        <>
          <hr className="share-divider" />
          <div className="share-defer">
            <Button variant="ghost" onClick={actions.skipLeft}>
              {text.contents.skipLeft}
            </Button>
            <p className="share-note">{text.contents.skipLeftNote}</p>
          </div>
        </>
      )}
    </>
  );
}

function miniTag(s: Share) {
  switch (s.status.kind) {
    case "late":
      return <Tag tone="danger">{text.contents.late}</Tag>;
    case "due":
      return <Tag tone="warning">{text.today.due}</Tag>;
    case "done":
      return <Tag tone="success">{text.contents.done}</Tag>;
    case "skipped":
      return <Tag tone="neutral">{text.today.skipped}</Tag>;
    case "upcoming":
      return null;
    default:
      return assertNever(s.status);
  }
}
