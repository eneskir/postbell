import type { SetupStep } from "../core/accounts.ts";
import type { BrandId, Share, ShareId } from "../core/shares.ts";
import { dateOf, type LocalMs } from "../core/time.ts";
import { todayView } from "../core/today.ts";
import type { BrandReading } from "./brand-data.ts";
import { EmptyState, Notice, SkeletonList } from "./components.tsx";
import { folderBlock, RejectedNotice } from "./pages.tsx";
import type { Route } from "./route.ts";
import { ShareGroups } from "./share-list.tsx";
import { text } from "./text.ts";

type Props = {
  readonly brand: BrandId;
  readonly reading: BrandReading | null;
  readonly setup: SetupStep | null;
  readonly shares: readonly Share[];
  readonly now: LocalMs;
  readonly selected: ShareId | null;
  readonly openPanel: (share: ShareId) => void;
  readonly undo: (share: ShareId) => void;
  readonly go: (r: Route) => void;
  readonly reread: () => void;
};

export function TodayPage({ brand, reading, setup, shares, now, selected, openPanel, undo, go, reread }: Props) {
  if (!reading)
    return (
      <div className="page-body">
        <SkeletonList label={text.sharesLoading} />
      </div>
    );
  const block = folderBlock(brand, reading, go, reread);
  if (block) return block;
  const today = dateOf(now);
  const view = todayView(shares, brand, today);
  const notice = (
    <>
      <RejectedNotice reading={reading} reread={reread} />
      {setup && (
        <Notice
          tone="neutral"
          action={{
            label: text.today.setupAction[setup],
            onClick: () => go(setup === "add-account" ? { kind: "brand", brand, page: "accounts" } : { kind: "brand-settings", brand }),
          }}
        >
          {text.today.setupNotice}
        </Notice>
      )}
    </>
  );
  if (view.total === 0)
    return (
      <>
        {(reading.rejected.length > 0 || setup) && <div className="page-body">{notice}</div>}
        <EmptyState
          drawing="spiral-1"
          title={text.today.emptyTitle}
          body={
            view.next !== null
              ? text.today.next(view.next, today)
              : view.later
                ? text.today.later(view.later.contents, view.later.firstDay, today)
                : text.today.noNext
          }
          action={{ label: text.today.openCalendar, onClick: () => go({ kind: "brand", brand, page: "calendar" }) }}
        />
      </>
    );
  return (
    <div className="today">
      {notice}
      <p className="page-summary">{text.todaySummary(view.total, view.late, view.unscheduled)}</p>
      <ShareGroups groups={view.groups} selected={selected} openPanel={openPanel} undo={undo} />
    </div>
  );
}
