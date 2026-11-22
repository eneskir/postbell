import type { BrandId, Share, ShareId } from "../core/shares.ts";
import { dateOf, type LocalMs } from "../core/time.ts";
import { homeView, type BrandState } from "../core/today.ts";
import { EmptyState, Notice, SkeletonList } from "./components.tsx";
import { ShareGroups, type BrandLabel } from "./share-list.tsx";
import { text } from "./text.ts";

type Props = {
  readonly brands: readonly BrandState[] | null;
  readonly shares: readonly Share[];
  readonly now: LocalMs;
  readonly selected: ShareId | null;
  readonly openPanel: (share: ShareId) => void;
  readonly undo: (share: ShareId) => void;
  readonly reread: () => void;
  readonly brandOf: (brand: BrandId) => BrandLabel;
};

export function HomePage({ brands, shares, now, selected, openPanel, undo, reread, brandOf }: Props) {
  if (!brands)
    return (
      <div className="page-body">
        <SkeletonList label={text.sharesLoading} />
      </div>
    );
  const view = homeView(shares, brands, dateOf(now));
  const problems = view.problems.map((p) => [brandOf(p.brand).name, text.home.problem(p)] as const);
  const notice =
    problems.length > 0 ? (
      <Notice tone="danger" action={{ label: text.folder.retry, onClick: reread }} detail={text.home.problemsDetail(problems)}>
        {text.home.problems(problems)}
      </Notice>
    ) : null;
  if (view.total === 0)
    return (
      <>
        {notice && <div className="page-body">{notice}</div>}
        <EmptyState drawing="whirl-3" title={text.home.emptyTitle} body={text.home.emptyBody} />
      </>
    );
  return (
    <div className="today">
      {notice}
      <p className="page-summary">{text.todaySummary(view.total, view.late, view.unscheduled)}</p>
      <ShareGroups groups={view.groups} selected={selected} openPanel={openPanel} undo={undo} brandOf={brandOf} />
    </div>
  );
}
